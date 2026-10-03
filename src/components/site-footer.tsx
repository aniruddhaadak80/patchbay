import Link from "next/link";
import { GithubIcon } from "./github-mark";
import { site } from "@/lib/site";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-rack-200 bg-rack-050">
      <div className="mx-auto w-full max-w-[1180px] px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="relative grid h-8 w-8 place-items-center rounded border border-brass-500/60 bg-rack-150">
                <span className="jack jack-filled h-3 w-3" aria-hidden="true" />
              </span>
              <span className="text-[15px] font-extrabold tracking-tight text-ivory-100">
                {site.name}
              </span>
            </div>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-ivory-400">
              A routing patchbay for agent workloads. Import real model pricing, patch tiers, compile a
              sealed manifest, and keep the keys.
            </p>
            <a
              href={site.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Star on GitHub — Patchbay source code"
              className="mt-4 inline-flex items-center gap-2 rounded border border-brass-400/70 bg-brass-400/10 px-3 py-2 text-[13px] font-semibold text-brass-300 transition hover:bg-brass-400/20"
            >
              <GithubIcon className="h-4 w-4" />
              Star on GitHub
            </a>
          </div>

          {site.footerGroups.map((group) => (
            <div key={group.title}>
              <h2 className="silkscreen">{group.title}</h2>
              <ul className="mt-3 space-y-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    {link.href.startsWith("http") ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] text-ivory-200 underline-offset-4 transition hover:text-brass-300 hover:underline"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-[13px] text-ivory-200 underline-offset-4 transition hover:text-brass-300 hover:underline"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-rack-200 pt-6 text-[12px] text-ivory-400 sm:flex-row sm:items-center sm:justify-between">
          <p>
            {year} {site.name}. {site.license} licensed. Prices are upstream reference data, not quotes.
          </p>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a
              href={site.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-brass-300"
            >
              Source
            </a>
            <a
              href={`${site.repoUrl}/issues`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-brass-300"
            >
              Issues
            </a>
            <span>Data: OpenRouter, models.dev</span>
          </p>
        </div>
      </div>
    </footer>
  );
}