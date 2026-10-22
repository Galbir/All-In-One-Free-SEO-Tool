"use server";

import { findBrokenLinks, type BrokenLinksResult } from "@/lib/broken-links";
import { guardAction } from "@/lib/action-guard";

export async function checkUrl(url: string): Promise<BrokenLinksResult> {
  await guardAction("edit");
  return findBrokenLinks(url);
}
