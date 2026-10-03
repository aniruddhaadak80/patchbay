import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, GitBranch, KeyRound, Terminal, Layers } from "lucide-react";
import { GithubIcon } from "@/components/github-mark";
import { SourceBadge } from "@/components/feedback";
import { getCatalog } from "@/lib/catalog";
import { getScopeId } from "@/lib/scope";
import { listAgents } from "@/lib/db/repository";
import { site } from "@/lib/site";
import { TIER_META, TIERS } from "@/lib/types";
import { ENGINE_VERSION } from "@/lib/engine";

export const metadata: Metadata = {
  title: "Route agent traffic to the right model, deterministically",
  description: site.description,
  alternates: { canonical: "/" },
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [snapshot, ownerId] = await Promise.all([getCatalog(), getScopeId()]);
  const { agents, total } = await listAgents(ownerId, { limit: 3 });
  const cheapest = snapshot.models[0];
  const openWeights = snapshot.models.filter((model) => model.openWeights).length;

  return (
    <div className="space-y-14">
      <section className="panel panel-raised relative overflow-hidden">
        <div className="grid gap-8 p-6 sm:p-9 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <p className="silkscreen">Agent routing bay · open source</p>
            <h1 className="engraved mt-3 text-[34px] font-extrabold leading-[1.05] tracking-tight text-ivory-100 sm:text-[44px]">
              Stop sending every task
              <br />
              to one expensive model.
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ivory-200">
              Patchbay is a routing patchbay for agent workloads. Import live model pricing from{" "}
              <span className="text-brass-300">OpenRouter</span> and{" "}
              <span className="text-brass-300">models.dev</span>, patch models onto fast / balanced / deep
              lanes, and compile a deterministic routing score with an auditable SHA-384 seal chain. Your keys
              stay in your database, encrypted.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/agents/new"
                className="inline-flex items-center gap-2 rounded bg-brass-400 px-4 py-2.5 text-[14px] font-bold text-rack-000 transition hover:bg-brass-300"
              >
                Patch your first agent
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/catalog"
                className="inline-flex items-center gap-2 rounded border border-rack-300 px-4 py-2.5 text-[14px] font-semibold text-ivory-100 transition hover:border-brass-400"
              >
                Browse {snapshot.models.length.toLocaleString("en-US")} live models
              </Link>
              <a
                href={site.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Star on GitHub — Patchbay source code"
                className="inline-flex items-center gap-2 rounded border border-brass-400/60 px-4 py-2.5 text-[14px] font-semibold text-brass-300 transition hover:bg-brass-400/15"
              >
                <GithubIcon className="h-4 w-4" />
                Star on GitHub
              </a>
            </div>
            <dl className="mt-7 flex flex-wrap gap-x-7 gap-y-3">
              {[
                ["Agents in this session", total.toString()],
                ["Priced models", snapshot.models.length.toLocaleString("en-US")],
                ["Open-weight models", openWeights.toLocaleString("en-US")],
                ["Engine", ENGINE_VERSION],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="silkscreen text-[9px]">{label}</dt>
                  <dd className="mt-1 font-mono text-[15px] text-ivory-100">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Equipment face: three live tier jacks with real prices. */}
          <div className="panel flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="silkscreen">Live rack readout</h2>
              <SourceBadge
                status={snapshot.status}
                fetchedAt={snapshot.fetchedAt}
                itemCount={snapshot.models.length}
              />
            </div>
            <ul className="space-y-2">
              {TIERS.map((tier, index) => {
                const sample = snapshot.models[index === 0 ? 0 : index === 1 ? Math.floor(snapshot.models.length / 3) : snapshot.models.length - 1];
                return (
                  <li key={tier} className="flex items-center gap-3 rounded border border-rack-200 bg-rack-050/70 px-3 py-2.5">
                    <span className="jack jack-filled h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="silkscreen block text-[9px]">{TIER_META[tier].label}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-ivory-100">
                        {sample ? sample.name : "catalog unavailable"}
                      </span>
                    </span>
                    <span className="shrink-0 text-right font-mono text-[11px] text-brass-300">
                      {sample ? `$${sample.inputPerMTok}/MTok` : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] leading-relaxed text-ivory-400">
              {snapshot.status === "live" ? (
                <>
                  Fetched {new Date(snapshot.fetchedAt).toISOString().slice(0, 16).replace("T", " ")} UTC from{" "}
                  {snapshot.sources.map((source) => source.name).join(" and ")} ·{" "}
                  {snapshot.upstreamRecords.toLocaleString("en-US")} upstream records normalized. Cheapest priced
                  model: {cheapest ? `${cheapest.name} at $${cheapest.inputPerMTok}/MTok in` : "unavailable"}.
                </>
              ) : (
                <>
                  Upstreams were unreachable, so this is the sealed offline sample frozen on 2026-09-30. Prices are
                  not current.
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="text-2xl font-bold tracking-tight text-ivory-100">
          A real loop, not a dashboard
        </h2>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ivory-200">
          Every step below is a persisted operation. Nothing on this page is decorative.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: Layers,
              title: "1. Import real models",
              body: "The catalog normalizes live OpenRouter pricing and models.dev capabilities into one shape, with attribution and a live/fallback label.",
              href: "/catalog",
              cta: "Open catalog",
            },
            {
              icon: GitBranch,
              title: "2. Create and patch",
              body: "Create an agent, then patch models onto fast / balanced / deep lanes. Each patch writes a row, a revision, and an audit event.",
              href: "/agents/new",
              cta: "New agent",
            },
            {
              icon: Terminal,
              title: "3. Compile and score",
              body: "Seven weighted factors produce a versioned score with itemized contributions, warnings, and a recommendation per lane.",
              href: "/compile",
              cta: "Run the compiler",
            },
            {
              icon: KeyRound,
              title: "4. Export and verify",
              body: "Download a routing manifest, or drive the same tools over JSON-RPC. Replay the seal chain to prove nothing was rewritten.",
              href: "/export",
              cta: "Export a manifest",
            },
          ].map((item) => (
            <article key={item.title} className="panel flex flex-col gap-3 p-5">
              <span className="grid h-9 w-9 place-items-center rounded border border-brass-500/50 bg-rack-150">
                <item.icon className="h-4 w-4 text-brass-300" aria-hidden="true" />
              </span>
              <h3 className="text-[15px] font-bold text-ivory-100">{item.title}</h3>
              <p className="flex-1 text-[13px] leading-relaxed text-ivory-400">{item.body}</p>
              <Link
                href={item.href}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-brass-300 hover:underline"
              >
                {item.cta}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
      </section>

      {agents.length > 0 ? (
        <section aria-labelledby="recent">
          <div className="flex items-end justify-between gap-3">
            <h2 id="recent" className="text-2xl font-bold tracking-tight text-ivory-100">
              Your workspace
            </h2>
            <Link href="/agents" className="text-[13px] font-semibold text-brass-300 hover:underline">
              View all {total}
            </Link>
          </div>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <li key={agent.id}>
                <Link href={`/agents/${agent.id}`} className="slot panel block p-4 hover:border-brass-400/70">
                  <div className="flex items-center justify-between gap-2">
                    <span className="silkscreen text-[9px]">{agent.status}</span>
                    <span className="font-mono text-[10px] text-ivory-400">rev {agent.revision}</span>
                  </div>
                  <h3 className="mt-2 text-[15px] font-bold text-ivory-100">{agent.name}</h3>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ivory-400">{agent.taskClass}</p>
                  <div className="mt-3 flex gap-1.5">
                    {agent.lanes.map((lane) => (
                      <span
                        key={lane.tier}
                        title={`${TIER_META[lane.tier].label}: ${lane.modelId ?? "empty"}`}
                        className={`jack h-3 w-3 ${lane.modelId ? "jack-filled" : ""}`}
                        aria-label={`${TIER_META[lane.tier].label}: ${lane.modelId ? "patched" : "empty"}`}
                      />
                    ))}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="honest">
        <h2 id="honest" className="text-2xl font-bold tracking-tight text-ivory-100">
          What this is honest about
        </h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {[
            [
              "Prices are reference data",
              "Catalog numbers come from OpenRouter and models.dev as fetched. They are not quotes, and your negotiated rate may differ.",
            ],
            [
              "Stored keys stay yours",
              "Provider keys are encrypted with AES-256-GCM before they reach the database and are never returned by any read endpoint. Rotating the encryption secret invalidates them.",
            ],
            [
              "The score is a model, not a benchmark",
              `${ENGINE_VERSION} is a transparent weighted rubric over your lane assignment. It has no knowledge of your prompts, and it does not run your traffic.`,
            ],
          ].map(([title, body]) => (
            <div key={title} className="panel p-5">
              <h3 className="text-[14px] font-bold text-ivory-100">{title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ivory-400">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}