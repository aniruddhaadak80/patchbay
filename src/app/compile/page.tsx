import type { Metadata } from "next";
import { CompileWorkbench } from "@/components/compile-workbench";
import { SourceBadge } from "@/components/feedback";
import { getCatalog } from "@/lib/catalog";
import { listAgents } from "@/lib/db/repository";
import { getScopeId } from "@/lib/scope";
import { ENGINE_VERSION, REFERENCE_REQUEST, TIER_COST_TARGET_USD } from "@/lib/engine";

export const metadata: Metadata = {
  title: "Policy compiler",
  description: `Run the deterministic ${ENGINE_VERSION} routing score over a stored agent or an inline lane board, with itemized weighted factors.`,
  alternates: { canonical: "/compile" },
};

export const dynamic = "force-dynamic";

export default async function CompilePage() {
  const [snapshot, ownerId] = await Promise.all([getCatalog(), getScopeId()]);
  const { agents } = await listAgents(ownerId, { limit: 25 });

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight text-ivory-100">Policy compiler</h1>
          <SourceBadge
            status={snapshot.status}
            fetchedAt={snapshot.fetchedAt}
            itemCount={snapshot.models.length}
          />
        </div>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ivory-200">
          {ENGINE_VERSION} scores a lane assignment out of 100 using seven weighted factors. The same function
          powers the agent page, the REST endpoint, and the MCP <code className="font-mono text-brass-300">compile_policy</code>{" "}
          tool, so a number is never re-derived by hand.
        </p>
      </header>

      <section className="panel p-5" aria-label="How the score is computed">
        <h2 className="silkscreen mb-3">Algorithm</h2>
        <p className="text-[13px] leading-relaxed text-ivory-200">
          Each lane is priced for a reference request of{" "}
          <span className="font-mono text-brass-300">{REFERENCE_REQUEST.inputTokens}</span> input and{" "}
          <span className="font-mono text-brass-300">{REFERENCE_REQUEST.outputTokens}</span> output tokens. Cost
          targets per tier are ${TIER_COST_TARGET_USD.fast} (fast), ${TIER_COST_TARGET_USD.balanced} (balanced), and $
          {TIER_COST_TARGET_USD.deep} (deep). Coverage requires every lane to have a destination. Balance uses
          Shannon entropy of lane weights, so one lane carrying everything scores near zero. Headroom compares the
          projected monthly spend against your ceiling. Context, redundancy, and mobility are measured directly
          from the patched models.
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["cost", 0.24],
            ["coverage", 0.18],
            ["balance", 0.16],
            ["headroom", 0.14],
            ["context", 0.12],
            ["redundancy", 0.1],
            ["mobility", 0.06],
          ].map(([key, weight]) => (
            <li key={String(key)} className="flex items-center justify-between rounded border border-rack-200 bg-rack-100/60 px-3 py-2">
              <span className="font-mono text-[12px] text-ivory-200">{key}</span>
              <span className="font-mono text-[12px] text-brass-300">{(Number(weight) * 100).toFixed(0)}%</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-ivory-400">
          Verdicts: ship ≥ 78, tune ≥ 58, otherwise rework. An empty lane forces rework regardless of price.
        </p>
      </section>

      <CompileWorkbench agents={agents} models={snapshot.models} />
    </div>
  );
}