import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthUrl,
  GOOGLE_ADS_SCOPE,
  getGoogleClientCredentials,
  resolveRedirectUri,
} from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const creds = await getGoogleClientCredentials();
  if (!creds) {
    return NextResponse.redirect(
      new URL(
        "/settings/google?error=no-credentials",
        req.nextUrl.origin,
      ),
    );
  }
  // MUST use the same URI-derivation logic as settings/google/page.tsx.
  // Otherwise the URI we show the user (to register in Google Cloud
  // Console) diverges from the URI Google actually receives, and
  // Google rejects with "Error 400: invalid_request".
  const redirectUri = resolveRedirectUri(req);

  const popup = req.nextUrl.searchParams.get("popup") === "1";
  const clientId = req.nextUrl.searchParams.get("clientId");
  // State encodes both popup mode and target clientId so the callback
  // knows where to store the resulting tokens. Format: "popup|clientId:123"
  const stateParts: string[] = [];
  if (popup) stateParts.push("popup");
  if (clientId && /^\d+$/.test(clientId)) {
    stateParts.push(`clientId:${clientId}`);
  }
  const ads = req.nextUrl.searchParams.get("ads") === "1";
  if (ads) stateParts.push("ads");
  const url = buildAuthUrl({
    scopes: ads ? [GOOGLE_ADS_SCOPE] : undefined,
    clientId: creds.clientId,
    redirectUri,
    state: stateParts.length > 0 ? stateParts.join("|") : undefined,
  });
  return NextResponse.redirect(url);
}
