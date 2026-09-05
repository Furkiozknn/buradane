"use client";

import { RefreshCw } from "lucide-react";

/**
 * Route-segment error boundary.
 *
 * This app is used outdoors, in a hurry, on bad connections - the situations
 * where an unhandled render error is most likely and a blank white page is
 * most costly. Someone standing on a street corner needs two things from a
 * crash: an honest sentence and a way to try again.
 *
 * No stack traces in the UI - they help nobody standing on that corner and
 * can leak internals - but the `digest` Next.js assigns is shown small: it
 * is meaningless to the user yet lets a bug report say "hata kodu: abc123",
 * which turns "it broke" into something findable in server logs.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-[19px] font-bold text-text">Bir şeyler ters gitti</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-text-secondary">
          Beklenmedik bir hata oluştu. Tekrar denemek çoğu zaman yeterli olur; olmazsa haritaya
          dönebilirsin.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={reset}
            className="flex h-12 items-center justify-center gap-2 rounded-xl text-[15px] font-semibold"
            style={{ background: "var(--brand)", color: "var(--brand-contrast)" }}
          >
            <RefreshCw size={16} aria-hidden />
            Tekrar dene
          </button>
          {/* A plain anchor, not next/link: if rendering is broken enough to
              land here, a full navigation that reloads the app from scratch
              is the more reliable escape than a client-side transition
              through the same tree that just threw. The lint rule below
              exists to protect prefetching on healthy pages; this page is by
              definition not one. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="flex h-12 items-center justify-center rounded-xl border border-border text-[15px] font-medium text-text"
          >
            Haritaya dön
          </a>
        </div>
        {error.digest && (
          <p className="mt-4 text-[11.5px] text-text-muted">Hata kodu: {error.digest}</p>
        )}
      </div>
    </main>
  );
}
