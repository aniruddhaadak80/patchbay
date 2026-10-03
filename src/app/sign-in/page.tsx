import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/sign-in-form";
import { getAuth } from "@/lib/auth";
import { getScopeId } from "@/lib/scope";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Create an account to keep your routing policies, or keep working anonymously.",
  alternates: { canonical: "/sign-in" },
};

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const ownerId = await getScopeId();
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user) redirect("/agents");

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-ivory-100">Sign in</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ivory-200">
          You are already working anonymously under a signed, HTTP-only scope cookie. Create a password to keep
          that work across devices — the anonymous records are adopted into your account in one transaction.
        </p>
      </header>

      <section className="panel p-6">
        <SignInForm />
        <p className="silkscreen mt-5 text-[9px]">
          current scope {ownerId.startsWith("anon_") ? "anonymous session" : ownerId}
        </p>
      </section>

      <section className="panel p-5">
        <h2 className="silkscreen mb-2">What an account changes</h2>
        <ul className="space-y-1.5 text-[13px] leading-relaxed text-ivory-400">
          <li>Rows move from the anonymous scope to your user id, along with their audit chains.</li>
          <li>Passwords are hashed by Better Auth and never stored in plain text by this app.</li>
          <li>Nothing else about the routing model, engine, or export format changes.</li>
        </ul>
      </section>
    </div>
  );
}