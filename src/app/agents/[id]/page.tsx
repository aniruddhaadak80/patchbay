import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import { Patchbay } from "@/components/patchbay";
import { AgentEditor } from "@/components/agent-editor";
import { SourceBadge, ErrorNotice } from "@/components/feedback";
import { getCatalog } from "@/lib/catalog";
import { getAgent, listAudit, replayAgent } from "@/lib/db/repository";
import { compilePolicy } from "@/lib/engine";
import { getScopeId } from "@/lib/scope";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const ownerId = await getScopeId();
  const agent = await getAgent(ownerId, id);
  if (!agent) return { title: "Agent not found" };
  return {
    title: agent.name,
    description: `Routing policy for ${agent.name}: ${agent.taskClass}`,
    alternates: { canonical: `/agents/${agent.id}` },
    openGraph: {
      title: `${agent.name} · ${site.name}`,
      description: agent.taskClass,
      url: `${site.liveUrl}/agents/${agent.id}`,
    },
  };
}

export default async function AgentDetailPage({ params }: Params) {
  const { id } = await params;
  const ownerId = await getScopeId();
  const agent = await getAgent(ownerId, id);
  if (!agent) notFound();

  const [snapshot, events, replay] = await Promise.all([
    getCatalog(),
    listAudit(ownerId, agent.id),
    replayAgent(ownerId, agent.id),
  ]);

  const resolvedLanes = agent.lanes.map((lane) => {
    const model = lane.modelId ? snapshot.models.find((entry) => entry.id === lane.modelId) : undefined;
    return {
      ...lane,
      modelLabel: model?.name ?? null,
      provider: model?.provider ?? null,
    };
  });

  const compiled = compilePolicy({
    agent: { ...agent, lanes: resolvedLanes },
    models: snapshot.models,
    actor: ownerId,
  });

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] text-ivory-400">
        <Link href="/agents" className="inline-flex items-center gap-1.5 hover:text-brass-300">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Agents
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-ivory-200">{agent.name}</span>
      </nav>

      <header className="panel panel-raised p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-extrabold tracking-tight text-ivory-100">{agent.name}</h1>
              <span className="silkscreen rounded border border-rack-300 px-2 py-1 text-[9px]">{agent.status}</span>
              <SourceBadge
                status={snapshot.status}
                fetchedAt={snapshot.fetchedAt}
                itemCount={snapshot.models.length}
              />
            </div>
            <p className="mt-2.5 max-w-2xl text-[14px] leading-relaxed text-ivory-200">{agent.taskClass}</p>
            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-ivory-400">
              <span>revision {agent.revision}</span>
              <span>budget ${agent.budgetUsd}/mo</span>
              <span>created {agent.createdAt.slice(0, 10)}</span>
              <span>updated {agent.updatedAt.slice(0, 16).replace("T", " ")}</span>
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <a
              href={`/api/agents/${agent.id}/export`}
              className="inline-flex items-center justify-center gap-2 rounded bg-brass-400 px-4 py-2.5 text-[14px] font-bold text-rack-000 transition hover:bg-brass-300"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download manifest
            </a>
            <Link
              href={`/share/${agent.id}`}
              className="inline-flex items-center justify-center gap-2 rounded border border-rack-300 px-4 py-2.5 text-[13px] font-semibold text-ivory-100 transition hover:border-brass-400"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Shareable view
            </Link>
          </div>
        </div>
      </header>

      <Patchbay
        agent={{ ...agent, lanes: resolvedLanes }}
        models={snapshot.models}
        initialCompiled={compiled}
      />

      <section className="panel p-5" aria-label="Agent settings">
        <h2 className="silkscreen mb-4">Settings</h2>
        <AgentEditor agent={{ ...agent, lanes: resolvedLanes }} models={snapshot.models} />
      </section>

      <section className="panel p-5" aria-label="Audit chain">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="silkscreen">Audit chain · {events.length} events</h2>
          <span
            className={`silkscreen rounded border px-2 py-1 text-[9px] ${
              replay.ok
                ? "border-signal-green/40 bg-signal-green/10 text-signal-green"
                : "border-signal-rose/40 bg-signal-rose/10 text-signal-rose"
            }`}
          >
            {replay.ok ? `replay clean · head ${replay.headSeal.slice(0, 16)}…` : `broken at ${replay.brokenAtSeq}`}
          </span>
        </div>
        <div className="panel mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-rack-200">
                {["Seq", "Event", "Actor", "When", "Seal"].map((heading) => (
                  <th key={heading} className="silkscreen px-4 py-2.5 text-[9px]">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.seq} className="border-b border-rack-100/60 last:border-0">
                  <td className="px-4 py-2 font-mono text-ivory-400">{event.seq}</td>
                  <td className="px-4 py-2 text-ivory-100">{event.eventType}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-ivory-400">
                    {event.actor.startsWith("mcp:") ? event.actor : "owner"}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-ivory-400">
                    {event.createdAt.slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="px-4 py-2 font-mono text-[10px] text-ivory-400">{event.seal.slice(0, 20)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {replay.ok ? null : (
        <ErrorNotice title="Seal chain verification failed" detail={replay.reason ?? undefined} />
      )}
    </div>
  );
}