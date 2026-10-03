import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCatalog } from "@/lib/catalog";
import { getSharedAgent } from "@/lib/db/repository";
import { buildManifest, compileFor } from "@/lib/manifest";
import { ScoreDial, VerdictBadge, FactorList } from "@/components/policy-ui";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const agent = await getSharedAgent(id);
  if (!agent) return { title: "Routing policy not found", robots: { index: false, follow: false } };
  return {
    title: `${agent.name} routing manifest`,
    description: agent.taskClass,
    alternates: { canonical: `/share/${agent.id}` },
    openGraph: {
      title: `${agent.name} · ${site.name}`,
      description: agent.taskClass,
      url: `${site.liveUrl}/share/${agent.id}`,
    },
  };
}

/** Public, read-only view of a routing policy. Never exposes notes or owner id. */
export default async function SharePage({ params }: Params) {
  const { id } = await params;
  const agent = await getSharedAgent(id);
  if (!agent) notFound();

  const snapshot = await getCatalog();
  const { compiled, lanes } = compileFor(agent, snapshot.models, "share-view");
  const manifest = buildManifest(
    { ...agent, lanes },
    compiled,
    snapshot.status,
    snapshot.fetchedAt,
    snapshot.sources,
  );

  return (
    <div className="space-y-6">
      <header className="panel panel-raised p-6">
        <p className="silkscreen">Public routing manifest · read only</p>
        <h1 className="mt-2.5 text-3xl font-extrabold tracking-tight text-ivory-100">{agent.name}</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ivory-200">{agent.taskClass}</p>
        <p className="mt-3 font-mono text-[11px] text-ivory-400">
          revision {agent.revision} · budget ${agent.budgetUsd}/month ·{" "}
          {manifest.provenance.catalogStatus === "live" ? "catalog live" : "catalog offline sample"} · updated{" "}
          {agent.updatedAt.slice(0, 10)}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={`/api/agents/${agent.id}/export`}
            className="rounded bg-brass-400 px-4 py-2.5 text-[14px] font-bold text-rack-000 transition hover:bg-brass-300"
          >
            Download this manifest
          </a>
          <a
            href={site.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-rack-300 px-4 py-2.5 text-[13px] font-semibold text-ivory-100 transition hover:border-brass-400"
          >
            Star on GitHub
          </a>
        </div>
      </header>

      <section className="panel p-5" aria-label="Compiled policy">
        <div className="flex flex-col gap-5 sm:flex-row">
          <div className="flex flex-col items-center gap-2">
            <ScoreDial score={compiled.score} verdict={compiled.verdict} />
            <VerdictBadge verdict={compiled.verdict} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-ivory-100">Routing policy</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ivory-200">{compiled.verdictReason}</p>
            <div className="mt-5">
              <FactorList factors={compiled.factors} />
            </div>
          </div>
        </div>
      </section>

      <section className="panel p-5" aria-label="Manifest JSON">
        <h2 className="silkscreen mb-3">Manifest</h2>
        <pre className="max-h-[520px] overflow-auto rounded border border-rack-200 bg-rack-000 p-3 font-mono text-[11px] leading-relaxed text-ivory-200">
          {JSON.stringify(manifest, null, 2)}
        </pre>
      </section>
    </div>
  );
}