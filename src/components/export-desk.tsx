"use client";

import { useMemo, useState } from "react";
import { Download, FileJson, FileText, Loader2, Trash2 } from "lucide-react";
import type { Agent, CatalogModel, EngineResult, SourceStatus } from "@/lib/types";
import { TIER_META, TIERS } from "@/lib/types";
import { buildManifest } from "@/lib/manifest";
import { VerdictBadge } from "@/components/policy-ui";
import { EmptyState } from "@/components/feedback";

/**
 * Export desk: renders the same manifest the download endpoint and MCP
 * `export_agent` tool return, then saves it as real JSON or CSV.
 */
export function ExportDesk({
  agents,
  models,
  compiledByAgent,
  catalogStatus,
  catalogFetchedAt,
  sources,
  exportedAt,
}: {
  agents: Agent[];
  models: CatalogModel[];
  compiledByAgent: Record<string, EngineResult>;
  catalogStatus: string;
  catalogFetchedAt: string;
  sources: SourceStatus[];
  /** Rendered on the server so hydration does not see a different clock. */
  exportedAt: string;
}) {
  const [selectedId, setSelectedId] = useState(agents[0]?.id ?? "");
  const [busy, setBusy] = useState<"json" | "csv" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const agent = agents.find((entry) => entry.id === selectedId) ?? null;
  const compiled = selectedId ? compiledByAgent[selectedId] : undefined;

  // Provenance comes from the server so the exported artifact states the real
  // catalog status rather than a placeholder.
const manifest = useMemo(() => {
    if (!agent || !compiled) return null;
    return buildManifest(agent, compiled, catalogStatus, catalogFetchedAt, sources, exportedAt);
  }, [agent, compiled, catalogStatus, catalogFetchedAt, sources, exportedAt]);

  const slug = (agent?.name ?? "agent")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const download = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const saveJson = () => {
    if (!manifest) return;
    setBusy("json");
    setMessage(null);
    download(`${JSON.stringify(manifest, null, 2)}\n`, `patchbay-${slug}-manifest.json`, "application/json");
    setMessage(`Saved patchbay-${slug}-manifest.json in your downloads.`);
    setBusy(null);
  };

  const saveCsv = () => {
    if (!agent || !compiled) return;
    setBusy("csv");
    setMessage(null);
    const byId = new Map(models.map((model) => [model.id, model]));
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const header = [
      "tier",
      "model_id",
      "model_name",
      "provider",
      "weight",
      "daily_requests",
      "input_usd_per_mtok",
      "output_usd_per_mtok",
      "context_tokens",
      "open_weights",
    ];
    const rows = TIERS.map((tier) => {
      const lane = agent.lanes.find((entry) => entry.tier === tier)!;
      const model = lane.modelId ? byId.get(lane.modelId) : undefined;
      return [
        tier,
        lane.modelId ?? "",
        model?.name ?? "",
        model?.providerLabel ?? "",
        String(lane.weight),
        String(lane.dailyRequests),
        model ? String(model.inputPerMTok) : "",
        model ? String(model.outputPerMTok) : "",
        model ? String(model.contextTokens) : "",
        model ? String(model.openWeights) : "",
      ]
        .map(escape)
        .join(",");
    });
    const footer = [
      "TOTAL",
      "",
      "",
      "",
      "",
      "",
      `score=${compiled.score}`,
      `verdict=${compiled.verdict}`,
      `projected_monthly_usd=${compiled.projectedMonthlyUsd}`,
      `seal=${agent.seal}`,
    ]
      .map(escape)
      .join(",");
    download(`${[header.join(","), ...rows, footer].join("\n")}\n`, `patchbay-${slug}-lanes.csv`, "text/csv");
    setMessage(`Saved patchbay-${slug}-lanes.csv with live prices and the record seal.`);
    setBusy(null);
  };

  if (agents.length === 0) {
    return (
      <EmptyState
        title="Nothing to export yet"
        detail="Create an agent and patch at least one lane. The manifest carries your lanes, the compiled score, the factors, and the seal."
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="panel p-5" role="group" aria-label="Manifest selection">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-60 flex-col gap-1.5">
            <label htmlFor="export-agent" className="silkscreen text-[9px]">
              Agent
            </label>
            <select
              id="export-agent"
              value={selectedId}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setMessage(null);
              }}
              className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[14px] text-ivory-100"
            >
              {agents.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} (rev {entry.revision})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveJson}
              disabled={!manifest || busy !== null}
              className="inline-flex items-center gap-2 rounded bg-brass-400 px-4 py-2.5 text-[14px] font-bold text-rack-000 transition hover:bg-brass-300 disabled:opacity-60"
            >
              {busy === "json" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileJson className="h-4 w-4" aria-hidden="true" />
              )}
              Save manifest JSON
            </button>
            <button
              type="button"
              onClick={saveCsv}
              disabled={!agent || !compiled || busy !== null}
              className="inline-flex items-center gap-2 rounded border border-rack-300 px-4 py-2.5 text-[14px] font-semibold text-ivory-100 transition hover:border-brass-400 disabled:opacity-60"
            >
              {busy === "csv" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileText className="h-4 w-4" aria-hidden="true" />
              )}
              Save lane CSV
            </button>
            {agent ? (
              <a
                href={`/api/agents/${agent.id}/export`}
                className="inline-flex items-center gap-2 rounded border border-brass-400/60 px-4 py-2.5 text-[13px] font-semibold text-brass-300 transition hover:bg-brass-400/15"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Server download
              </a>
            ) : null}
          </div>
        </div>
        {message ? (
          <p role="status" className="mt-4 rounded border border-signal-green/40 bg-signal-green/10 p-3 text-[12px] text-signal-green">
            {message}
          </p>
        ) : null}
      </section>

      {agent && compiled && manifest ? (
        <>
          <section className="panel p-5" aria-label="Export summary">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-ivory-100">{agent.name}</h2>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[13px] text-ivory-100">score {compiled.score}</span>
                <VerdictBadge verdict={compiled.verdict} />
              </div>
            </div>
            <ul className="mt-4 grid gap-2 sm:grid-cols-3">
              {agent.lanes.map((lane) => (
                <li key={lane.tier} className="rounded border border-rack-200 bg-rack-100/60 p-3">
                  <p className="silkscreen text-[9px]">{TIER_META[lane.tier].label}</p>
                  <p className="mt-1.5 font-mono text-[12px] text-ivory-100">{lane.modelId ?? "empty"}</p>
                  <p className="mt-1 text-[11px] text-ivory-400">weight {lane.weight}</p>
                </li>
              ))}
            </ul>
            <p className="silkscreen mt-4 text-[9px]">agent seal {agent.seal}</p>
          </section>

          <section className="panel p-5" aria-label="Manifest preview">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="silkscreen">Manifest preview</h2>
              <span className="silkscreen text-[9px]">{JSON.stringify(manifest).length} bytes</span>
            </div>
            <pre className="max-h-[560px] overflow-auto rounded border border-rack-200 bg-rack-000 p-3 font-mono text-[11px] leading-relaxed text-ivory-200">
              {JSON.stringify(manifest, null, 2)}
            </pre>
          </section>
        </>
      ) : null}

      <section className="panel p-5">
        <h2 className="silkscreen mb-3">What the artifact contains</h2>
        <ul className="space-y-2 text-[13px] leading-relaxed text-ivory-400">
          <li>Lane assignments with resolved model names, providers, weights, and daily request estimates.</li>
          <li>The compiled score, verdict, per-factor contributions with their measured values, and warnings.</li>
          <li>
            Catalog provenance: whether prices were live or an offline sample, when they were fetched, and which
            upstream served them.
          </li>
          <li>
            Integrity references: the chain algorithm, the genesis seal, and the current agent and compile seals.
          </li>
          <li>
            Nothing sensitive. Stored provider keys are never included — the vault is a separate surface by
            design.
          </li>
        </ul>
        <p className="mt-3 flex items-start gap-2 text-[12px] text-ivory-400">
          <Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Deleting an agent keeps its tombstone so a previously shared manifest can still be verified.
        </p>
      </section>
    </div>
  );
}