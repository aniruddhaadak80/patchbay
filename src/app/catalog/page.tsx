import type { Metadata } from "next";
import { SourceBadge } from "@/components/feedback";
import { getCatalog, OPENROUTER_URL, MODELSDEV_URL } from "@/lib/catalog";
import { TIERS } from "@/lib/types";

export const metadata: Metadata = {
  title: "Live model catalog",
  description:
    "Normalized model catalog with live pricing from OpenRouter and capabilities from models.dev, labelled live or offline sample.",
  alternates: { canonical: "/catalog" },
};

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const snapshot = await getCatalog();
  const providers = Array.from(new Set(snapshot.models.map((model) => model.provider))).sort();
  const capabilityCounts = snapshot.models.reduce<Record<string, number>>((acc, model) => {
    for (const capability of model.capabilities) acc[capability] = (acc[capability] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-ivory-100">Live model catalog</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ivory-200">
          Every model below is normalized into one shape: price per million input and output tokens, context
          window, and capabilities. Upstream schemas never reach the UI directly.
        </p>
      </header>

      <section className="panel p-5" aria-label="Source provenance">
        <div className="flex flex-wrap items-center gap-3">
          <SourceBadge
            status={snapshot.status}
            fetchedAt={snapshot.fetchedAt}
            itemCount={snapshot.models.length}
          />
          <span className="silkscreen text-[10px]">
            {snapshot.upstreamRecords.toLocaleString("en-US")} upstream records · {providers.length} providers
          </span>
        </div>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {snapshot.sources.map((source) => (
            <li key={source.id} className="rounded border border-rack-200 bg-rack-100/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-ivory-100">{source.name}</span>
                <span
                  className={`silkscreen text-[9px] ${source.status === "live" ? "text-signal-green" : "text-signal-amber"}`}
                >
                  {source.status}
                </span>
              </div>
              <a
                href={source.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block truncate font-mono text-[10px] text-ivory-400 underline-offset-2 hover:text-brass-300 hover:underline"
              >
                {source.homepage === OPENROUTER_URL || source.homepage === MODELSDEV_URL
                  ? source.homepage
                  : source.homepage}
              </a>
              <p className="mt-1.5 text-[11px] text-ivory-400">
                {source.itemCount.toLocaleString("en-US")} records · {source.latencyMs}ms
                {source.error ? ` · ${source.error}` : ""}
              </p>
            </li>
          ))}
        </ul>
        {snapshot.status === "fallback" ? (
          <p className="mt-4 rounded border border-signal-amber/35 bg-signal-amber/8 p-3 text-[12px] leading-relaxed text-signal-amber">
            One or both upstreams were unreachable, so these figures come from the sealed offline sample frozen on
            2026-09-30. They are shown so the interface still works, and they are not current prices.
          </p>
        ) : null}
      </section>

      <section aria-label="Capability coverage">
        <h2 className="silkscreen mb-3">Capability coverage</h2>
        <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {(["tools", "reasoning", "vision", "json", "longContext"] as const).map((capability) => (
            <li key={capability} className="panel px-4 py-3">
              <p className="silkscreen text-[9px]">{capability}</p>
              <p className="mt-1.5 font-mono text-lg text-ivory-100">
                {(capabilityCounts[capability] ?? 0).toLocaleString("en-US")}
              </p>
              <p className="text-[11px] text-ivory-400">of {snapshot.models.length.toLocaleString("en-US")} models</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Models by price">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl font-bold tracking-tight text-ivory-100">Cheapest first</h2>
          <p className="silkscreen text-[9px]">first 60 of {snapshot.models.length.toLocaleString("en-US")}</p>
        </div>
        <div className="panel mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-rack-200">
                {["Model", "Provider", "In /MTok", "Out /MTok", "Context", "Capabilities", "Weights"].map((heading) => (
                  <th key={heading} className="silkscreen px-4 py-3 text-[9px]">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshot.models.slice(0, 60).map((model) => (
                <tr key={model.id} className="border-b border-rack-100/70 last:border-0 hover:bg-rack-100/50">
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-ivory-100">{model.name}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-ivory-400">{model.id}</span>
                  </td>
                  <td className="px-4 py-2.5 text-ivory-200">{model.providerLabel}</td>
                  <td className="px-4 py-2.5 font-mono text-brass-300">${model.inputPerMTok}</td>
                  <td className="px-4 py-2.5 font-mono text-brass-300">${model.outputPerMTok}</td>
                  <td className="px-4 py-2.5 font-mono text-ivory-200">
                    {model.contextTokens > 0 ? `${(model.contextTokens / 1000).toFixed(0)}k` : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex flex-wrap gap-1">
                      {model.capabilities.slice(0, 4).map((capability) => (
                        <span
                          key={capability}
                          className="rounded border border-rack-300 px-1.5 py-0.5 text-[10px] text-ivory-200"
                        >
                          {capability}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {model.openWeights ? (
                      <span className="silkscreen text-[9px] text-signal-green">open</span>
                    ) : (
                      <span className="silkscreen text-[9px] text-ivory-400">hosted</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel p-5" aria-label="Lane guidance">
        <h2 className="silkscreen mb-3">Which lane does a model belong on?</h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {TIERS.map((tier) => (
            <li key={tier} className="rounded border border-rack-200 bg-rack-100/60 p-3">
              <p className="text-[13px] font-semibold text-ivory-100">{tier}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ivory-400">
                Target reference request: $0.0008 · context ≥{" "}
                {tier === "fast" ? "32k" : tier === "balanced" ? "128k" : "200k"}.
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-ivory-400">
          Patch a model onto a lane from any agent page; the compiler prices it there immediately.
        </p>
      </section>
    </div>
  );
}