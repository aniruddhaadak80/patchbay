import Link from "next/link";
import { GithubIcon } from "./github-mark";
import { site } from "@/lib/site";

/**
 * Shared navigation. Reads the repository URL from the site config so the link
 * can never drift from the real project.
 */
export function SiteHeader() {
  return (
    // Sticky from sm up. On narrow screens the two-row header would cover a
    // large slice of the viewport and intercept taps on controls beneath it.
    <header className="z-40 border-b border-rack-200 bg-rack-050/95 backdrop-blur sm:sticky sm:top-0">
      <div className="mx-auto flex w-full max-w-[1180px] items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="relative grid h-8 w-8 place-items-center rounded border border-brass-500/60 bg-rack-150">
            <span className="jack jack-filled h-3 w-3" aria-hidden="true" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-800 font-extrabold tracking-tight text-ivory-100">
              {site.name}
            </span>
            <span className="silkscreen mt-0.5 text-[9px]">agent routing bay</span>
          </span>
        </Link>

        <nav aria-label="Primary" className="ml-auto hidden items-center gap-1 lg:flex">
          {site.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded px-2.5 py-1.5 text-[13px] font-medium text-ivory-200 transition hover:bg-rack-150 hover:text-ivory-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-3">
          <Link
            href="/sign-in"
            className="rounded border border-rack-300 px-3 py-1.5 text-[13px] font-semibold text-ivory-200 transition hover:border-brass-400 hover:text-ivory-100"
          >
            Sign in
          </Link>
          <a
            href={site.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Star on GitHub — Patchbay source code"
            className="inline-flex items-center gap-2 rounded border border-brass-400/70 bg-brass-400/10 px-3 py-1.5 text-[13px] font-semibold text-brass-300 transition hover:bg-brass-400/20"
          >
            <GithubIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Star on GitHub</span>
            <span className="sm:hidden">GitHub</span>
          </a>
          <details className="relative lg:hidden">
            <summary className="cursor-pointer list-none rounded border border-rack-300 px-3 py-1.5 text-[13px] font-semibold text-ivory-200">
              Menu
            </summary>
            <div className="panel panel-raised absolute right-0 top-11 z-50 w-56 p-2">
              <nav aria-label="Mobile" className="flex flex-col">
                {site.nav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded px-3 py-2 text-sm text-ivory-200 transition hover:bg-rack-150 hover:text-ivory-100"
                  >
                    {item.label}
                  </Link>
                ))}
                <a
                  href={site.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Star on GitHub — Patchbay source code"
                  className="mt-1 inline-flex items-center gap-2 rounded border border-brass-400/50 px-3 py-2 text-sm font-semibold text-brass-300"
                >
                  <GithubIcon className="h-4 w-4" />
                  Star on GitHub
                </a>
              </nav>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}