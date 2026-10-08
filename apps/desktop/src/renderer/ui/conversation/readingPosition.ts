import { useEffect, useRef, useState, type RefObject } from "react";

/** What the conversation's owner may ask of the place someone is reading. */
export type ReadingPosition = {
  /** Goes to the end and follows it: a conversation opened, a message sent. */
  readonly followEnd: () => void;
  /** Goes to the end if the end is being followed. */
  readonly catchUp: () => void;
  /** Shows an element from its top and stops following: a long question. */
  readonly readFrom: (element: HTMLElement) => void;
  readonly following: () => boolean;
};

/** Within this distance of the end, someone is reading the end. */
const nearEnd = 80;
/** A scroll this soon after a wheel, a touch or a scroll key is the person's. */
const personWindow = 400;
const scrollKeys = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
  "Tab",
]);

/**
 * Keeps someone's place in a conversation when the column it is in changes
 * width, and keeps the end in view while it grows for someone reading it.
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
 *
 * Only the person moving the view stops the following. The distance to the
 * end at a scroll event cannot decide it: the event a follow causes arrives a
 * frame later, and a picture that finishes decoding in between makes the view
 * look far from the end, which would stop following with nobody having
 * scrolled. Nor does a scroll event say who moved the view: the browser
 * moves it too, to keep what is showing in place while the messages above it
 * change height — every one of them does when the column rewraps. So the
 * person is known by what they touch: a wheel, a finger, a scroll key, the
 * scrollbar.
 *
 * The conversation is not always on screen when its owner first renders — the
 * window shows a placeholder while the app loads — so the element watched is
 * whichever one the container holds after each render.
 */
export function useReadingPosition(
  container: RefObject<HTMLElement | null>,
): ReadingPosition {
  const state = useRef({ following: true, lastTop: 0 });
  const watched = useRef<{ element: HTMLElement; stop: () => void } | null>(
    null,
  );
  const [api] = useState<ReadingPosition>(() => {
    const toEnd = (scroller: HTMLElement) => {
      scroller.scrollTop = scroller.scrollHeight;
      state.current.lastTop = scroller.scrollTop;
    };
    return {
      followEnd: () => {
        state.current.following = true;
        if (container.current) toEnd(container.current);
      },
      catchUp: () => {
        if (state.current.following && container.current)
          toEnd(container.current);
      },
      readFrom: (element) => {
        const scroller = container.current;
        if (!scroller) return;
        state.current.following = false;
        scroller.scrollTop +=
          element.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          16;
        state.current.lastTop = scroller.scrollTop;
      },
      following: () => state.current.following,
    };
  });

  useEffect(() => {
    const scroller = container.current;
    if (watched.current?.element === scroller) return;
    watched.current?.stop();
    watched.current = scroller
      ? { element: scroller, stop: watch(scroller, state.current, api.catchUp) }
      : null;
  });
  useEffect(
    () => () => {
      watched.current?.stop();
      watched.current = null;
    },
    [],
  );

  return api;
}

/** Follows the end of one conversation element; returns how to stop. */
function watch(
  scroller: HTMLElement,
  position: { following: boolean; lastTop: number },
  follow: () => void,
): () => void {
  let anchor: { element: Element; offset: number } | null = null;
  let width = scroller.clientWidth;

  // The person's hand on the view: until when a scroll is theirs, and whether
  // they hold the scrollbar.
  let touchedUntil = 0;
  let holding = false;
  const touched = () => {
    touchedUntil = performance.now() + personWindow;
  };
  // A scroll key scrolls the conversation from wherever focus is, except
  // from a field being typed in, where it moves the caret instead.
  const keyed = (event: KeyboardEvent) => {
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement);
    if (scrollKeys.has(event.key) && (!typing || event.key === "Tab"))
      touched();
  };
  // The scrollbar belongs to the container itself; a press on a message
  // targets the message.
  const pressed = (event: PointerEvent) => {
    if (event.target === scroller) holding = true;
  };
  const released = () => {
    if (holding) touched();
    holding = false;
  };
  const byPerson = () => holding || performance.now() < touchedUntil;

  // The message at the top of the view, and how far below the top of the
  // view it starts. Taken again whenever the view or anything in it moves,
  // because a message above can change height without the view scrolling;
  // never while a change of width waits to be undone from the place taken
  // before it.
  const anchorTop = () => {
    if (scroller.clientWidth !== width) return;
    anchor = null;
    const viewTop = scroller.getBoundingClientRect().top;
    for (const child of scroller.children) {
      const rect = child.getBoundingClientRect();
      if (rect.bottom > viewTop + 1) {
        anchor = { element: child, offset: rect.top - viewTop };
        return;
      }
    }
  };

  const remember = () => {
    const top = scroller.scrollTop;
    const atEnd = scroller.scrollHeight - top - scroller.clientHeight < nearEnd;
    // Growth alone moves nothing: the view stays where it was set, and only
    // the end has gone further. A view that moved, is not at the end, and
    // was moved by the person's hand stops the following.
    if (atEnd) position.following = true;
    else if (top !== position.lastTop && byPerson()) position.following = false;
    position.lastTop = top;
    anchorTop();
  };

  const restore = () => {
    if (position.following) {
      follow();
      return;
    }
    if (!anchor || !scroller.contains(anchor.element)) return;
    const moved =
      anchor.element.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top -
      anchor.offset;
    if (moved) scroller.scrollTop += moved;
    position.lastTop = scroller.scrollTop;
  };

  position.following =
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <
    nearEnd;
  remember();
  scroller.addEventListener("scroll", remember, { passive: true });
  scroller.addEventListener("wheel", touched, { passive: true });
  scroller.addEventListener("touchmove", touched, { passive: true });
  window.addEventListener("keydown", keyed);
  scroller.addEventListener("pointerdown", pressed);
  window.addEventListener("pointerup", released);
  window.addEventListener("pointercancel", released);
  // A change of width invalidates the position. Any other change of size —
  // a card that was already shown growing as its details arrive, or the view
  // getting shorter because something appeared below it — adds no element and
  // fires no scroll, so it is followed here for someone at the end.
  const resizes =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(() => {
          if (scroller.clientWidth !== width) {
            width = scroller.clientWidth;
            restore();
          } else {
            follow();
            if (!position.following) anchorTop();
          }
        });
  resizes?.observe(scroller);
  for (const child of scroller.children) resizes?.observe(child);
  // Anything added, removed or rewritten anywhere in the conversation. Only
  // someone who was already at the end is carried along by it.
  const changes = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node.parentNode === scroller && node instanceof Element)
          resizes?.observe(node);
    follow();
  });
  changes.observe(scroller, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return () => {
    scroller.removeEventListener("scroll", remember);
    scroller.removeEventListener("wheel", touched);
    scroller.removeEventListener("touchmove", touched);
    window.removeEventListener("keydown", keyed);
    scroller.removeEventListener("pointerdown", pressed);
    window.removeEventListener("pointerup", released);
    window.removeEventListener("pointercancel", released);
    resizes?.disconnect();
    changes.disconnect();
  };
}
