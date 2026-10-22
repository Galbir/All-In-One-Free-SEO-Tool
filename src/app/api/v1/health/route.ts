export const dynamic = "force-dynamic";

/**
 * Health probe — also doubles as the cross-install identity beacon
 * AND the discovery endpoint that the local launcher (SEO Tool.html)
 * polls to know if the server is running.
 *
 * CORS: returns `Access-Control-Allow-Origin: *` so the launcher HTML
 * — which is opened from `file://` (origin "null") — can fetch this
 * across origins. Without the header, modern browsers silently block
 * the response and the launcher never realises the server is up.
 *
 * The launcher pings `installRoot` to distinguish OUR install from
 * a sibling install of the same tool on a different folder running
 * on the same port — keeps multi-install setups sane.
 *
 * The install path and PID are only for the launchers, which call from
 * this machine. This route is public (it has to be — launchers have no
 * cookie), so a remote caller gets the liveness answer without them: an
 * absolute filesystem path is reconnaissance, not health.
 */
function corsJson(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "cache-control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

export async function GET(req: Request) {
  const base = {
    ok: true,
    service: "seo-tool",
    version: "v1",
    time: new Date().toISOString(),
  };
  // The Host header, not the request URL: Next builds the URL from the
  // bound address, which is "localhost" even for a remote caller.
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (!local) return corsJson(base);
  return corsJson({ ...base, installRoot: process.cwd(), pid: process.pid });
}

// Preflight handler — some browsers preflight even simple GETs when
// the request has unusual headers. Cheap to handle, prevents edge
// cases where the launcher's probe goes silent.
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "*",
      "access-control-max-age": "86400",
    },
  });
}
