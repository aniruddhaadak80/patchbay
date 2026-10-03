import type { Metadata } from "next";
import { ExportDesk } from "@/components/export-desk";
import { getCatalog } from "@/lib/catalog";
import { listAgents } from "@/lib/db/repository";
import { compileFor } from "@/lib/manifest";
import { getScopeId } from "@/lib/scope";
import type { EngineResult } from "@/lib/types";

export const metadata: Metadata = {
  title: "Export",
  description:
    "Download a portable routing manifest as JSON or a lane price sheet as CSV, with catalog provenance and seal references.",
  alternates: { canonical: "/export" },
};

export const dynamic = "force-dynamic";

export default async function ExportPage() {
  const [snapshot, ownerId] = await Promise.all([getCatalog(), getScopeId()]);
  const { agents } = await listAgents(ownerId, { limit: 50 });

  const compiledByAgent: Record<string, EngineResult> = {};
  for (const agent of agents) {
    compiledByAgent[agent.id] = compileFor(agent, snapshot.models, ownerId).compiled;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-ivory-100">Export desk</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ivory-200">
          The takeaway artifact: a routing manifest you can commit, ship, or hand to a runtime. It contains the
          lanes, the compiled score with itemized factors, catalog provenance, and the seal chain references.
        </p>
      </header>
      <ExportDesk
        agents={agents}
        models={snapshot.models}
        compiledByAgent={compiledByAgent}
        catalogStatus={snapshot.status}
        catalogFetchedAt={snapshot.fetchedAt}
        sources={snapshot.sources}
        exportedAt={new Date().toISOString()}
      />
    </div>
  );
}