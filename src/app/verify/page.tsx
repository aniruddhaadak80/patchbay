import type { Metadata } from "next";
import { GENESIS_SEAL } from "@/lib/seal";
import { listAgents, replayAgent } from "@/lib/db/repository";
import { getScopeId } from "@/lib/scope";

export const metadata: Metadata = {
  title: "Verify",
  description:
    "Replay every append-only SHA-384 seal chain in this session and report the first broken link, if any.",
  alternates: { canonical: "/verify" },
};

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const ownerId = await getScopeId();
  const { agents } = await listAgents(ownerId, { limit: 100 });
  const results = [];
  for (const agent of agents) {
    results.push({ name: agent.name, id: agent.id, revision: agent.revision, ...(await replayAgent(ownerId, agent.id)) });
  }
  const allOk = results.every((result) => result.ok);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-ivory-100">Seal replay</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ivory-200">
          Every create, patch, and delete appends an event to a per-agent hash chain. Replaying recomputes each
          seal from stored rows alone, so a rewritten or reordered event is detectable.
        </p>
      </header>

      <section className="panel p-5" aria-label="Algorithm">
        <h2 className="silkscreen mb-3">Chain definition</h2>
        <pre className="overflow-auto rounded border border-rack-200 bg-rack-000 p-3 font-mono text-[11px] leading-relaxed text-ivory-200">
{`genesisSeal = "${GENESIS_SEAL.slice(0, 24)}…"

seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )

event_n = { seq, eventType, entityId, actor, payload, createdAt }

canonicalJson recursively sorts object keys, preserves array
order, and normalises dates to ISO-8601, so two runs on two
machines hash identical bytes.`}
        </pre>
        <p className="mt-3 text-[12px] text-ivory-400">
          Soft-deleted agents keep their rows and audit events, so a chain shared before deletion stays verifiable.
        </p>
      </section>

      {results.length === 0 ? (
        <section className="panel p-8 text-center">
          <div className="flex justify-center gap-1.5" aria-hidden="true">
            <span className="jack h-4 w-4" />
            <span className="jack h-4 w-4" />
            <span className="jack h-4 w-4" />
          </div>
          <h2 className="mt-3 text-base font-semibold text-ivory-100">No chains to replay</h2>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-ivory-400">
            Create and patch an agent, then come back. Every mutation you make will appear here with a verdict.
          </p>
        </section>
      ) : (
        <section className="panel p-5" aria-label="Replay results">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="silkscreen">{results.length} chain(s) checked</h2>
            <span
              className={`silkscreen rounded border px-2.5 py-1 text-[9px] ${
                allOk
                  ? "border-signal-green/40 bg-signal-green/10 text-signal-green"
                  : "border-signal-rose/40 bg-signal-rose/10 text-signal-rose"
              }`}
            >
              {allOk ? "all chains clean" : "at least one chain is broken"}
            </span>
          </div>
          <ul className="mt-4 space-y-3">
            {results.map((result) => (
              <li
                key={result.id}
                className={`rounded border p-4 ${
                  result.ok ? "border-rack-200 bg-rack-100/60" : "border-signal-rose/50 bg-signal-rose/10"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[14px] font-semibold text-ivory-100">{result.name}</span>
                  <span
                    className={`silkscreen text-[9px] ${result.ok ? "text-signal-green" : "text-signal-rose"}`}
                  >
                    {result.ok ? `clean · ${result.checked} events` : `broken at seq ${result.brokenAtSeq ?? "?"}`}
                  </span>
                </div>
                <p className="mt-1.5 font-mono text-[10px] text-ivory-400">
                  head {result.headSeal}
                </p>
                {result.reason ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-signal-rose">{result.reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12px] text-ivory-400">
            The same check is available over JSON-RPC via{" "}
            <code className="font-mono text-brass-300">verify_integrity</code> and over HTTP at{" "}
            <code className="font-mono text-brass-300">/api/verify</code>.
          </p>
        </section>
      )}
    </div>
  );
}