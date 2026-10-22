import { describe, expect, it } from "vitest";
import { config } from "../proxy";

/**
 * The proxy's matcher decides which paths the login gate sees at all.
 * It used to skip "any path with a dot in it", which quietly exempted
 * every data export (/clients/export.csv, /backlinks/disavow.txt,
 * /clients/1/plan/plan.pdf) from authentication.
 */
const pattern = new RegExp(`^${config.matcher[0]}$`);
const gated = (p: string) => pattern.test(p);

describe("proxy matcher", () => {
  it("gates data exports", () => {
    for (const p of [
      "/clients/export.csv",
      "/keywords/export.csv",
      "/tasks/export.csv",
      "/backlinks/export.csv",
      "/backlinks/disavow.txt",
      "/audits/export.csv",
      "/reports/export.csv",
      "/competitors/export.csv",
      "/monitor/export.csv",
      "/outreach/export.csv",
      "/clients/1/plan/export.csv",
      "/clients/1/plan/plan.pdf",
    ]) {
      expect(gated(p), p).toBe(true);
    }
  });

  it("gates ordinary pages and APIs", () => {
    expect(gated("/")).toBe(true);
    expect(gated("/clients")).toBe(true);
    expect(gated("/api/backup")).toBe(true);
  });

  it("skips static assets", () => {
    for (const p of [
      "/_next/static/chunks/main.js",
      "/_next/image",
      "/icon-192.png",
      "/favicon.ico",
      "/sw.js",
      "/manifest.webmanifest",
      "/file.svg",
    ]) {
      expect(gated(p), p).toBe(false);
    }
  });
});
