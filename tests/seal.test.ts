import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  chainSeal,
  GENESIS_SEAL,
  replayChain,
  sealEvent,
  sha384Hex,
  type ReplayInput,
  type SealableEvent,
} from "@/lib/seal";

const baseEvent: SealableEvent = {
  seq: 1,
  eventType: "created",
  entityId: "11111111-1111-4111-8111-111111111111",
  actor: "anon_abc",
  payload: { name: "ticket-router", budgetUsd: 120 },
  createdAt: "2026-10-01T12:00:00.000Z",
};

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJson({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
  });

  it("is insensitive to key insertion order", () => {
    const first = canonicalJson({ x: 1, y: { p: true, q: "s" } });
    const second = canonicalJson({ y: { q: "s", p: true }, x: 1 });
    expect(first).toBe(second);
  });

  it("normalises dates to ISO-8601", () => {
    expect(canonicalJson({ at: new Date("2026-10-01T12:00:00.000Z") })).toBe(
      '{"at":"2026-10-01T12:00:00.000Z"}',
    );
  });

  it("drops undefined values and normalises negative zero", () => {
    expect(canonicalJson({ a: undefined, b: -0, c: 1 })).toBe('{"b":0,"c":1}');
  });

  it("renders non-finite numbers as null rather than throwing", () => {
    expect(canonicalJson({ n: Number.POSITIVE_INFINITY })).toBe('{"n":null}');
  });

  it("converts bigints to strings deterministically", () => {
    expect(canonicalJson({ big: 9007199254740993n })).toBe('{"big":"9007199254740993"}');
  });
});

describe("sha384Hex", () => {
  it("matches a known SHA-384 vector for the empty string", () => {
    expect(sha384Hex("")).toBe(
      "38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b",
    );
  });

  it("matches a known SHA-384 vector for abc", () => {
    expect(sha384Hex("abc")).toBe(
      "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
    );
  });

  it("is a 96-character lowercase hex digest", () => {
    expect(sha384Hex("patchbay")).toMatch(/^[0-9a-f]{96}$/);
  });
});

describe("chainSeal", () => {
  it("hashes prevSeal concatenated with canonical JSON", () => {
    const manual = sha384Hex(GENESIS_SEAL + canonicalJson(baseEvent));
    expect(chainSeal(GENESIS_SEAL, baseEvent)).toBe(manual);
  });

  it("produces a different digest when only the payload changes", () => {
    const other = { ...baseEvent, payload: { name: "other", budgetUsd: 120 } };
    expect(chainSeal(GENESIS_SEAL, other)).not.toBe(chainSeal(GENESIS_SEAL, baseEvent));
  });

  it("depends on the previous seal", () => {
    const prev = "a".repeat(96);
    expect(chainSeal(prev, baseEvent)).not.toBe(chainSeal(GENESIS_SEAL, baseEvent));
  });
});

describe("replayChain", () => {
  function build(count: number): ReplayInput[] {
    const events: ReplayInput[] = [];
    let prev = GENESIS_SEAL;
    for (let index = 0; index < count; index += 1) {
      const event: SealableEvent = {
        seq: index + 1,
        eventType: index === 0 ? "created" : "updated",
        entityId: baseEvent.entityId,
        actor: "anon_abc",
        payload: { revision: index + 1, note: index === 0 ? "genesis" : "patched" },
        createdAt: `2026-10-01T12:0${index}:00.000Z`,
      };
      const sealLink = sealEvent(prev, event);
      events.push({ ...event, sealLink });
      prev = sealLink;
    }
    return events;
  }

  it("reports ok for an untouched chain", () => {
    const events = build(4);
    const result = replayChain(GENESIS_SEAL, events, events[events.length - 1].sealLink);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(4);
    expect(result.brokenAtSeq).toBeNull();
    expect(result.headSeal).toBe(events[3].sealLink);
  });

  it("accepts an empty chain at genesis", () => {
    const result = replayChain(GENESIS_SEAL, [], GENESIS_SEAL);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(0);
  });

  it("detects a rewritten payload at the first broken link", () => {
    const events = build(4);
    const tampered = events.map((event, index) =>
      index === 2 ? { ...event, payload: { revision: 999, note: "patched" } } : event,
    );
    const result = replayChain(GENESIS_SEAL, tampered, events[3].sealLink);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(3);
    expect(result.reason).toMatch(/seal mismatch at seq 3/);
  });

  it("detects a reordered chain via the sequence gap", () => {
    const events = build(3);
    const [first, second, third] = events;
    const result = replayChain(GENESIS_SEAL, [first, third, second]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/seal mismatch|sequence gap/);
  });

  it("detects a deletion from the middle of the chain", () => {
    const events = build(5);
    const truncated = events.filter((event) => event.seq !== 3);
    const result = replayChain(GENESIS_SEAL, truncated, events[4].sealLink);
    expect(result.ok).toBe(false);
    expect(result.checked).toBeLessThan(5);
  });

  it("detects a forged head seal", () => {
    const events = build(2);
    const result = replayChain(GENESIS_SEAL, events, "f".repeat(96));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/head seal mismatch/);
  });

  it("is deterministic: the same chain verifies identically twice", () => {
    const events = build(6);
    const first = replayChain(GENESIS_SEAL, events, events[5].sealLink);
    const second = replayChain(GENESIS_SEAL, events, events[5].sealLink);
    expect(first).toEqual(second);
  });
});