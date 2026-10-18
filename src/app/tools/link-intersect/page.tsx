export const dynamic = "force-dynamic";

import { GitCompareArrows } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { IntersectForm } from "./intersect-form";

export default function LinkIntersectPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Link intersect"
        description="Sites that link to your competitors and not to you — the list link building actually starts from. Each page is read once and checked against every domain at the same time, so whether a site already links to you comes from its own HTML, not from a search that might have missed it."
        icon={GitCompareArrows}
        accent="violet"
      />
      <IntersectForm />
    </div>
  );
}
