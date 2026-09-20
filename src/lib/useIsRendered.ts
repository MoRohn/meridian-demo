import { useEffect, useState, type RefObject } from "react";

/**
 * Whether an element is actually on screen, not just mounted. Tab content that is mounted inside a hidden pane (the
 * Analysis view on a phone while another view is showing) has no layout boxes; when the pane is shown, the element
 * gets a size and the observer reports it. Scrolling is deliberately ignored: a panel below the fold is still open.
 */
export function useIsRendered(ref: RefObject<HTMLElement | null>): boolean {
  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setRendered(el.getClientRects().length > 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return rendered;
}
