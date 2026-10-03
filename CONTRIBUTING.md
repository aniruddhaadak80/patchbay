# Contributing to Patchbay

Thanks for taking the time. Patchbay is small enough that a focused PR is genuinely
useful, and the test suite is fast enough to run before you open one.

## Getting set up

```bash
git clone https://github.com/aniruddhaadak80/patchbay.git
cd patchbay
npm ci
npm run dev
```

There is nothing to configure. Without `DATABASE_URL` the app runs on an embedded
Postgres (PGlite) in `.patchbay/pglite`, and the model catalog falls back to a
sealed offline sample when the upstreams are unreachable.

## Before you open a pull request

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest, deterministic unit tests
npm run build       # production build
npm run test:browser  # Playwright journey on desktop and mobile
```

`npm run verify:live -- --base-url https://<host>` runs the full HTTP proof against
a deployment: create → read-back → update → compile → MCP mutation → replay →
delete, plus route, provenance, and repository-link checks.

## Where things live

| Area | Path |
| --- | --- |
| Policy compiler | `src/lib/engine.ts` |
| Seal chain and canonical JSON | `src/lib/seal.ts` |
| Persistence adapters | `src/lib/db/client.ts` |
| Queries and ownership rules | `src/lib/db/repository.ts` |
| Schema | `src/lib/db/migrations/0001_init.sql` |
| Live catalog and normalization | `src/lib/catalog.ts` |
| Credential encryption | `src/lib/vault.ts` |
| JSON-RPC tools | `src/app/api/mcp/route.ts` |
| Shared links and metadata | `src/lib/site.ts` |

## Conventions that matter here

- **One engine.** Never recompute a score inside a component. Call
  `compilePolicy` so the UI, the REST endpoint, and the MCP tool cannot disagree.
- **One payload per event.** The audit payload written to the database must be the
  exact object that was hashed, or replay cannot reproduce the seal. In practice:
  build the payload once and use it for both.
- **No secrets in read paths.** A credential endpoint returns a label, the last
  four characters, and a fingerprint. Nothing else.
- **Scope every query.** Every read and write filters by owner id. Anonymous
  sessions are signed cookies, and the signature is verified on every request.
- **Honest data labels.** If the catalog came from the sealed sample, say so. Never
  present fallback prices as current.
- **Inputs are constrained.** Model ids reject `..` and trailing slashes; string
  fields have explicit length limits; enums are closed.

## Adding an MCP tool

1. Add a typed schema and description to `TOOLS` in `src/app/api/mcp/route.ts`.
2. Implement it in `callTool` using the repository layer, never raw SQL.
3. Mutating tools must honour the `Idempotency-Key` header.
4. Add a one-click preset in `src/components/mcp-console.tsx`.
5. Extend `scripts/verify-live.mjs` so the tool is proven against production.

## Reporting bugs

Open an issue with what you did, what you expected, and what happened. If it
involves the seal chain or persistence, include the agent id and the output of
`GET /api/verify?agentId=<id>`.
