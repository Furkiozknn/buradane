"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * The four obligations a modal dialog owes a keyboard user.
 *
 * Three of them - Escape closes, focus moves in on open, and the ARIA that
 * says so - were already implemented, identically, in four components. The
 * other two were missing everywhere:
 *
 *  - **Tab stayed inside.** Every dialog here declares `aria-modal="true"`,
 *    which tells a screen reader the rest of the page is inert. Nothing
 *    made it true for the Tab key: from the report dialog, Tab walked out
 *    of the overlay and into the ~200 result cards behind it, with the
 *    focus ring invisible under a 45%-black scrim. The user could not see
 *    where they were and Escape was the only way back.
 *  - **Focus came back.** On close, focus fell to `<body>`, so the next Tab
 *    restarted at the top of the document rather than at the button the
 *    person had just pressed. In a list of 200 cards that means finding
 *    your place again by hand.
 *
 * The trap is implemented with a keydown wrap rather than `inert` on the
 * background because these dialogs render inside the app tree, not through
 * a portal - there is no single "everything else" element to mark. Wrapping
 * Tab needs no DOM restructuring and behaves the same wherever the dialog
 * sits.
 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useModalDialog(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  // Captured in a ref rather than read at cleanup time: by then the element
  // may be gone from the document, and `document.activeElement` is already
  // <body>.
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      // Recomputed per keypress, not cached on open: these dialogs change
      // shape while open - the city picker swaps its province list for a
      // district list, the report dialog reveals a note field once a reason
      // is picked - and a list captured at mount would trap focus on
      // controls that no longer exist.
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        // offsetParent is null for anything display:none. A hidden control
        // in the tab ring is a stop where the focus ring vanishes.
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) {
        // Nothing to land on: keep focus on the dialog itself rather than
        // letting it escape to the page behind.
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // The wrap. `dialog.contains(active)` also covers the dialog element
      // itself, which holds focus on open before the user has tabbed.
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(active)) {
        // Focus already escaped somehow (a click on the scrim, a control
        // that removed itself). Pull it back rather than leaving the user
        // behind the overlay.
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Only if the opener is still in the document and still focusable -
      // the report dialog can be opened from a card that a refreshed query
      // has since replaced, and focusing a detached node silently does
      // nothing while leaving focus on <body>.
      const back = opener.current;
      if (back && back.isConnected) back.focus();
    };
  }, [dialogRef, onClose]);
}
