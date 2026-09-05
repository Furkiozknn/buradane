import Link from "next/link";
import { MapPin } from "lucide-react";

/**
 * 404 for routes that do not exist. Deliberately points at the map rather
 * than listing what went wrong: in this app a dead URL is almost always a
 * mistyped or truncated share link, and "here is the map, find it again" is
 * more useful than an anatomy of the failure.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm text-center">
        <MapPin size={32} aria-hidden className="mx-auto text-text-muted" />
        <h1 className="mt-3 text-[19px] font-bold text-text">Böyle bir sayfa yok</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-text-secondary">
          Aradığın adres bulunamadı — bağlantı eksik kopyalanmış ya da değişmiş olabilir.
        </p>
        <Link
          href="/"
          className="mt-5 flex h-12 items-center justify-center rounded-xl text-[15px] font-semibold"
          style={{ background: "var(--brand)", color: "var(--brand-contrast)" }}
        >
          Haritaya dön
        </Link>
      </div>
    </main>
  );
}
