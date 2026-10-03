# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | ✅ |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private reporting: <https://github.com/aniruddhaadak80/patchbay/security/advisories/new>

Include the affected version, reproduction steps, and impact. You can expect an
acknowledgement within 72 hours and a fix or mitigation plan within 14 days.

## Threat model

Patchbay holds two kinds of sensitive data:

1. **Routing policies** — an agent's name, task class, budget, and which models
   its lanes point at. A single owner may store many, and the share route at
   `/share/[id]` publishes one of them publicly by design.
2. **Provider API keys** — submitted by the user, encrypted before storage.

### What Patchbay does

- **Encryption at rest.** Credential keys are sealed with AES-256-GCM using a random
  12-byte IV per record, and the authentication tag is stored with the ciphertext so
  tampering fails closed. The encryption key is derived with SHA-256 from
  `CREDENTIAL_ENCRYPTION_KEY`, falling back to `AUTH_SECRET`.
- **No key material in read paths.** No endpoint returns a stored key. The list view
  exposes only a label, the last four characters, and a SHA-256 fingerprint of the
  ciphertext.
- **No key material in exports.** Routing manifests deliberately omit credentials.
  Keys never appear in a URL, a log line, an error envelope, or a screenshot in
  this repository.
- **Signed ownership.** Every record is owned by an account or by an anonymous
  scope whose id lives in an HTTP-only cookie signed with HMAC-SHA256 and verified
  with a constant-time compare. The cookie is never read from a query string, so a
  client cannot claim another visitor's scope.
- **Owner-scoped queries.** Every read and write filters by owner id. Deletion is a
  soft delete, and audit rows are never removed.
- **Tamper evidence.** Every mutation appends to a per-agent SHA-384 chain. Replay
  reports the first broken link, so a rewritten row is detectable.
- **Secret rotation is a destroy switch.** Rotating `AUTH_SECRET` or
  `CREDENTIAL_ENCRYPTION_KEY` invalidates existing scope cookies and makes stored
  provider keys undecryptable.
- **Validated input.** Model ids reject `..` and trailing slashes; names, notes, and
  labels have explicit length limits; status and capability values are closed enums;
  every query is parameterized.
- **Truthful errors.** Failures return stable error envelopes with a code and a
  message. Stack traces, environment values, and SQL are never returned.

### Known limitations

These are deliberate and documented rather than hidden.

- **Rate limiting is best-effort.** Write throttling uses an in-process counter,
  which is per-instance on serverless and resets on cold start. A high-traffic
  deployment should put a hosted limiter (Upstash, Vercel WAF, Cloudflare) in front
  of the write endpoints.
- **Anonymous scopes are not accounts.** Until someone signs up, a visitor's records
  belong to a cookie. Clearing cookies loses access. Sign-up adopts the existing
  records into the account.
- **Public share routes are intentionally public.** Anyone with the agent id can read
  a published policy. Notes and owner identity are never included. Do not put secrets
  in a task class.
- **Catalog prices are public reference data**, not quotes, and are fetched from
  OpenRouter and models.dev at runtime.
- **The vault is not a secrets manager.** Patchbay stores provider keys so a
  deployment stays self-contained. It does not rotate them, scope them, or proxy
  provider traffic.

## Verifying integrity

```bash
curl "https://<your-host>/api/verify"
curl "https://<your-host>/api/verify?agentId=<uuid>"
```

A clean run reports `ok: true` for every chain with the number of events checked.
The MCP tool `verify_integrity` does the same and additionally reports the first
broken sequence number when a chain has been tampered with.
