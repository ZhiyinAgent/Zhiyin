import { useEffect, type RefObject } from "react";
import { useReadingPosition } from "../conversation/index.js";
import type { WorkspaceTask } from "./workspaceState.js";

/**
 * Keeps the conversation's view with its reader: at the end when a
 * conversation is opened or the person sends a message, at the end as the
 * answer grows while they follow it, and where they were otherwise.
 */
export function useFollowedConversation(
  conversation: RefObject<HTMLDivElement | null>,
  {
    conversationId,
    task,
    compact,
  }: {
    readonly conversationId: string | null;
    readonly task: WorkspaceTask | null;
    /** Something is open beside the conversation, which narrows its column. */
    readonly compact: boolean;
  },
): void {
  // Opening or closing the browser resizes this column, which rewraps every
  // message. Where someone was reading survives that; a scroll offset in
  // pixels would not. It is also the one place that follows the end.
  const reading = useReadingPosition(conversation);
  const lastMessage = task?.messages.at(-1);

  useEffect(() => {
    reading.followEnd();
  }, [reading, conversationId]);

  useEffect(() => {
    if (lastMessage?.role === "user") reading.followEnd();
    else reading.catchUp();
    const scroller = conversation.current;
    if (!scroller || !reading.following()) return;
    // A question taller than the thread is read from its top. Following
    // the tail would scroll its heading, and at a short window the question
    // itself, out of sight above the answers.
    const question = scroller.querySelector<HTMLElement>('[aria-label="Quiz"]');
    if (question && question.offsetHeight > scroller.clientHeight - 32)
      reading.readFrom(question);
  }, [
    conversation,
    reading,
    lastMessage?.id,
    lastMessage?.role,
    lastMessage?.text,
    lastMessage?.reasoning?.text,
    task?.phase.kind,
    compact,
  ]);
}
