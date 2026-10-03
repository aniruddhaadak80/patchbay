"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Trash2 } from "lucide-react";
import { ErrorNotice, EmptyState } from "@/components/feedback";

interface CredentialRow {
  id: string;
  provider: string;
  label: string;
  fingerprint: string;
  last4: string;
  createdAt: string;
}

const PROVIDERS = ["openai", "anthropic", "openrouter", "groq", "google", "custom"] as const;

/**
 * BYOK vault. The key is sent once over the same origin, encrypted server-side
 * with AES-256-GCM, and never read back — the list view only ever receives the
 * label, last four characters, and a ciphertext fingerprint.
 */
export function VaultPanel({ endpoint }: { endpoint: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<CredentialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string>("openai");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        setLoadError(payload?.error?.message ?? `Could not load credentials (HTTP ${response.status}).`);
        return;
      }
      setRows(payload.data.credentials as CredentialRow[]);
    } catch {
      setLoadError("Network error while loading credentials.");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [endpoint]);

  // Initial read runs inside an async callback so no state is set synchronously
  // in the effect body.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setLoadError(payload?.error?.message ?? `Could not load credentials (HTTP ${response.status}).`);
          return;
        }
        setRows(payload.data.credentials as CredentialRow[]);
      } catch {
        if (!cancelled) setLoadError("Network error while loading credentials.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, label, secret }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setSaveError(payload?.error?.message ?? `Could not store the key (HTTP ${response.status}).`);
        return;
      }
      setSecret("");
      setLabel("");
      setSaved(`${payload.data.credential.provider} key stored as ${payload.data.credential.label}. Value not returned.`);
      await load(true);
      router.refresh();
    } catch {
      setSaveError("Network error while storing the key. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    setSaveError(null);
    try {
      const response = await fetch(`${endpoint}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) {
        setSaveError(payload?.error?.message ?? `Could not delete (HTTP ${response.status}).`);
        return;
      }
      await load(true);
    } catch {
      setSaveError("Network error while deleting. The credential is still stored.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="panel p-5" aria-label="Add a credential">
        <h2 className="silkscreen mb-1">Add a provider key</h2>
        <p className="mb-4 text-[12px] leading-relaxed text-ivory-400">
          Keys are encrypted with AES-256-GCM before they reach the database and are never returned by any read
          endpoint. Patchbay does not call providers with them; they exist so your exported manifest and your own
          runtime stay self-contained.
        </p>
        {saveError ? <ErrorNotice title="Credential operation failed" detail={saveError} /> : null}
        {saved ? (
          <p role="status" className="mb-4 rounded border border-signal-green/40 bg-signal-green/10 p-3 text-[12px] text-signal-green">
            {saved}
          </p>
        ) : null}
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-[180px_1fr_1fr_auto]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="provider" className="silkscreen text-[9px]">
              Provider
            </label>
            <select
              id="provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[14px] text-ivory-100"
            >
              {PROVIDERS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="label" className="silkscreen text-[9px]">
              Label
            </label>
            <input
              id="label"
              required
              minLength={2}
              maxLength={64}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="work key"
              className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[14px] text-ivory-100 placeholder:text-ivory-400"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="secret" className="silkscreen text-[9px]">
              Key
            </label>
            <input
              id="secret"
              required
              type="password"
              minLength={12}
              maxLength={400}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="paste your provider key"
              autoComplete="off"
              spellCheck={false}
              className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 font-mono text-[13px] text-ivory-100 placeholder:text-ivory-400"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="mt-auto inline-flex items-center justify-center gap-2 rounded bg-brass-400 px-4 py-2.5 text-[14px] font-bold text-rack-000 transition hover:bg-brass-300 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
            {saving ? "Storing…" : "Store"}
          </button>
        </form>
      </section>

      <section className="panel p-5" aria-label="Stored credentials">
        <div className="flex items-center justify-between gap-3">
          <h2 className="silkscreen">Stored credentials</h2>
          <button
            type="button"
            onClick={() => void load(true)}
            className="rounded border border-rack-300 px-3 py-1.5 text-[12px] font-semibold text-ivory-200 transition hover:border-brass-400"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-[13px] text-ivory-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading credentials…
          </p>
        ) : loadError ? (
          <div className="mt-4">
            <ErrorNotice title="Could not load credentials" detail={loadError} onRetry={() => void load(true)} />
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No keys stored"
              detail="Store your own provider keys here so your routing setup stays self-contained. Nothing is required to use Patchbay."
            />
          </div>
        ) : (
          <div className="panel mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-rack-200">
                  {["Provider", "Label", "Last 4", "Fingerprint", "Stored", ""].map((heading, index) => (
                    <th key={index} className="silkscreen px-4 py-2.5 text-[9px]">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-rack-100/60 last:border-0">
                    <td className="px-4 py-2.5 text-ivory-100">{row.provider}</td>
                    <td className="px-4 py-2.5 text-ivory-200">{row.label}</td>
                    <td className="px-4 py-2.5 font-mono text-brass-300">…{row.last4}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-ivory-400">{row.fingerprint}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-ivory-400">
                      {row.createdAt.slice(0, 10)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => void remove(row.id)}
                        disabled={deletingId === row.id}
                        className="inline-flex items-center gap-1.5 rounded border border-rack-300 px-2.5 py-1.5 text-[12px] font-semibold text-ivory-200 transition hover:border-signal-rose/60 hover:text-signal-rose disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {deletingId === row.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}