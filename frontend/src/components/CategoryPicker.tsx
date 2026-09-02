"use client";

import { CATEGORIES } from "@/lib/categories";
import type { CategorySlug } from "@/lib/types";

interface Props {
  selected: CategorySlug | null;
  onSelect: (slug: CategorySlug | null) => void;
  counts?: Record<string, number>;
}

/**
 * First-run state: a big, thumb-reachable grid answering "Ne arıyorsun?".
 * This is the app's opening move - within two seconds the user should
 * understand what the product does and be one tap from an answer, which a
 * row of small chips does not communicate on a cold start.
 */
export function CategoryGrid({ selected, onSelect, counts }: Props) {
  return (
    <div className="px-4 pb-2">
      <h2 className="mb-3 text-[15px] font-semibold text-text">Ne arıyorsun?</h2>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
        {CATEGORIES.map((category) => {
          const Icon = category.icon;
          const isSelected = selected === category.slug;
          const count = counts?.[category.slug];
          return (
            <button
              key={category.slug}
              type="button"
              onClick={() => onSelect(isSelected ? null : category.slug)}
              aria-pressed={isSelected}
              className="group flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 py-3 transition-colors"
              style={{
                borderColor: isSelected ? category.pin : "var(--border)",
                background: isSelected ? category.tint : "var(--surface)",
              }}
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{ background: isSelected ? category.pin : category.tint }}
              >
                <Icon size={19} color={isSelected ? "#FFFFFF" : category.pin} aria-hidden />
              </span>
              <span
                className="text-center text-[12px] font-medium leading-tight"
                style={{ color: isSelected ? category.onTint : "var(--text-secondary)" }}
              >
                {category.shortLabel}
              </span>
              {count !== undefined && (
                <span className="text-[10px] tabular-nums text-text-muted">{count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Steady state: the same choice compressed into a sticky, horizontally
 * scrollable row so it stays reachable while the list scrolls. Single-select
 * on purpose - painting nine categories on the map at once turns it into
 * confetti and answers no actual question.
 */
export function CategoryChips({ selected, onSelect, counts }: Props) {
  return (
    <div
      className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-1"
      role="group"
      aria-label="Kategori seçimi"
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
        className="flex h-9 shrink-0 items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors"
        style={{
          borderColor: selected === null ? "var(--brand)" : "var(--border)",
          background: selected === null ? "var(--brand)" : "var(--surface)",
          color: selected === null ? "var(--brand-contrast)" : "var(--text-secondary)",
        }}
      >
        Tümü
      </button>

      {CATEGORIES.map((category) => {
        const Icon = category.icon;
        const isSelected = selected === category.slug;
        const count = counts?.[category.slug];
        return (
          <button
            key={category.slug}
            type="button"
            onClick={() => onSelect(isSelected ? null : category.slug)}
            aria-pressed={isSelected}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors"
            style={{
              borderColor: isSelected ? category.pin : "var(--border)",
              background: isSelected ? category.tint : "var(--surface)",
              color: isSelected ? category.onTint : "var(--text-secondary)",
            }}
          >
            <Icon size={15} color={isSelected ? category.onTint : category.pin} aria-hidden />
            {category.shortLabel}
            {count !== undefined && count > 0 && (
              <span className="tabular-nums text-[11px] opacity-70">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
