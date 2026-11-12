/** Compare browser Origin to its HTTP request authority, not Next's internal listen address.
 * Deployment proxies must preserve Host and set X-Forwarded-Proto themselves.
 * A cross-site browser cannot choose a different Host for a credentialed request.
 */
export function isSameOriginRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true; // Non-browser callers still need a validated session.
  try {
    const parsed = new URL(origin);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== origin
    )
      return false;
    const internal = new URL(request.url);
    const forwardedProtocol = request.headers.get("x-forwarded-proto");
    const protocol =
      forwardedProtocol === "https" || forwardedProtocol === "http"
        ? `${forwardedProtocol}:`
        : internal.protocol;
    const host = request.headers.get("host") || internal.host;
    if (/[\s,/@\\?#]/.test(host)) return false;
    const publicOrigin = new URL(`${protocol}//${host}`).origin;
    return parsed.origin === publicOrigin;
  } catch {
    return false;
  }
}
