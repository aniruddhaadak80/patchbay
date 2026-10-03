/**
 * BYOK credential vault.
 *
 * Users paste their own provider API keys. Keys are encrypted with AES-256-GCM
 * before they touch the database and are never returned by any read path: the
 * API exposes only a label, the last four characters, and a SHA-256 fingerprint
 * of the ciphertext, which is enough to tell two keys apart without revealing
 * either.
 *
 * The encryption key comes from AUTH_SECRET so one secret protects both sessions
 * and stored credentials; rotating it invalidates stored keys, which is stated
 * in the README.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function vaultKey(): Buffer {
  const source =
    process.env.CREDENTIAL_ENCRYPTION_KEY ?? process.env.AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (source && source.length >= 16) return createHash("sha256").update(`patchbay:vault:v1:${source}`).digest();
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY (or AUTH_SECRET) must be set to store provider keys in production.",
    );
  }
  return createHash("sha256").update("patchbay-local-development-vault-key").digest();
}

export interface SealedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  fingerprint: string;
  last4: string;
}

export function sealSecret(plaintext: string): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", vaultKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    fingerprint: createHash("sha256").update(ciphertext).digest("hex").slice(0, 16),
    last4: plaintext.slice(-4),
  };
}

export function openSecret(sealed: { ciphertext: string; iv: string; authTag: string }): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    vaultKey(),
    Buffer.from(sealed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Structural validation of a pasted key. Never echoes the value. */
export function validateSecretFormat(provider: string, secret: string): string | null {
  if (typeof secret !== "string") return "Key must be text.";
  const trimmed = secret.trim();
  if (trimmed.length < 12) return "Key looks too short to be a real provider key.";
  if (trimmed.length > 400) return "Key is longer than any provider key; check for pasted whitespace.";
  if (/\s/.test(trimmed)) return "Key contains whitespace. Paste the raw key with no spaces or line breaks.";
  // `sk-ant-` is Anthropic's format, so it must not satisfy the OpenAI rule.
  if (provider === "openai" && !/^sk-(?!ant-)/.test(trimmed)) return "OpenAI keys start with sk- and are not Anthropic keys.";
  if (provider === "anthropic" && !trimmed.startsWith("sk-ant-")) return "Anthropic keys start with sk-ant-.";
  if (provider === "openrouter" && !/^sk-or-v1-/.test(trimmed)) return "OpenRouter keys start with sk-or-v1-.";
  if (provider === "groq" && !trimmed.startsWith("gsk_")) return "Groq keys start with gsk_.";
  return null;
}

export const SUPPORTED_PROVIDERS = ["openai", "anthropic", "openrouter", "groq", "google", "custom"] as const;
export type VaultProvider = (typeof SUPPORTED_PROVIDERS)[number];