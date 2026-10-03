import type { Metadata } from "next";
import Link from "next/link";
import { getScopeId } from "@/lib/scope";
import { listAgents } from "@/lib/db/repository";
import { EmptyState } from "@/components/feedback";
import { TIER_META } from "@/lib/types";

export const metadata: Metadata = {
  title: "Agents",
  description: "Every routing policy in this session, with lane occupancy and revision history.",
  alternates: { canonical: "/agents" },
};

export const dynamic = "force-dynamic";

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const status = params.status ?? "all";
  const q = params.q ?? "";
  const ownerId = await getScopeId();
  const { agents, total } = await listAgents(ownerId, {
    status: status === "all" ? undefined : status,
    q: q || undefined,
    limit: 50,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ivory-100">Agents</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ivory-200">
            Each agent is a routing policy with three tier lanes. Everything here belongs to your session or
            account, and every change is sealed into an audit chain.
          </p>
        </div>
        <Link
          href="/agents/new"
          className="rounded bg-brass-400 px-4 py-2.5 text-[14px] font-bold text-rack-000 transition hover:bg-brass-300"
        >
          New agent
        </Link>
      </header>

      {/* Filters live in the URL so a filtered view can be shared or reloaded. */}
      <form className="panel flex flex-wrap items-end gap-3 p-4" method="get" action="/agents">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="silkscreen text-[9px]">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="rounded border border-rack-300 bg-rack-050 px-3 py-2 text-[13px] text-ivory-100"
          >
            {["all", "draft", "active", "paused", "archived"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor="q" className="silkscreen text-[9px]">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="name or task class"
            className="rounded border border-rack-300 bg-rack-050 px-3 py-2 text-[13px] text-ivory-100 placeholder:text-ivory-400"
          />
        </div>
        <button
          type="submit"
          className="rounded border border-rack-300 px-4 py-2 text-[13px] font-semibold text-ivory-100 transition hover:border-brass-400"
        >
          Apply
        </button>
      </form>

      {agents.length === 0 ? (
        <EmptyState
          title={q || status !== "all" ? "No agents match this filter" : "No agents patched yet"}
          detail={
            q || status !== "all"
              ? "Try clearing the search or switching status back to all."
              : "Create an agent, patch models onto its tier lanes, and the compiler will price the policy."
          }
          action={
            <Link
              href="/agents/new"
              className="rounded bg-brass-400 px-4 py-2 text-[13px] font-bold text-rack-000 hover:bg-brass-300"
            >
              Create your first agent
            </Link>
          }
        />
      ) : (
        <>
          <p className="silkscreen text-[9px]">
            {agents.length} shown of {total} · filtered by {status}
            {q ? ` · search “${q}”` : ""}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {agents.map((agent) => (
              <li key={agent.id}>
                <Link href={`/agents/${agent.id}`} className="slot panel block p-5 hover:border-brass-400/70">
                  <div className="flex items-center justify-between gap-3">
                    <span className="silkscreen text-[9px]">{agent.status}</span>
                    <span className="font-mono text-[10px] text-ivory-400">
                      rev {agent.revision} · {new Date(agent.updatedAt).toISOString().slice(0, 10)}
                    </span>
                  </div>
                  <h2 className="mt-2.5 text-[16px] font-bold text-ivory-100">{agent.name}</h2>
                  <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ivory-400">
                    {agent.taskClass}
                  </p>
                  <dl className="mt-3 space-y-1">
                    {agent.lanes.map((lane) => (
                      <div key={lane.tier} className="flex items-center gap-2">
                        <span
                          className={`jack h-2.5 w-2.5 shrink-0 ${lane.modelId ? "jack-filled" : ""}`}
                          aria-hidden="true"
                        />
                        <dt className="silkscreen w-20 shrink-0 text-[9px]">
                          {TIER_META[lane.tier].label}
                        </dt>
                        <dd className="truncate font-mono text-[11px] text-ivory-200">
                          {lane.modelId ?? "empty"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="silkscreen mt-3 truncate text-[9px]">seal {agent.seal.slice(0, 24)}…</p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}