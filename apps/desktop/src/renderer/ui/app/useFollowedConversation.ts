import { useEffect, type RefObject } from "react";
import { useReadingPosition } from "../conversation/index.js";
import type { WorkspaceTask } from "./windowState.js";

/**
 * Keeps the conversation's view with its reader: at the end when a
 * conversation is opened or the person sends a message, at the end as the
 * answer grows while they follow it, and where they were otherwise. The
 * new-task page is shown from its top.
 */
export function useFollowedConversation(
  conversation: RefObject<HTMLDivElement | null>,
  {
    conversationId,
    task,
    compact,
  }: {
    readonly conversationId: string | null;
    readonly task: Pick<WorkspaceTask, "messages" | "phase"> | null;
    /** Something is open beside the conversation, which narrows its column. */
    readonly compact: boolean;
  },
): void {
  // Opening or closing the browser resizes this column, which rewraps every
  // message. Where someone was reading survives that; a scroll offset in
  // pixels would not. It is also the one place that follows the end.
  const reading = useReadingPosition(conversation);
  const lastMessage = task?.messages.at(-1);
  const newTaskPage = task === null;

  useEffect(() => {
    reading.followEnd();
  }, [reading, conversationId]);

  useEffect(() => {
    // The new-task page is read from its top, which following the end of a
    // page taller than the window, such as connecting a model, would hide.
    if (newTaskPage) {
      const page = conversation.current?.firstElementChild;
      if (page instanceof HTMLElement) reading.readFrom(page);
      return;
    }
    if (lastMessage?.role === "user") reading.followEnd();
    else reading.catchUp();
    const scroller = conversation.current;
    const question = scroller?.querySelector<HTMLElement>(
      '[aria-label="Quiz"]',
    );
    if (!scroller || !question) return;
    // A question taller than the thread is read from its top. Following
    // the tail would scroll its heading, and at a short window the question
    // itself, out of sight above the answers. Its height is known only once
    // it is drawn, which can be after this runs: an entry off screen is laid
    // out at a stand-in height until it is shown, and the window can get
    // shorter. So it is measured again whenever it or the thread changes
    // size, until it has been shown from its top or the person acts on it.
    let watching = true;
    const showFromTop = () => {
      if (!watching || !reading.following()) return;
      if (question.offsetHeight <= scroller.clientHeight - 32) return;
      watching = false;
      reading.readFrom(question);
    };
    const actedOn = () => {
      watching = false;
    };
    showFromTop();
    if (!watching || typeof ResizeObserver === "undefined") return;
    const sizes = new ResizeObserver(showFromTop);
    sizes.observe(question);
    sizes.observe(scroller);
    question.addEventListener("pointerdown", actedOn);
    question.addEventListener("keydown", actedOn);
    return () => {
      sizes.disconnect();
      question.removeEventListener("pointerdown", actedOn);
      question.removeEventListener("keydown", actedOn);
    };
  }, [
    conversation,
    reading,
    newTaskPage,
    lastMessage?.id,
    lastMessage?.role,
    lastMessage?.text,
    lastMessage?.reasoning?.text,
    task?.phase.kind,
    compact,
  ]);
}
