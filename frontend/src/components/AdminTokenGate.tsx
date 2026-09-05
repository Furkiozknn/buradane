"use client";

import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";

import {
  ADMIN_TOKEN_CLEARED_EVENT,
  adminFetch,
  getAdminToken,
  setAdminToken,
} from "@/lib/admin-token";

type GateState = "checking" | "needs-token" | "ready";

/**
 * Wraps the admin tools and only renders them once the server has accepted
 * a token.
 *
 * The verification round-trip (GET /api/admin/auth) exists for feedback
 * quality, not security - the mutation routes verify every request on their
 * own regardless. Without it, a mistyped token would look fine until the
 * first save failed with a 401, which reads as "the app broke" rather than
 * "the token is wrong". Checking up front turns that into an immediate,
 * specific message - including the server-not-configured case, where the
 * response says the environment variable is missing rather than blaming the
 * person's token.
 *
 * This gates the TOOLS, not the page: the server-side auth on the mutation
 * routes is the actual security boundary, and hiding the controls is just
 * honest UI - a form whose every submit would 401 should not look usable.
 */
export function AdminTokenGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verifyStored(): Promise<void> {
    if (!getAdminToken()) {
      setState("needs-token");
      return;
    }
    try {
      const response = await adminFetch("/api/admin/auth");
      // adminFetch already cleared the token on a 401.
      setState(response.ok ? "ready" : "needs-token");
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? null);
      }
    } catch {
      // Network failure is not a verdict on the token; keep it and let the
      // admin retry rather than making them re-paste it.
      setState("needs-token");
      setError("Sunucuya ulaşılamadı — bağlantıyı kontrol edip tekrar deneyin.");
    }
  }

  useEffect(() => {
    // set-state-in-effect is disabled for the same reason AppShell's fetch
    // effect disables it: this effect synchronises with external systems
    // (sessionStorage, then a server round-trip), and the no-token branch
    // legitimately resolves synchronously. The cascade the rule guards
    // against cannot happen - the effect has no dependencies and runs once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void verifyStored();
    const onCleared = () => {
      setError("Oturum token'ı artık geçerli değil — yeniden girin.");
      setState("needs-token");
    };
    window.addEventListener(ADMIN_TOKEN_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(ADMIN_TOKEN_CLEARED_EVENT, onCleared);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const candidate = input.trim();
    if (!candidate) return;
    setBusy(true);
    setError(null);
    setAdminToken(candidate);
    try {
      const response = await adminFetch("/api/admin/auth");
      if (response.ok) {
        setInput("");
        setState("ready");
      } else {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Token doğrulanamadı.");
      }
    } catch {
      setError("Sunucuya ulaşılamadı — bağlantıyı kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking") {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 text-[13.5px] text-text-secondary">
        Yetki denetleniyor…
      </div>
    );
  }

  if (state === "needs-token") {
    return (
      <form
        onSubmit={submit}
        className="rounded-xl border border-border bg-surface p-4"
        aria-label="Yönetici girişi"
      >
        <div className="mb-2 flex items-center gap-2">
          <KeyRound size={16} className="text-text-secondary" aria-hidden />
          <h3 className="text-[14px] font-semibold text-text">Yönetici token&apos;ı gerekli</h3>
        </div>
        <p className="mb-3 text-[12.5px] leading-relaxed text-text-muted">
          Mekan düzenleme ve moderasyon işlemleri sunucudaki{" "}
          <code className="rounded bg-surface-sunken px-1">BURADANE_ADMIN_TOKEN</code> değeriyle
          korunuyor. Token bu sekme kapanana kadar hatırlanır, hiçbir yere gönderilmez ve
          kodda saklanmaz.
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Admin token"
            aria-label="Admin token"
            autoComplete="off"
            // 16px floor: iOS Safari zooms the page on focus below that and
            // never zooms back out - same rule as every other input here.
            className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-transparent px-3 text-[16px] outline-none focus:border-brand"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="h-11 shrink-0 rounded-lg px-4 text-[14px] font-semibold disabled:opacity-50"
            style={{ background: "var(--brand)", color: "var(--brand-contrast)" }}
          >
            {busy ? "Denetleniyor…" : "Giriş"}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-[12.5px]" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <div>
      <p className="mb-3 flex items-center gap-1.5 text-[12px] text-text-muted">
        <ShieldCheck size={13} aria-hidden style={{ color: "var(--success)" }} />
        Yönetici oturumu bu sekme için doğrulandı.
      </p>
      {children}
    </div>
  );
}
