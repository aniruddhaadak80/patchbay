"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ErrorNotice } from "@/components/feedback";

type Mode = "sign-up" | "sign-in";

/**
 * Auth form. On successful sign-up it calls /api/session/adopt so the records
 * created under the anonymous scope cookie move into the new account before the
 * user is sent to their workspace.
 */
export function SignInForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-up");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const endpoint = mode === "sign-up" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mode === "sign-up"
            ? { name: name || email.split("@")[0], email, password }
            : { email, password },
        ),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          payload?.message ??
          payload?.error?.message ??
          (mode === "sign-up" ? "Could not create the account." : "Could not sign in.");
        setError(`${message} (HTTP ${response.status})`);
        return;
      }

      if (mode === "sign-up") {
        const adopt = await fetch("/api/session/adopt", { method: "POST" });
        const adopted = await adopt.json().catch(() => null);
        const moved = adopted?.data?.adopted
          ? ` Adopted ${adopted.data.agents} agent(s) and ${adopted.data.credentials} credential(s).`
          : "";
        setNotice(`Account created.${moved} Redirecting to your workspace…`);
      }

      setPassword("");
      router.push("/agents");
      router.refresh();
    } catch {
      setError("Network error. Nothing was submitted.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? <ErrorNotice title="Authentication failed" detail={error} /> : null}
      {notice ? (
        <p role="status" className="rounded border border-signal-green/40 bg-signal-green/10 p-3 text-[12px] text-signal-green">
          {notice}
        </p>
      ) : null}

      <div className="flex gap-2">
        {(["sign-up", "sign-in"] as Mode[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={`rounded border px-3 py-2 text-[13px] font-semibold transition ${
              mode === value
                ? "border-brass-400 bg-brass-400/12 text-brass-300"
                : "border-rack-300 text-ivory-200 hover:border-rack-300"
            }`}
          >
            {value === "sign-up" ? "Create account" : "Sign in"}
          </button>
        ))}
      </div>

      {mode === "sign-up" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="auth-name" className="silkscreen text-[9px]">
            Name
          </label>
          <input
            id="auth-name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="Optional — defaults to your email local part"
            className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[14px] text-ivory-100 placeholder:text-ivory-400"
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="auth-email" className="silkscreen text-[9px]">
          Email
        </label>
        <input
          id="auth-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[14px] text-ivory-100"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="auth-password" className="silkscreen text-[9px]">
          Password
        </label>
        <input
          id="auth-password"
          type="password"
          required
          minLength={10}
          maxLength={200}
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded border border-rack-300 bg-rack-050 px-3 py-2.5 text-[14px] text-ivory-100"
        />
        <p className="text-[11px] text-ivory-400">At least 10 characters.</p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center gap-2 rounded bg-brass-400 px-4 py-2.5 text-[14px] font-bold text-rack-000 transition hover:bg-brass-300 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {pending ? "Working…" : mode === "sign-up" ? "Create account and adopt my work" : "Sign in"}
      </button>
    </form>
  );
}