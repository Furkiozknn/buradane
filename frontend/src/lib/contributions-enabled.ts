/**
 * Whether this deployment can durably accept community contributions.
 *
 * `contributions-store.ts` writes a JSON file. That is correct on a host
 * with a persistent volume and *silently wrong* on an ephemeral filesystem:
 * on a serverless platform the write succeeds, the endpoint returns 201, the
 * user sees "teşekkürler" - and the file is gone with the container. The
 * failure is invisible to every test, every health check and the user.
 *
 * Two ways this resolves, in order:
 *
 * 1. `BURADANE_CONTRIBUTIONS` - an explicit `off` (or `on`) always wins.
 * 2. Otherwise, serverless platforms are detected and default to OFF.
 *    Vercel sets `VERCEL=1` on every build and invocation. Relying on
 *    someone remembering an env var is exactly how data gets lost quietly:
 *    the safe state has to be the one you get by doing nothing.
 *
 * Anywhere else - local development, tests, a volume-backed container -
 * defaults to ON and nothing changes.
 */
function serverlessHost(): boolean {
  // Vercel and Netlify both set these unconditionally on their build and
  // runtime environments. Neither gives a route handler a disk that
  // survives the invocation.
  return Boolean(process.env.VERCEL || process.env.NETLIFY);
}

export function contributionsEnabled(): boolean {
  const bayrak = process.env.BURADANE_CONTRIBUTIONS?.trim().toLowerCase();
  if (bayrak === "off") return false;
  if (bayrak === "on") return true;
  return !serverlessHost();
}

/** Shown to the user, and in the API body, when contributions are off. */
export const CONTRIBUTIONS_OFF_MESSAGE =
  "Katkı gönderimi bu kurulumda geçici olarak kapalı: kalıcı depolama bağlanana kadar gönderdiğiniz bilgi saklanamaz. Verinizi kaybetmektense kapalı tutuyoruz.";