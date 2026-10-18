import type { PolicyKind } from "@/db/enums";
import { getCurrentPolicy } from "@/lib/policies";
import { findCompany } from "@/lib/settings";

/** Renders the current published version of a policy text ({company} filled in). */
export async function PolicyPage({ kind }: { kind: PolicyKind }) {
  const [policy, company] = await Promise.all([
    getCurrentPolicy(kind),
    findCompany(),
  ]);
  const name = company?.name || "We";
  return (
    <article className="list-card mt-4 px-5 py-6">
      <h1 className="text-title1 font-bold tracking-tight">
        {policy?.title ?? "Policy"}
      </h1>
      {policy && (
        <p className="mt-1 text-footnote text-label-2">
          Version {policy.version} ·{" "}
          {new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(
            policy.effectiveFrom,
          )}
        </p>
      )}
      <div className="mt-4 whitespace-pre-line text-body">
        {policy
          ? policy.body.replaceAll("{company}", name)
          : "This policy hasn't been published yet."}
      </div>
    </article>
  );
}
