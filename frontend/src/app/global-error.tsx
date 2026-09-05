"use client";

/**
 * Last-resort boundary: renders when the ROOT layout itself throws, which
 * means globals.css and its design tokens may never have loaded. That is
 * why everything here is inline-styled with literal colors - `var(--text)`
 * could resolve to nothing on exactly the render this file exists for. The
 * two palettes follow the app's own light/dark values, switched by
 * prefers-color-scheme in a <style> tag for the same reason.
 *
 * Must render its own <html> and <body>: it replaces the failed root layout
 * rather than nesting inside it.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fafaf9",
          color: "#1c1917",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <style>{`
          @media (prefers-color-scheme: dark) {
            body { background: #0c0a09 !important; color: #fafaf9 !important; }
            .ge-sub { color: #a8a29e !important; }
            .ge-code { color: #78716c !important; }
          }
        `}</style>
        <div style={{ maxWidth: 360, padding: "0 24px", textAlign: "center" }}>
          <h1 style={{ fontSize: 19, fontWeight: 700, margin: 0 }}>Uygulama açılamadı</h1>
          <p
            className="ge-sub"
            style={{ fontSize: 14, lineHeight: 1.6, color: "#57534e", margin: "10px 0 0" }}
          >
            Beklenmedik bir hata oluştu. Sayfayı yeniden yüklemek çoğu zaman yeterli olur.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20,
              height: 48,
              width: "100%",
              borderRadius: 12,
              border: "none",
              background: "#0b6e5f",
              color: "#ffffff",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Yeniden yükle
          </button>
          {error.digest && (
            <p className="ge-code" style={{ fontSize: 11.5, color: "#78716c", marginTop: 16 }}>
              Hata kodu: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
