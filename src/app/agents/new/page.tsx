import type { Metadata } from "next";
import { NewAgentForm } from "@/components/new-agent-form";
import { SourceBadge } from "@/components/feedback";
import { getCatalog } from "@/lib/catalog";
import { getScopeId } from "@/lib/scope";
import { listAgents } from "@/lib/db/repository";

export const metadata: Metadata = {
  title: "New agent",
  description: "Create a routing policy with fast, balanced, and deep tier lanes.",
  alternates: { canonical: "/agents/new" },
};

export const dynamic = "force-dynamic";

function suggestName(total: number): string {
  return total === 0 ? "ticket-router" : `agent-${total + 1}`;
}

export default async function NewAgentPage() {
  const [snapshot, ownerId] = await Promise.all([getCatalog(), getScopeId()]);
  const { total } = await listAgents(ownerId, { limit: 1 });

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight text-ivory-100">New agent</h1>
          <SourceBadge
            status={snapshot.status}
            fetchedAt={snapshot.fetchedAt}
            itemCount={snapshot.models.length}
          />
        </div>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ivory-200">
          Lane model choices are validated against the {snapshot.status} catalog on submit, so a policy can never
          reference a model that cannot be priced.
        </p>
      </header>
      <NewAgentForm models={snapshot.models} defaultName={suggestName(total)} />
    </div>
  );
}