const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Only Orbit's own page may call the API. Cookies don't care about ports, so a page
 * on another local port (a dev server, the preview) would otherwise ride along with
 * the session; the Origin has to match this server exactly. In development the Vite
 * server on 5173 is allowed too.
 */
export function originAllowed(origin: string | null, host: string | null, dev = process.env.ORBIT_DEV === "1") {
  if (!origin) return true;
  try {
    const o = new URL(origin);
    if (o.host === host) return true;
    return dev && LOCAL_HOSTS.test(o.host) && o.port === "5173";
  } catch {
    return false;
  }
}
