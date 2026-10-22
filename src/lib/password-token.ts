/**
 * Token = SHA-256(APP_PASSWORD + ".v1") expressed as 64-char hex.
 *
 * The cookie value is the HASH, never the raw password. If the cookie
 * ever leaks (XSS, network sniff, dumped logs), the attacker has to
 * crack a SHA-256 to recover APP_PASSWORD — not a free read.
 *
 * Lives outside proxy.ts so the login route can import it without
 * importing the request gate itself.
 */
export async function expectedToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`${password}.v1`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
