"use server";

import { setSubmissionStatus as base } from "@/app/link-building/actions";
import { guardAction } from "@/lib/action-guard";

type Status = "pending" | "submitted" | "live" | "rejected" | "lost";

/** Form-friendly wrapper that discards FormData. */
export async function setStatusForm(
  submissionId: number,
  status: Status,
): Promise<void> {
  await guardAction("edit");
  await base(submissionId, status);
}
