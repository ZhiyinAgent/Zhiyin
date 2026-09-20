import { useEffect, type RefObject } from "react";

/**
 * Keeps someone's place in a conversation when the column it is in changes
 * width.
 *
 * Opening the browser takes the conversation from the full window to a third
 * of it, so every message rewraps and every height changes. A scroll position
 * is a number of pixels, and those pixels no longer describe the same
 * paragraph afterwards — the page is left somewhere the person did not put it.
 *
 * So the position remembered is not a number but a message: whichever one is
 * at the top of the view, and how far down it starts. After the width settles
 * that message is put back where it was. Someone already at the end of the
 * conversation is kept at the end instead, because the end is what they were
 * reading.
 *
 * That last part is also how the end stays in view while a turn runs. A
 * conversation grows for every reason there is — a word of an answer, a tool
 * call, an action, a question waiting to be answered — and following only the
 * ones somebody thought to list leaves the rest scrolling off the bottom. What
 * is watched here is the conversation changing at all.
 */
export function useReadingPosition(
  container: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const scroller = container.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;

    let anchor: { element: Element; offset: number } | null = null;
    let atBottom = true;
    let width = scroller.clientWidth;

    const remember = () => {
      atBottom =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
      anchor = null;
      const top = scroller.getBoundingClientRect().top;
      for (const child of scroller.children) {
        const rect = child.getBoundingClientRect();
        if (rect.bottom > top + 1) {
          anchor = { element: child, offset: rect.top - top };
          return;
        }
      }
    };

    const restore = () => {
      if (atBottom) {
        scroller.scrollTop = scroller.scrollHeight;
        return;
      }
      if (!anchor || !scroller.contains(anchor.element)) return;
      const moved =
        anchor.element.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        anchor.offset;
      if (moved) scroller.scrollTop += moved;
    };

    remember();
    scroller.addEventListener("scroll", remember, { passive: true });
    // A change of width invalidates the position; a change of height does not,
    // and is handled below as the conversation growing.
    const resizes = new ResizeObserver(() => {
      if (scroller.clientWidth === width) return;
      width = scroller.clientWidth;
      restore();
    });
    resizes.observe(scroller);
    // Anything added, removed or rewritten anywhere in the conversation. Only
    // someone who was already at the end is carried along by it.
    const changes = new MutationObserver(() => {
      if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    });
    changes.observe(scroller, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      scroller.removeEventListener("scroll", remember);
      resizes.disconnect();
      changes.disconnect();
    };
  }, [container]);
}
