/**
 * The server's best guess at "is this a desktop-class screen?", from request
 * headers only. It exists to pick the first paint's layout (sidebar or bottom
 * sheet) so the page does not visibly jump once the client measures the real
 * viewport - see useMediaQuery's `serverGuess`. It is a guess: the client's
 * matchMedia always has the last word, so being wrong is a one-frame jump,
 * never a wrong layout.
 */

interface HeaderReader {
  get(name: string): string | null;
}

export function looksLikeDesktop(headers: HeaderReader): boolean {
  // Client hint sent by Chromium browsers: "?1" is a phone, "?0" is not.
  const hint = headers.get("sec-ch-ua-mobile");
  if (hint === "?1") return false;
  if (hint === "?0") return true;

  const ua = headers.get("user-agent");
  // No evidence either way keeps the old behaviour (phone layout first).
  if (!ua) return false;
  return !/Mobi|Android|iPhone|iPad|iPod|Tablet/i.test(ua);
}
