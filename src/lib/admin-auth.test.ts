import { describe, expect, it } from "vitest";
import { isLocalRequest } from "./admin-auth";

const req = (host?: string) =>
  new Request("http://localhost:3000/api/backup", {
    headers: host ? { host } : {},
  });

describe("isLocalRequest", () => {
  it("accepts loopback Host headers", () => {
    expect(isLocalRequest(req("localhost:3000"))).toBe(true);
    expect(isLocalRequest(req("127.0.0.1:3000"))).toBe(true);
    expect(isLocalRequest(req("[::1]:3000"))).toBe(true);
  });

  it("rejects a remote Host even though the URL says localhost", () => {
    // Next builds request.url from the bound address, so it reads
    // "localhost" for every caller; the old URL fallback let this pass.
    expect(isLocalRequest(req("192.168.1.20:3000"))).toBe(false);
    expect(isLocalRequest(req("seo.example.com"))).toBe(false);
  });

  it("falls back to the URL only when there is no Host header", () => {
    expect(isLocalRequest(req())).toBe(true);
  });
});
