import { useEffect, useRef, type RefObject } from "react";

/** As long as the last line's settling runs: its delay and its length. */
const SETTLING = 500;
/** How long a conversation's words are waited for after it is opened. */
const ARRIVING = 2000;

/**
 * Opening another conversation, its words settle into place a line after
 * another, as a page does when it opens. They may arrive a moment after the
 * conversation is chosen, read from disk, and in more than one step, so for a
 * short while whatever arrives settles too. The conversation shown first, and
 * whatever arrives once one is open, appear as they are. The motion itself is
 * the stylesheet's, so it follows the person's reduced-motion setting.
 */
export function useConversationSettle(
  conversation: RefObject<HTMLElement | null>,
  conversationId: string | null,
): void {
  const shown = useRef(conversationId);
  useEffect(() => {
    if (shown.current === conversationId) return;
    shown.current = conversationId;
    const element = conversation.current;
    if (!element) return;
    // Taken off and put back, so a switch during the last one starts again.
    element.removeAttribute("data-settling");
    void element.offsetWidth;
    element.setAttribute("data-settling", "");
    const settled = () => element.removeAttribute("data-settling");
    // Ends once what is there has settled, or when nothing has come.
    let done = window.setTimeout(
      settled,
      element.children.length > 0 ? SETTLING : ARRIVING,
    );
    const watcher = new MutationObserver(() => {
      window.clearTimeout(done);
      done = window.setTimeout(settled, SETTLING);
    });
    watcher.observe(element, { childList: true });
    const waited = window.setTimeout(() => watcher.disconnect(), ARRIVING);
    return () => {
      watcher.disconnect();
      window.clearTimeout(done);
      window.clearTimeout(waited);
      settled();
    };
  }, [conversation, conversationId]);
}
