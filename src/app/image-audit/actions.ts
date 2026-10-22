"use server";

import { auditImages, type ImageAuditResult } from "@/lib/image-audit";
import { guardAction } from "@/lib/action-guard";

export async function runImageAudit(
  url: string,
): Promise<ImageAuditResult> {
  await guardAction("edit");
  return auditImages(url);
}
