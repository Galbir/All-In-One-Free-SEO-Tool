"use server";

import { generateOgImage, type OgTemplate } from "@/lib/og-image";
import { saveToolRun } from "@/lib/tool-runs";
import { guardAction } from "@/lib/action-guard";

export type OgState =
  | { ok: true; dataUrl: string }
  | { ok: false; error: string };

export async function runOgImage(
  _prev: OgState | null,
  formData: FormData,
): Promise<OgState> {
  await guardAction("edit", formData.get("clientId"));
  const title = String(formData.get("title") ?? "").trim();
  const subtitle = String(formData.get("subtitle") ?? "").trim();
  const brand = String(formData.get("brand") ?? "").trim();
  const brandColor = String(formData.get("brandColor") ?? "#7c3aed").trim();
  const template = String(formData.get("template") ?? "gradient") as OgTemplate;
  const imageUrl = String(formData.get("imageUrl") ?? "").trim() || undefined;

  if (!title) return { ok: false, error: "Title required." };

  const r = await generateOgImage({
    title,
    subtitle: subtitle || undefined,
    brand: brand || undefined,
    brandColor,
    template,
    imageUrl,
  });

  if (!r.ok || !r.dataUrl) return { ok: false, error: r.error ?? "Generation failed" };
  // Don't persist the data URL — it can be 1 MB+. Just metadata.
  await saveToolRun({
    toolId: "og-image",
    label: `${template} · ${title.slice(0, 60)}`,
    input: { template, brand, brandColor, title, subtitle },
    result: { ok: true, dataUrlBytes: r.dataUrl.length },
  }).catch(() => undefined);
  return { ok: true, dataUrl: r.dataUrl };
}
