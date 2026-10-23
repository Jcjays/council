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

/**
 * The `Host` header a browser sends must name loopback too. A page on a domain
 * whose DNS points at 127.0.0.1 counts as same-origin to the browser, so without
 * this check it could read every GET (tabs, transcripts, folder listings).
 */
export function isAllowedHost(host: string | undefined): boolean {
  if (host === undefined || host === '') return false;
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : (host.split(':')[0] ?? '');
  return LOOPBACK_HOSTS.has(hostname);
}
