import { describe, expect, it } from "vitest";
import {
  openSecret,
  sealSecret,
  validateSecretFormat,
  SUPPORTED_PROVIDERS,
} from "@/lib/vault";
import { createAgentSchema, updateAgentSchema, compileSchema, credentialSchema } from "@/lib/api";
import { FALLBACK_SNAPSHOT, normalize } from "@/lib/catalog";
import { TIERS } from "@/lib/types";

describe("credential vault encryption", () => {
  it("round-trips a secret through seal and open", () => {
    const secret = "sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789";
    const sealed = sealSecret(secret);
    expect(openSecret(sealed)).toBe(secret);
  });

  it("never returns the plaintext in any returned field", () => {
    const secret = "sk-ant-0123456789abcdefghij";
    const sealed = sealSecret(secret);
    for (const value of Object.values(sealed)) {
      expect(value).not.toContain(secret);
    }
    expect(sealed.last4).toBe(secret.slice(-4));
    expect(sealed.last4.length).toBe(4);
  });

  it("produces a different ciphertext for the same secret each time", () => {
    const secret = "sk-0123456789abcdefghijklmn";
    const first = sealSecret(secret);
    const second = sealSecret(secret);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
    expect(openSecret(first)).toBe(openSecret(second));
  });

  it("rejects tampered ciphertext via the GCM auth tag", () => {
    const sealed = sealSecret("sk-0123456789abcdefghijklmn");
    const flipped = Buffer.from(sealed.ciphertext, "base64");
    flipped[0] = flipped[0] ^ 0xff;
    expect(() => openSecret({ ...sealed, ciphertext: flipped.toString("base64") })).toThrow();
  });

  it("rejects a tampered IV", () => {
    const sealed = sealSecret("sk-0123456789abcdefghijklmn");
    const iv = Buffer.from(sealed.iv, "base64");
    iv[0] = iv[0] ^ 0xff;
    expect(() => openSecret({ ...sealed, iv: iv.toString("base64") })).toThrow();
  });
});

describe("validateSecretFormat", () => {
  it("accepts plausible keys for each major provider", () => {
    expect(validateSecretFormat("openai", "sk-abcdefghijklmnopqrstuvwxyz123456")).toBeNull();
    expect(validateSecretFormat("anthropic", "sk-ant-abcdefghijklmnopqrstuvwxyz123456")).toBeNull();
    expect(validateSecretFormat("openrouter", "sk-or-v1-abcdefghijklmnopqrstuvwxyz")).toBeNull();
    expect(validateSecretFormat("groq", "gsk_abcdefghijklmnopqrstuvwxyz1234")).toBeNull();
  });

  it("rejects a wrong prefix for the declared provider", () => {
    expect(validateSecretFormat("openai", "sk-ant-abcdefghijklmnopqrstuvwxyz123456")).toMatch(/sk-/);
    expect(validateSecretFormat("anthropic", "sk-abcdefghijklmnopqrstuvwxyz123456")).toMatch(/sk-ant-/);
    expect(validateSecretFormat("groq", "sk-abcdefghijklmnopqrstuvwxyz123456")).toMatch(/gsk_/);
  });

  it("rejects keys that are too short or contain whitespace", () => {
    expect(validateSecretFormat("openai", "sk-abc")).toMatch(/too short/);
    expect(validateSecretFormat("openai", "sk-abcdefgh ijklmnopqrst")).toMatch(/whitespace/);
    expect(validateSecretFormat("openai", `sk-${"a".repeat(500)}`)).toMatch(/longer/);
  });

  it("does not echo the secret in its message", () => {
    const secret = "sk-wrongprefix-abcdefghijklmnop";
    expect(validateSecretFormat("anthropic", secret)).not.toContain(secret);
  });

  it("exposes a fixed provider allowlist", () => {
    expect(SUPPORTED_PROVIDERS).toContain("openai");
    expect(SUPPORTED_PROVIDERS).toContain("custom");
    expect(SUPPORTED_PROVIDERS).not.toContain("evil-provider");
  });
});

