"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plug, Unplug } from "lucide-react";
import type { Agent, CatalogModel, EngineResult, Tier } from "@/lib/types";
import { TIER_META, TIERS } from "@/lib/types";
import { ScoreDial, VerdictBadge, FactorList } from "./policy-ui";
import { ErrorNotice } from "./feedback";

/**
 * The signature interaction: a real patch bay.
 *
 * Catalog jacks sit on the left, the agent's three tier lanes sit on the right.
 * Dragging a cord from a catalog jack to a lane jack issues a real PATCH that
 * persists the assignment, then re-reads the compiled score so the cost and
 * coverage bars move because the routing actually changed.
 *
 * Click-to-patch and keyboard operation are supported: every jack is a button
 * and the lane is a labelled drop target, so the signature survives without a
 * pointer and without animation.
 */
export function Patchbay({
  agent,
  models,
  initialCompiled,
}: {
  agent: Agent;
  models: CatalogModel[];
  initialCompiled: EngineResult;
}) {
  const router = useRouter();
  const [lanes, setLanes] = useState<Agent["lanes"]>(agent.lanes);
  const [compiled, setCompiled] = useState<EngineResult>(initialCompiled);
  const [pending, setPending] = useState<Tier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const svgRef = useRef<SVGSVGElement>(null);
  const laneRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const jackRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [dragModel, setDragModel] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = field.trim().toLowerCase();
    if (!needle) return models.slice(0, 40);
    return models
      .filter((model) => `${model.id} ${model.name} ${model.providerLabel}`.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [models, field]);

  const byId = useMemo(() => new Map(models.map((model) => [model.id, model])), [models]);

  const persist = useCallback(
    async (tier: Tier, modelId: string | null) => {
      setPending(tier);
      setError(null);
      try {
        const response = await fetch(`/api/agents/${agent.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            lanes: { [tier]: { modelId } },
            expectedRevision: agent.revision,
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          setError(payload?.error?.message ?? `Could not patch the ${tier} lane (HTTP ${response.status}).`);
          return;
        }
        const nextLanes = (payload.data.agent.lanes as Agent["lanes"]).map((lane) => ({
          ...lane,
          modelLabel: lane.modelId ? (byId.get(lane.modelId)?.name ?? null) : null,
          provider: lane.modelId ? (byId.get(lane.modelId)?.provider ?? null) : null,
        }));
        setLanes(nextLanes);
        setCompiled(payload.data.compiled as EngineResult);
        const model = modelId ? byId.get(modelId) : null;
        setAnnouncement(
          model
            ? `${model.name} patched to the ${TIER_META[tier].label.toLowerCase()}. Score now ${payload.data.compiled.score}.`
            : `${TIER_META[tier].label} jack cleared. Score now ${payload.data.compiled.score}.`,
        );
        router.refresh();
      } catch {
        setError("Network error while patching. Check your connection and retry.");
      } finally {
        setPending(null);
      }
    },
    [agent.id, agent.revision, byId, router],
  );

  // --- cord geometry ------------------------------------------------------
  const [cordPaths, setCordPaths] = useState<{ tier: Tier; d: string; active: boolean }[]>([]);

  const measure = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const board = svg.parentElement;
    if (!board) return;
    const boardBox = board.getBoundingClientRect();
    const next: { tier: Tier; d: string; active: boolean }[] = [];
    for (const tier of TIERS) {
      const jackEl = jackRefs.current[tier];
      const laneEl = laneRefs.current[tier];
      if (!jackEl || !laneEl) continue;
      const a = jackEl.getBoundingClientRect();
      const b = laneEl.getBoundingClientRect();
      // Run the cord from the jack's own socket to the lane socket, so the two
      // ends are visually anchored rather than floating in the gutter.
      const x1 = a.left + 14 - boardBox.left;
      const y1 = a.top + a.height / 2 - boardBox.top;
      const x2 = b.left - boardBox.left;
      const y2 = b.top + b.height / 2 - boardBox.top;
      const curve = Math.max(60, Math.abs(x2 - x1) * 0.55);
      next.push({
        tier,
        d: `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`,
        active: Boolean((laneEl.dataset.modelId ?? "").length > 0),
      });
    }
    setCordPaths(next);
  }, []);

  // Re-measure once more after paint: the first pass can run before the list has
  // laid out, which leaves the cord layer empty.
  useEffect(() => {
    measure();
    const frame = requestAnimationFrame(measure);
    const settle = setTimeout(measure, 250);
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      window.removeEventListener("resize", onResize);
    };
  }, [measure, lanes, selected, filtered.length]);

  const patchFromKeyboard = (tier: Tier, modelId: string | null) => {
    void persist(tier, modelId);
  };

  return (
    <div className="space-y-5">
      <div className="panel panel-raised overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rack-200 px-4 py-3">
          <div>
            <h2 className="silkscreen">Patch bay</h2>
            <p className="mt-1 text-[12px] text-ivory-400">
              Drag a cord from a model jack to a lane, or select a model and press a lane button.
            </p>
          </div>
          <input
            type="search"
            value={field}
            onChange={(event) => setField(event.target.value)}
            placeholder="Filter models…"
            aria-label="Filter catalog models"
            className="w-full max-w-56 rounded border border-rack-300 bg-rack-050 px-3 py-2 text-[13px] text-ivory-100 placeholder:text-ivory-400 focus:border-brass-400 sm:w-56"
          />
        </div>

        <div className="relative grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_240px]">
          {/* Cord layer sits behind both columns, inside a fixed-height board so
              it has a box to measure against even before the list settles. */}
          <svg
            ref={svgRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 h-full w-full"
          >
            {cordPaths.map((cord) => (
              <path
                key={cord.tier}
                d={cord.d}
                className={`cord ${cord.active ? "cord-brass" : "cord-idle"}`}
                strokeWidth={cord.active ? 3 : 2}
                strokeDasharray={cord.active ? undefined : "4 5"}
                opacity={cord.active ? 0.95 : 0.6}
              />
            ))}
          </svg>

          <div className="relative min-w-0" style={{ zIndex: 1 }}>
            <h3 className="silkscreen mb-2">Catalog jacks</h3>
            <ul className="max-h-[520px] space-y-1.5 overflow-y-auto pr-1">
              {filtered.length === 0 ? (
                <li className="rounded border border-rack-200 px-3 py-6 text-center text-[13px] text-ivory-400">
                  No models match “{field}”. Clear the filter to see the full priced catalog.
                </li>
              ) : null}
              {filtered.map((model) => {
                const active = selected === model.id;
                return (
                  <li key={model.id}>
                    <button
                      type="button"
                      data-model-id={model.id}
                      ref={(node) => {
                        const tier = lanes.find((lane) => lane.modelId === model.id)?.tier;
                        if (tier && !dragModel) jackRefs.current[tier] = node;
                      }}
                      draggable
                      onDragStart={() => setDragModel(model.id)}
                      onDragEnd={() => setDragModel(null)}
                      onClick={() => setSelected(active ? null : model.id)}
                      aria-pressed={active}
                      className={`slot flex w-full items-center gap-3 rounded border px-3 py-2.5 text-left ${
                        active
                          ? "border-brass-400 bg-brass-400/10"
                          : "border-rack-200 bg-rack-100/60 hover:border-rack-300 hover:bg-rack-150"
                      }`}
                    >
                      <span
                        className={`jack h-3.5 w-3.5 shrink-0 ${dragModel === model.id ? "jack-active jack-filled" : lanes.some((lane) => lane.modelId === model.id) ? "jack-filled" : ""}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ivory-100">{model.name}</span>
                        <span className="silkscreen mt-0.5 block text-[9px]">
                          ${model.inputPerMTok}/MTok in · ${model.outputPerMTok}/MTok out ·{" "}
                          {(model.contextTokens / 1000).toFixed(0)}k ctx
                        </span>
                      </span>
                      {active ? <Plug className="h-4 w-4 shrink-0 text-brass-300" aria-hidden="true" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[11px] text-ivory-400">
              {models.length.toLocaleString("en-US")} priced models in the current snapshot.
            </p>
          </div>

          <div className="relative" style={{ zIndex: 1 }}>
            <h3 className="silkscreen mb-2">Lane jacks</h3>
            <div className="space-y-2.5">
              {lanes.map((lane) => {
                const model = lane.modelId ? byId.get(lane.modelId) : null;
                const meta = TIER_META[lane.tier];
                const busy = pending === lane.tier;
                return (
                  <div
                    key={lane.tier}
                    role="group"
                    aria-label={`${meta.label} jack`}
                    data-lane={lane.tier}
                    data-model-id={lane.modelId ?? ""}
                    className={`rounded border p-3 ${
                      dragModel ? "border-dashed border-brass-400/70 bg-brass-400/5" : "border-rack-200 bg-rack-100/60"
                    }`}
                  >
                    <p className="silkscreen text-[10px]">{meta.label}</p>
                    <p className="mt-1 text-[12px] text-ivory-400">{meta.blurb}</p>
                    <p className="mt-2 text-[12px] text-ivory-100">
                      {model ? model.name : <span className="text-ivory-400">Empty</span>}
                    </p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <button
                        type="button"
                        ref={(node) => {
                          laneRefs.current[lane.tier] = node;
                        }}
                        disabled={!selected || busy}
                        onClick={() => selected && patchFromKeyboard(lane.tier, selected)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (dragModel) patchFromKeyboard(lane.tier, dragModel);
                          setDragModel(null);
                        }}
                        className="flex items-center gap-1.5 rounded border border-rack-300 px-2.5 py-1.5 text-[12px] font-semibold text-ivory-200 transition enabled:hover:border-brass-400 enabled:hover:text-brass-300 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Plug className="h-3.5 w-3.5" aria-hidden="true" />
                        {busy ? "Patching…" : selected ? "Patch here" : "Select a model"}
                      </button>
                      <button
                        type="button"
                        disabled={!lane.modelId || busy}
                        onClick={() => patchFromKeyboard(lane.tier, null)}
                        className="inline-flex items-center gap-1.5 rounded border border-rack-300 px-2.5 py-1.5 text-[12px] font-semibold text-ivory-200 transition enabled:hover:border-signal-rose/60 enabled:hover:text-signal-rose disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Unplug className="h-3.5 w-3.5" aria-hidden="true" />
                        Clear
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {error ? <ErrorNotice title="Patch failed" detail={error} onRetry={() => setError(null)} /> : null}

      <section className="panel p-5" aria-label="Compiled policy">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex flex-col items-center gap-2">
            <ScoreDial score={compiled.score} verdict={compiled.verdict} />
            <VerdictBadge verdict={compiled.verdict} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold text-ivory-100">Compiled routing policy</h2>
              <span className="silkscreen text-[10px]">{compiled.engineVersion}</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ivory-200">{compiled.verdictReason}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Projected / month", `$${compiled.projectedMonthlyUsd.toFixed(2)}`],
                ["Per request", `$${compiled.projectedPerRequestUsd.toFixed(6)}`],
                ["Blended in", `$${compiled.blendedInputPerMTok}/MTok`],
                ["Blended out", `$${compiled.blendedOutputPerMTok}/MTok`],
              ].map(([label, value]) => (
                <div key={label} className="rounded border border-rack-200 bg-rack-100/60 px-3 py-2">
                  <dt className="silkscreen text-[9px]">{label}</dt>
                  <dd className="mt-1 font-mono text-[13px] text-ivory-100">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5">
              <FactorList factors={compiled.factors} />
            </div>
            {compiled.warnings.length > 0 ? (
              <ul className="mt-5 space-y-1.5 rounded border border-signal-amber/35 bg-signal-amber/8 p-3">
                {compiled.warnings.map((warning) => (
                  <li key={warning} className="text-[12px] leading-relaxed text-signal-amber">
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="silkscreen mt-4 text-[9px]">compile seal {compiled.seal.slice(0, 32)}…</p>
          </div>
        </div>
      </section>
    </div>
  );
}