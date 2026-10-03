"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type { CatalogModel, Tier } from "@/lib/types";
import { TIER_META, TIERS } from "@/lib/types";
import { ErrorNotice } from "@/components/feedback";

/**
 * Create-agent form. Model ids are validated server-side against the live
 * catalog, so a typo cannot create an unpriceable lane.
 */
export function NewAgentForm({
  models,
  defaultName,
}: {
  models: CatalogModel[];
  defaultName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [taskClass, setTaskClass] = useState(
    "Classify inbound support tickets and route urgent ones to a human queue.",
  );
  const [budgetUsd, setBudgetUsd] = useState(120);
  const [status, setStatus] = useState("draft");
  const [lanes, setLanes] = useState<Record<Tier, { modelId: string; weight: number }>>({
    fast: { modelId: "", weight: 0.6 },
    balanced: { modelId: "", weight: 0.3 },
    deep: { modelId: "", weight: 0.1 },
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          name,
          taskClass,
          budgetUsd,
          status,
          lanes: Object.fromEntries(
            TIERS.map((tier) => [
              tier,
              {
                modelId: lanes[tier].modelId === "" ? null : lanes[tier].modelId,
                weight: lanes[tier].weight,
                dailyRequests: Math.round(lanes[tier].weight * 2000),
              },
            ]),
          ),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload?.error?.message ?? `Could not create the agent (HTTP ${response.status}).`);
        return;
      }
      router.push(`/agents/${payload.data.agent.id}`);
      router.refresh();
    } catch {
      setError("Network error while creating the agent. Retry.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {error ? <ErrorNotice title="Could not create agent" detail={error} /> : null}

      <section className="panel p-5" aria-label="Agent identity">
        <h2 className="silkscreen mb-4">Identity</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="silkscreen text-[9px]">
              Agent name
            </label>
            <input
              id="name"
              required
              minLength={3}
              maxLength={64}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[14px] text-ivory-100"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="status" className="silkscreen text-[9px]">
              Status
            </label>
            <select
              id="status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
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
            <label htmlFor="taskClass" className="silkscreen text-[9px]">
              Task class
            </label>
            <textarea
              id="taskClass"
              required
              minLength={8}
              maxLength={280}
              rows={3}
              value={taskClass}
              onChange={(event) => setTaskClass(event.target.value)}
              className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[14px] leading-relaxed text-ivory-100"
            />
            <p className="text-[11px] text-ivory-400">{taskClass.length}/280 characters.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="budget" className="silkscreen text-[9px]">
              Monthly budget (USD)
            </label>
            <input
              id="budget"
              type="number"
              min={1}
              max={1000000}
              step={1}
              value={budgetUsd}
              onChange={(event) => setBudgetUsd(Number(event.target.value))}
              className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 font-mono text-[14px] text-ivory-100"
            />
          </div>
        </div>
      </section>

      <section className="panel p-5" aria-label="Lane assignment">
        <h2 className="silkscreen mb-1">Lane assignment</h2>
        <p className="mb-4 text-[12px] text-ivory-400">
          Optional now — you can also create the agent empty and patch models afterwards from its page.
        </p>
        <ul className="space-y-3">
          {TIERS.map((tier) => (
            <li key={tier} className="rounded border border-rack-200 bg-rack-100/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-ivory-100">{TIER_META[tier].label}</p>
                  <p className="mt-0.5 text-[12px] text-ivory-400">{TIER_META[tier].blurb}</p>
                </div>
                <label className="flex items-center gap-2 text-[12px] text-ivory-200">
                  Weight
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={lanes[tier].weight}
                    onChange={(event) =>
                      setLanes((current) => ({
                        ...current,
                        [tier]: { ...current[tier], weight: Number(event.target.value) },
                      }))
                    }
                    className="w-20 rounded border border-rack-300 bg-rack-050 px-2 py-1 font-mono text-[13px] text-ivory-100"
                    aria-label={`${TIER_META[tier].label} traffic weight`}
                  />
                </label>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <select
                  value={lanes[tier].modelId}
                  onChange={(event) =>
                    setLanes((current) => ({
                      ...current,
                      [tier]: { ...current[tier], modelId: event.target.value },
                    }))
                  }
                  aria-label={`${TIER_META[tier].label} model`}
                  className="flex-1 rounded border border-rack-300 bg-rack-050 px-3 py-2 text-[13px] text-ivory-100"
                >
                  <option value="">Leave empty</option>
                  {models.slice(0, 60).map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} — ${model.inputPerMTok}/MTok
                    </option>
                  ))}
                </select>
                {lanes[tier].modelId ? (
                  <button
                    type="button"
                    onClick={() =>
                      setLanes((current) => ({ ...current, [tier]: { ...current[tier], modelId: "" } }))
                    }
                    className="rounded border border-rack-300 p-2 text-ivory-400 hover:border-signal-rose/60 hover:text-signal-rose"
                    aria-label={`Clear ${TIER_META[tier].label} model`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ivory-400">
          <Plus className="h-3 w-3" aria-hidden="true" />
          Weighted request counts are derived as weight × 2000 requests/day for the projection.
        </p>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-brass-400 px-5 py-3 text-[14px] font-bold text-rack-000 transition hover:bg-brass-300 disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create agent"}
        </button>
        <p className="text-[12px] text-ivory-400">Creates a row, revision 1, and the genesis audit event.</p>
      </div>
    </form>
  );
}