describe("agent input validation", () => {
  it("accepts a well-formed create payload", () => {
    const parsed = createAgentSchema.safeParse({
      name: "ticket-router",
      taskClass: "Route inbound support tickets to the right queue.",
      budgetUsd: 120,
      lanes: { fast: { modelId: "openai:gpt-5.4", weight: 0.6 } },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects names that are too short, too long, or badly punctuated", () => {
    expect(createAgentSchema.safeParse({ name: "ab", taskClass: "long enough class" }).success).toBe(false);
    expect(createAgentSchema.safeParse({ name: "x".repeat(65), taskClass: "long enough class" }).success).toBe(false);
    expect(createAgentSchema.safeParse({ name: "<script>alert(1)</script>", taskClass: "long enough class" }).success).toBe(false);
  });

  it("rejects a task class that is too short", () => {
    expect(createAgentSchema.safeParse({ name: "valid-name", taskClass: "short" }).success).toBe(false);
  });

  it("rejects lane weights outside 0..1", () => {
    const parsed = createAgentSchema.safeParse({
      name: "valid-name",
      taskClass: "long enough class",
      lanes: { fast: { weight: 4 } },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown status enum value", () => {
    expect(
      createAgentSchema.safeParse({ name: "valid-name", taskClass: "long enough class", status: "banana" }).success,
    ).toBe(false);
  });

  it("rejects a model id containing path traversal characters", () => {
    const parsed = createAgentSchema.safeParse({
      name: "valid-name",
      taskClass: "long enough class",
      lanes: { fast: { modelId: "../../etc/passwd" } },
    });
    expect(parsed.success).toBe(false);
  });

  it("requires at least one field on update", () => {
    expect(updateAgentSchema.safeParse({}).success).toBe(false);
    expect(updateAgentSchema.safeParse({ name: "still-valid" }).success).toBe(true);
  });

  it("requires exactly one lane per tier on an inline compile", () => {
    const short = compileSchema.safeParse({
      lanes: [{ tier: "fast", modelId: null, weight: 1, dailyRequests: 10 }],
    });
    expect(short.success).toBe(false);
    const full = compileSchema.safeParse({
      lanes: TIERS.map((tier) => ({ tier, modelId: null, weight: 0.3, dailyRequests: 10 })),
    });
    expect(full.success).toBe(true);
  });

  it("requires a uuid agentId on compile", () => {
    expect(compileSchema.safeParse({ agentId: "not-a-uuid" }).success).toBe(false);
  });

  it("restricts credential providers to the allowlist", () => {
    expect(credentialSchema.safeParse({ provider: "evil", label: "key", secret: "sk-1234567890abc" }).success).toBe(false);
    expect(
      credentialSchema.safeParse({ provider: "openai", label: "key", secret: "sk-1234567890abcdef" }).success,
    ).toBe(true);
  });
});

describe("catalog normalization", () => {
  const openrouter = new Map([
    [
      "openai/gpt-5.4",
      {
        id: "openai/gpt-5.4",
        name: "OpenAI: GPT-5.4",
        context_length: 400_000,
        architecture: { input_modalities: ["text", "image"] },
        pricing: { prompt: "0.00000125", completion: "0.00001" },
        top_provider: { max_completion_tokens: 128_000 },
        created: 1768000000,
      },
    ],
  ]);
  const modelsdev = new Map([
    [
      "openai",
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-5.4": {
            id: "gpt-5.4",
            reasoning: true,
            tool_call: true,
            attachment: true,
            open_weights: false,
            release_date: "2026-01-15",
            limit: { context: 400_000, output: 128_000 },
            modalities: { input: ["text", "image"] },
          },
        },
      },
    ],
  ]);
  const statuses = [
    {
      id: "openrouter" as const,
      name: "OpenRouter",
      homepage: "https://openrouter.ai/api/v1/models",
      status: "live" as const,
      fetchedAt: "2026-10-01T12:00:00.000Z",
      itemCount: 1,
      latencyMs: 120,
      sampleUpstreamId: "openai/gpt-5.4",
    },
    {
      id: "modelsdev" as const,
      name: "models.dev",
      homepage: "https://models.dev/api.json",
      status: "live" as const,
      fetchedAt: "2026-10-01T12:00:00.000Z",
      itemCount: 1,
      latencyMs: 90,
      sampleUpstreamId: "openai:gpt-5.4",
    },
  ];

  it("merges both upstreams into one normalized record", () => {
    const snapshot = normalize(openrouter, statuses[0], modelsdev, statuses[1]);
    expect(snapshot.models).toHaveLength(1);
    const merged = snapshot.models[0];
    expect(merged.id).toBe("openai:gpt-5.4");
    expect(merged.providerLabel).toBe("OpenAI");
    expect(merged.upstreamIds).toEqual({ openrouter: "openai/gpt-5.4", modelsdev: "openai:gpt-5.4" });
  });

  it("converts per-token prices into per-million prices", () => {
    const snapshot = normalize(openrouter, statuses[0], modelsdev, statuses[1]);
    expect(snapshot.models[0].inputPerMTok).toBeCloseTo(1.25, 6);
    expect(snapshot.models[0].outputPerMTok).toBeCloseTo(10, 6);
  });

  it("unions capabilities from both upstreams", () => {
    const snapshot = normalize(openrouter, statuses[0], modelsdev, statuses[1]);
    const caps = snapshot.models[0].capabilities;
    expect(caps).toContain("reasoning");
    expect(caps).toContain("tools");
    expect(caps).toContain("vision");
    expect(new Set(caps).size).toBe(caps.length);
  });

  it("drops unpriced records so every model can be priced", () => {
    const snapshot = normalize(new Map(), null, modelsdev, statuses[1]);
    expect(snapshot.models).toHaveLength(0);
    expect(snapshot.status).toBe("live");
  });

  it("handles a completely empty upstream pair", () => {
    const snapshot = normalize(null, null, null, null);
    expect(snapshot.models).toHaveLength(0);
    expect(snapshot.sources).toHaveLength(0);
  });

  it("marks the sealed fallback honestly and keeps its prices fixed", () => {
    expect(FALLBACK_SNAPSHOT.status).toBe("fallback");
    expect(FALLBACK_SNAPSHOT.fetchedAt).toBe("2026-09-30T00:00:00.000Z");
    for (const source of FALLBACK_SNAPSHOT.sources) {
      expect(source.status).toBe("fallback");
      expect(source.homepage).toMatch(/^https:\/\//);
    }
    expect(FALLBACK_SNAPSHOT.models.every((model) => model.inputPerMTok > 0)).toBe(true);
  });

  it("gives every fallback model a unique id", () => {
    const ids = FALLBACK_SNAPSHOT.models.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});