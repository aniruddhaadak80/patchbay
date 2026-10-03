"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2 } from "lucide-react";
import type { Agent, CatalogModel, EngineResult } from "@/lib/types";
import { TIER_META, TIERS } from "@/lib/types";
import { FactorList, ScoreDial, VerdictBadge } from "@/components/policy-ui";
import { ErrorNotice, EmptyState } from "@/components/feedback";

/**
 * Ad-hoc compiler. Runs the same engine as the agent page and the MCP tool
 * against an inline lane board, so the algorithm is never reimplemented here.
 */
export function CompileWorkbench({
  agents,
  models,
}: {
  agents: Agent[];
  models: CatalogModel[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"agent" | "inline">(
    agents.length > 0 ? "agent" : "inline",
  );
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [dailyRequests, setDailyRequests] = useState(2000);
  const [budgetUsd, setBudgetUsd] = useState(120);
  const [board, setBoard] = useState<Record<string, { modelId: string; weight: number }>>(() => ({
    fast: { modelId: models[0]?.id ?? "", weight: 0.6 },
    balanced: { modelId: models[Math.floor(models.length / 3)]?.id ?? "", weight: 0.3 },
    deep: { modelId: models[models.length - 1]?.id ?? "", weight: 0.1 },
  }));
  const [result, setResult] = useState<EngineResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cheapest = useMemo(() => models.slice(0, 60), [models]);

  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const body =
        mode === "agent"
          ? { agentId, dailyRequests }
          : {
              dailyRequests,
              budgetUsd,
              lanes: TIERS.map((tier) => ({
                tier,
                modelId: board[tier].modelId === "" ? null : board[tier].modelId,
                weight: board[tier].weight,
                dailyRequests: Math.round(board[tier].weight * dailyRequests),
              })),
            };
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? `Compile failed (HTTP ${response.status}).`);
        return;
      }
      setResult(payload.data.compiled as EngineResult);
      if (mode === "agent") router.refresh();
    } catch {
      setError("Network error while compiling. Retry.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-5">
      <form onSubmit={run} className="panel p-5">
        <fieldset>
          <legend className="silkscreen px-1 text-[9px]">Policy source</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode("agent")}
              disabled={agents.length === 0}
              aria-pressed={mode === "agent"}
              className={`rounded border px-3 py-2 text-[13px] font-semibold transition disabled:opacity-45 ${
                mode === "agent"
                  ? "border-brass-400 bg-brass-400/12 text-brass-300"
                  : "border-rack-300 text-ivory-200 hover:border-rack-300"
              }`}
            >
              Stored agent
            </button>
            <button
              type="button"
              onClick={() => setMode("inline")}
              aria-pressed={mode === "inline"}
              className={`rounded border px-3 py-2 text-[13px] font-semibold transition ${
                mode === "inline"
                  ? "border-brass-400 bg-brass-400/12 text-brass-300"
                  : "border-rack-300 text-ivory-200 hover:border-brass-300"
              }`}
            >
              Inline lane board
            </button>
          </div>
        </fieldset>

        {mode === "agent" ? (
          agents.length === 0 ? (
            <p className="mt-4 text-[13px] text-ivory-400">
              You have no agents yet. Create one, or switch to the inline board.
            </p>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="compile-agent" className="silkscreen text-[9px]">
                  Agent
                </label>
                <select
                  id="compile-agent"
                  value={agentId}
                  onChange={(event) => setAgentId(event.target.value)}
                  className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[14px] text-ivory-100"
                >
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} (rev {agent.revision})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="compile-volume" className="silkscreen text-[9px]">
                  Requests per day
                </label>
                <input
                  id="compile-volume"
                  type="number"
                  min={1}
                  max={1000000}
                  value={dailyRequests}
                  onChange={(event) => setDailyRequests(Number(event.target.value))}
                  className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 font-mono text-[14px] text-ivory-100"
                />
              </div>
            </div>
          )
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="inline-volume" className="silkscreen text-[9px]">
                  Requests per day
                </label>
                <input
                  id="inline-volume"
                  type="number"
                  min={1}
                  max={1000000}
                  value={dailyRequests}
                  onChange={(event) => setDailyRequests(Number(event.target.value))}
                  className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 font-mono text-[14px] text-ivory-100"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="inline-budget" className="silkscreen text-[9px]">
                  Monthly budget (USD)
                </label>
                <input
                  id="inline-budget"
                  type="number"
                  min={1}
                  max={1000000}
                  value={budgetUsd}
                  onChange={(event) => setBudgetUsd(Number(event.target.value))}
                  className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 font-mono text-[14px] text-ivory-100"
                />
              </div>
            </div>
            <ul className="grid gap-3 sm:grid-cols-3">
              {TIERS.map((tier) => (
                <li key={tier} className="rounded border border-rack-200 bg-rack-100/60 p-3">
                  <label htmlFor={`inline-${tier}`} className="silkscreen text-[9px]">
                    {TIER_META[tier].label}
                  </label>
                  <select
                    id={`inline-${tier}`}
                    value={board[tier].modelId}
                    onChange={(event) =>
                      setBoard((current) => ({
                        ...current,
                        [tier]: { ...current[tier], modelId: event.target.value },
                      }))
                    }
                    className="mt-2 w-full rounded border border-rack-300 bg-rack-050 px-2 py-2 text-[12px] text-ivory-100"
                  >
                    <option value="">Empty</option>
                    {cheapest.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                  <label htmlFor={`weight-${tier}`} className="mt-2 block text-[11px] text-ivory-400">
                    Weight
                    <input
                      id={`weight-${tier}`}
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={board[tier].weight}
                      onChange={(event) =>
                        setBoard((current) => ({
                          ...current,
                          [tier]: { ...current[tier], weight: Number(event.target.value) },
                        }))
                      }
                      className="mt-1 w-full rounded border border-rack-300 bg-rack-050 px-2 py-1.5 font-mono text-[12px] text-ivory-100"
                    />
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5">
          <button
            type="submit"
            disabled={pending || (mode === "agent" && agents.length === 0)}
            className="inline-flex items-center gap-2 rounded bg-brass-400 px-4 py-2.5 text-[14px] font-bold text-rack-000 transition hover:bg-brass-300 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
            {pending ? "Compiling…" : "Run the compiler"}
          </button>
        </div>
      </form>

      {error ? <ErrorNotice title="Compile failed" detail={error} /> : null}

      {result ? (
        <section className="panel p-5" aria-live="polite">
          <div className="flex flex-col gap-5 sm:flex-row">
            <div className="flex flex-col items-center gap-2">
              <ScoreDial score={result.score} verdict={result.verdict} />
              <VerdictBadge verdict={result.verdict} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-bold text-ivory-100">Result</h2>
                <span className="silkscreen text-[10px]">{result.engineVersion}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ivory-200">{result.verdictReason}</p>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Projected / month", `$${result.projectedMonthlyUsd.toFixed(2)}`],
                  ["Per request", `$${result.projectedPerRequestUsd.toFixed(6)}`],
                  ["Verdict", result.verdict],
                  ["Warnings", String(result.warnings.length)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded border border-rack-200 bg-rack-100/60 px-3 py-2">
                    <dt className="silkscreen text-[9px]">{label}</dt>
                    <dd className="mt-1 font-mono text-[13px] text-ivory-100">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5">
                <FactorList factors={result.factors} />
              </div>
              <div className="mt-5">
                <h3 className="silkscreen mb-2">Lane recommendation</h3>
                <ul className="space-y-1.5">
                  {result.recommendation.map((entry) => (
                    <li key={entry.tier} className="flex items-start gap-2 text-[12px] leading-relaxed">
                      <span
                        className={`jack mt-1 h-2.5 w-2.5 shrink-0 ${entry.modelId ? "jack-filled" : ""}`}
                        aria-hidden="true"
                      />
                      <span className="text-ivory-200">
                        <span className="silkscreen mr-2 text-[9px]">{TIER_META[entry.tier].label}</span>
                        {entry.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {result.warnings.length > 0 ? (
                <ul className="mt-4 space-y-1.5 rounded border border-signal-amber/35 bg-signal-amber/8 p-3">
                  {result.warnings.map((warning) => (
                    <li key={warning} className="text-[12px] leading-relaxed text-signal-amber">
                      {warning}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="silkscreen mt-4 text-[9px]">seal {result.seal.slice(0, 40)}…</p>
            </div>
          </div>
        </section>
      ) : agents.length === 0 && models.length === 0 ? (
        <EmptyState
          title="No models to compile against"
          detail="The catalog snapshot is empty. Wait for the live feed or check upstream availability."
        />
      ) : null}
    </div>
  );
}