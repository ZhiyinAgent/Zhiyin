/**
 * What fills the space beside a conversation, besides its documents: the
 * browser, and in the 3D view the scene or the parts (ADR 0021). Each comes
 * from an adapter of its own, which knows nothing of the others. Every adapter
 * has the same shape: what it is, whether a conversation has it to show, and
 * three things it reports, which the panel's one table of rules answers.
 */

import type { ThreeDContent } from "@zhiyin/contract";

export type ContentId = "browser" | ThreeDContent;

/**
 * What an adapter reports of one conversation's content: it appeared, it
 * went, or the agent used it (an action in the browser, a change to the
 * scene, a new build of the parts).
 */
export type ContentEvent = "opened" | "closed" | "used";

export type ContentFollower = (taskId: string, event: ContentEvent) => void;

export type ContentAdapter = {
  readonly id: ContentId;
  /** Whether the conversation has this content to show. */
  has(taskId: string): boolean;
  /** Says again what this conversation's content is. */
  announce(taskId: string): void;
  /**
   * After going back in a conversation: `removed` when a removed turn opened
   * this content, and whether files were put back.
   */
  wentBack(
    taskId: string,
    removed: boolean,
    files: "keep" | "restore",
  ): Promise<void>;
  /** Lets go of a conversation that no longer exists. */
  forget(taskId: string): void | Promise<void>;
  /** Stops every feed, for an app that is closing. */
  stopWatching(): void;
};
