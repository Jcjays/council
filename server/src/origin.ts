const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Council listens on loopback without authentication, so the browser's Origin
 * header is the only thing standing between a visited web page and the API.
 * Requests without an Origin (curl, scripts) are allowed; any non-loopback
 * origin is refused for mutations and for the WebSocket upgrade.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return LOOPBACK_HOSTS.has(url.hostname);
}
