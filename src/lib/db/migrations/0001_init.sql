-- Patchbay initial schema.
--
-- Part 1 of 2: the Better Auth core schema, generated from this project's auth
-- config so the column names Better Auth expects are exactly what it reads
-- (`emailVerified`, `expiresAt`, `userId`, `accountId`, `providerId`). It is
-- checked in rather than migrated at boot because an anonymous visitor may
-- touch the session tables before any auth endpoint runs.
--
-- Part 2 (below the breakpoint) is Patchbay's own product schema.
--
-- Run migrations with: npm run db:migrate
-- Check the auth schema against the current config with: npm run db:check

create table if not exists "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" boolean not null default false,
  "image" text,
  "isAnonymous" boolean not null default false,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);
--> statement-breakpoint
create table if not exists "session" (
  "id" text not null primary key,
  "expiresAt" timestamptz not null,
  "token" text not null unique,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);
--> statement-breakpoint
create table if not exists "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);
--> statement-breakpoint
create table if not exists "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);
--> statement-breakpoint
create index if not exists "session_userId_idx" on "session" ("userId");
--> statement-breakpoint
create index if not exists "account_userId_idx" on "account" ("userId");
--> statement-breakpoint
create index if not exists "verification_identifier_idx" on "verification" ("identifier");

-- Core entity: an agent routing policy with three tier lanes.
create table if not exists agents (
  id uuid primary key,
  owner_id text not null,
  name text not null,
  task_class text not null,
  notes text not null default '',
  status text not null default 'draft',
  budget_usd numeric(12,4) not null default 50,
  fast_model_id text,
  fast_weight numeric(4,3) not null default 0.6,
  fast_daily integer not null default 1500,
  balanced_model_id text,
  balanced_weight numeric(4,3) not null default 0.3,
  balanced_daily integer not null default 400,
  deep_model_id text,
  deep_weight numeric(4,3) not null default 0.1,
  deep_daily integer not null default 100,
  revision integer not null default 1,
  seal text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
--> statement-breakpoint
create unique index if not exists agents_owner_name_unique
  on agents (owner_id, lower(name)) where deleted_at is null;
--> statement-breakpoint
create index if not exists agents_owner_idx on agents (owner_id, created_at desc);
--> statement-breakpoint
create index if not exists agents_live_idx on agents (owner_id) where deleted_at is null;

-- Append-only audit trail. Rows are never updated and never deleted.
create table if not exists audit_events (
  id bigserial primary key,
  entity_id uuid not null,
  owner_id text not null,
  seq integer not null,
  event_type text not null,
  actor text not null,
  payload jsonb not null,
  prev_seal text not null,
  seal text not null,
  created_at timestamptz not null default now(),
  constraint audit_events_entity_seq_unique unique (entity_id, seq)
);
--> statement-breakpoint
create index if not exists audit_events_entity_idx on audit_events (entity_id, seq);
--> statement-breakpoint
create index if not exists audit_events_owner_idx on audit_events (owner_id, created_at desc);

-- BYOK credential records: ciphertext only, never plaintext keys.
create table if not exists credentials (
  id uuid primary key,
  owner_id text not null,
  provider text not null,
  label text not null,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  fingerprint text not null,
  last4 text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
--> statement-breakpoint
create unique index if not exists credentials_owner_provider_unique
  on credentials (owner_id, lower(provider)) where deleted_at is null;
--> statement-breakpoint
create index if not exists credentials_owner_idx on credentials (owner_id, created_at desc);

-- Idempotency ledger shared by REST and MCP mutations.
create table if not exists idempotency_keys (
  key text primary key,
  owner_id text not null,
  endpoint text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create index if not exists idempotency_owner_idx on idempotency_keys (owner_id, created_at desc);

-- Latest normalized catalog snapshot, used to serve stale data during an outage.
create table if not exists catalog_snapshots (
  id text primary key,
  status text not null,
  fetched_at timestamptz not null,
  payload jsonb not null
);
--> statement-breakpoint
create index if not exists catalog_snapshots_fetched_idx on catalog_snapshots (fetched_at desc);