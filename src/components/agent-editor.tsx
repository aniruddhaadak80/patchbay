"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2 } from "lucide-react";
import type { Agent, AgentStatus, CatalogModel } from "@/lib/types";
import { TIER_META, TIERS } from "@/lib/types";
import { ErrorNotice } from "@/components/feedback";

/** Edits metadata fields and clears lanes. Patching happens in the Patchbay. */
export function AgentEditor({
  agent,
  models,
}: {
  agent: Agent;
  models: CatalogModel[];
}) {
  const router = useRouter();
  const [name, setName] = useState(agent.name);
  const [taskClass, setTaskClass] = useState(agent.taskClass);
  const [notes, setNotes] = useState(agent.notes);
  const [status, setStatus] = useState<AgentStatus>(agent.status);
  const [budgetUsd, setBudgetUsd] = useState(agent.budgetUsd);
  const [weights, setWeights] = useState<Record<string, number>>(
    Object.fromEntries(agent.lanes.map((lane) => [lane.tier, lane.weight])),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const dirty =
    name !== agent.name ||
    taskClass !== agent.taskClass ||
    notes !== agent.notes ||
    status !== agent.status ||
    budgetUsd !== agent.budgetUsd ||
    TIERS.some((tier) => weights[tier] !== agent.lanes.find((lane) => lane.tier === tier)?.weight);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(null);
    try {
      const response = await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          taskClass,
          notes,
          status,
          budgetUsd,
          expectedRevision: agent.revision,
          lanes: Object.fromEntries(
            TIERS.map((tier) => [tier, { weight: weights[tier] }]),
          ),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? `Save failed (HTTP ${response.status}).`);
        return;
      }
      setSaved(`Saved as revision ${payload.data.agent.revision}. Seal ${payload.data.agent.seal.slice(0, 16)}…`);
      router.refresh();
    } catch {
      setError("Network error while saving. Your last change was not persisted.");
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? `Delete failed (HTTP ${response.status}).`);
        setDeleting(false);
        return;
      }
      router.push("/agents");
      router.refresh();
    } catch {
      setError("Network error while deleting. The agent is still present.");
      setDeleting(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      {error ? <ErrorNotice title="Change rejected" detail={error} /> : null}
      {saved ? (
        <p role="status" className="rounded border border-signal-green/40 bg-signal-green/10 p-3 text-[12px] text-signal-green">
          {saved}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="edit-name" className="silkscreen text-[9px]">
            Name
          </label>
          <input
            id="edit-name"
            value={name}
            minLength={3}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
            className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[14px] text-ivory-100"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="edit-status" className="silkscreen text-[9px]">
            Status
          </label>
          <select
            id="edit-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as AgentStatus)}
            className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[14px] text-ivory-100"
          >
            {["draft", "active", "paused", "archived"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="edit-task" className="silkscreen text-[9px]">
            Task class
          </label>
          <textarea
            id="edit-task"
            value={taskClass}
            minLength={8}
            maxLength={280}
            rows={2}
            onChange={(event) => setTaskClass(event.target.value)}
            className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[14px] leading-relaxed text-ivory-100"
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="edit-notes" className="silkscreen text-[9px]">
            Notes
          </label>
          <textarea
            id="edit-notes"
            value={notes}
            maxLength={2000}
            rows={3}
            onChange={(event) => setNotes(event.target.value)}
            className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[14px] leading-relaxed text-ivory-100"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="edit-budget" className="silkscreen text-[9px]">
            Monthly budget (USD)
          </label>
          <input
            id="edit-budget"
            type="number"
            min={1}
            max={1000000}
            value={budgetUsd}
            onChange={(event) => setBudgetUsd(Number(event.target.value))}
            className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 font-mono text-[14px] text-ivory-100"
          />
        </div>
      </div>

      <fieldset className="rounded border border-rack-200 bg-rack-100/50 p-4">
        <legend className="silkscreen px-1 text-[9px]">Lane weights</legend>
        <ul className="grid gap-3 sm:grid-cols-3">
          {TIERS.map((tier) => (
            <li key={tier} className="flex flex-col gap-1.5">
              <label htmlFor={`weight-${tier}`} className="text-[12px] text-ivory-200">
                {TIER_META[tier].label}
              </label>
              <input
                id={`weight-${tier}`}
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={weights[tier]}
                onChange={(event) =>
                  setWeights((current) => ({ ...current, [tier]: Number(event.target.value) }))
                }
                className="rounded border border-rack-300 bg-rack-050 px-3 py-2 font-mono text-[13px] text-ivory-100"
              />
              <p className="text-[11px] text-ivory-400">
                patched: {agent.lanes.find((lane) => lane.tier === tier)?.modelId ?? "none"}
              </p>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !dirty}
          className="inline-flex items-center gap-2 rounded bg-brass-400 px-4 py-2.5 text-[14px] font-bold text-rack-000 transition hover:bg-brass-300 disabled:opacity-50"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {pending ? "Saving…" : dirty ? "Save changes" : "No changes"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className="inline-flex items-center gap-2 rounded border border-signal-rose/50 px-4 py-2.5 text-[14px] font-semibold text-signal-rose transition hover:bg-signal-rose/15 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {deleting ? "Deleting…" : "Delete agent"}
        </button>
        <p className="text-[11px] text-ivory-400">
          Deletion is soft: the row and its audit chain are retained so replay still verifies.
        </p>
      </div>

      {models.length === 0 ? (
        <p className="text-[12px] text-signal-amber">
          The catalog snapshot is empty, so lane pricing is unavailable right now.
        </p>
      ) : null}
    </form>
  );
}