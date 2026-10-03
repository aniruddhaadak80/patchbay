/**
 * Single source of truth for product identity, navigation, and outbound URLs.
 * The shared header, mobile menu, landing CTA, and footer all read from here so
 * the repository URL is never duplicated across components.
 */

export const site = {
  name: "Patchbay",
  tagline: "Route every agent task to the model that should actually handle it",
  description:
    "Patchbay is a self-hosted agent routing patchbay. Import live model prices from OpenRouter and models.dev, patch models onto tier lanes, and compile a deterministic, sealed routing manifest you can export and own.",
  liveUrl: "https://patchbay-zeta.vercel.app",
  repoUrl: "https://github.com/aniruddhaadak80/patchbay",
  license: "MIT",
  nav: [
    { href: "/catalog", label: "Catalog" },
    { href: "/agents", label: "Agents" },
    { href: "/compile", label: "Compiler" },
    { href: "/keys", label: "Keys" },
    { href: "/agent", label: "Agent API" },
    { href: "/export", label: "Export" },
    { href: "/verify", label: "Verify" },
  ],
  footerGroups: [
    {
      title: "Product",
      links: [
        { href: "/catalog", label: "Live model catalog" },
        { href: "/agents", label: "Agent workspace" },
        { href: "/compile", label: "Policy compiler" },
        { href: "/keys", label: "Credential vault" },
      ],
    },
    {
      title: "Interfaces",
      links: [
        { href: "/agent", label: "JSON-RPC console" },
        { href: "/export", label: "Manifest export" },
        { href: "/verify", label: "Seal replay" },
        { href: "/mcp.json", label: "mcp.json" },
      ],
    },
    {
      title: "Reference",
      links: [
        { href: "/api/health", label: "Health" },
        { href: "/api/catalog", label: "Catalog API" },
        { href: "/api/agents", label: "Agents API" },
        { href: "/api/mcp", label: "MCP endpoint" },
      ],
    },
  ],
} as const;

export const repoLinkLabel = "View source";

export function absoluteUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${site.liveUrl}${path.startsWith("/") ? path : `/${path}`}`;
}