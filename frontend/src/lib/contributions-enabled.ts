/**
 * Whether this deployment can durably accept community contributions.
 *
 * `contributions-store.ts` writes a JSON file. That is correct on a host
 * with a persistent volume and *silently wrong* on an ephemeral filesystem:
 * on a serverless platform the write succeeds, the endpoint returns 201, the
 * user sees "teÅŸekkÃ¼rler" - and the file is gone with the container. The
 * failure is invisible to every test, every health check and the user.
 *
 * So durability is not guessed, it is declared. `BURADANE_CONTRIBUTIONS=off`
 * turns the write path into an honest 503 that says submissions are closed,
 * instead of accepting data this deployment cannot keep.
 *
 * Default is ON: local development, tests and any volume-backed host keep
 * working untouched. Only a deployment that knows it has no durable disk
 * sets the flag.
 */
export function contributionsEnabled(): boolean {
  return process.env.BURADANE_CONTRIBUTIONS?.trim().toLowerCase() !== "off";
}

/** Shown to the user, and in the API body, when the flag is off. */
export const CONTRIBUTIONS_OFF_MESSAGE =
  "KatkÄ± gÃ¶nderimi bu kurulumda geÃ§ici olarak kapalÄ±: kalÄ±cÄ± depolama baÄŸlanana kadar gÃ¶nderdiÄŸiniz bilgi saklanamaz. Verinizi kaybetmektense kapalÄ± tutuyoruz.";