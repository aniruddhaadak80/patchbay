import type { Metadata } from "next";
import { VaultPanel } from "@/components/vault-panel";

export const metadata: Metadata = {
  title: "Credential vault",
  description:
    "Store your own provider API keys encrypted with AES-256-GCM. Values are never returned by any read endpoint.",
  alternates: { canonical: "/keys" },
};

export const dynamic = "force-dynamic";

export default function KeysPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-ivory-100">Credential vault</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ivory-200">
          Bring your own keys. Everything you store is scoped to your session or account, encrypted before it
          reaches the database, and never sent back to the browser. Patchbay runs no provider calls with them, so
          nothing here is required to use the product.
        </p>
      </header>
      <VaultPanel endpoint="/api/credentials" />
      <section className="panel p-5">
        <h2 className="silkscreen mb-3">How the encryption works</h2>
        <ul className="space-y-2 text-[13px] leading-relaxed text-ivory-400">
          <li>
            Ciphertext is AES-256-GCM with a random 12-byte IV per key, and the auth tag is stored alongside it so
            tampering fails closed.
          </li>
          <li>
            The encryption key is derived with SHA-256 from <code className="font-mono text-brass-300">CREDENTIAL_ENCRYPTION_KEY</code>, falling back to{" "}
            <code className="font-mono text-brass-300">AUTH_SECRET</code>. Rotating either invalidates stored keys,
            which is a deliberate destroy switch.
          </li>
          <li>
            Read paths return a label, the last four characters, and a SHA-256 fingerprint of the ciphertext —
            enough to tell two keys apart, not enough to use either.
          </li>
          <li>
            Keys never enter a URL, a log line, an error envelope, or an exported manifest.
          </li>
        </ul>
      </section>
    </div>
  );
}