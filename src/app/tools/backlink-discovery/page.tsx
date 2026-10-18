export const dynamic = "force-dynamic";

import { Link2 } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { DiscoveryForm } from "./discovery-form";

export default function BacklinkDiscoveryPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Backlink discovery"
        description="Free backlink finder for any domain, yours or a competitor's. Searches DuckDuckGo, then fetches each candidate page to confirm a real link and read its anchor text and follow status. Won't match Ahrefs's index — it finds dozens, not thousands — but every link it reports, it has read. No key, no quota."
        icon={Link2}
        accent="violet"
      />
      <DiscoveryForm />
    </div>
  );
}
