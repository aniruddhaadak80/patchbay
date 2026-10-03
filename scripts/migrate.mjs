#!/usr/bin/env node
/**
 * Applies every migration in src/lib/db/migrations against the resolved adapter.
 *
 *   npm run db:migrate
 *
 * Safe to re-run: every statement is `if not exists`, and the same code path
 * already runs on cold start, so a fresh deploy self-migrates.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

/**
 * Split a migration file into single statements. Both adapters reject a
 * multi-statement string, so chunks are split on `--> statement-breakpoint` and
 * any remaining statements inside a chunk are separated on a top-level
 * semicolon, respecting quoted literals and `--` comments.
 */
function splitStatements(sqlText) {
  const stripped = sqlText
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  const out = [];
  for (const chunk of stripped.split("--> statement-breakpoint")) {
    let current = "";
    let quote = null;
    for (const char of chunk) {
      if (quote) {
        current += char;
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        current += char;
        continue;
      }
      if (char === ";") {
        if (current.trim().length > 0) out.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    if (current.trim().length > 0) out.push(current.trim());
  }
  return out;
}

const { getSql } = await import("../src/lib/db/client.ts");

const dir = join(process.cwd(), "src", "lib", "db", "migrations");
const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();

const sql = await getSql();
let applied = 0;

for (const file of files) {
  const statements = splitStatements(readFileSync(join(dir, file), "utf8"));
  for (const statement of statements) {
    await sql.query(statement);
    applied += 1;
  }
  process.stdout.write(`applied ${file} (${statements.length} statements)\n`);
}

process.stdout.write(`\n${applied} statements applied on the ${sql.adapter} adapter.\n`);