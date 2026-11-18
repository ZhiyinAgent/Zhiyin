/**
 * Each conversation's own folder of CAD studio records, in the app's data:
 * its drawings' requests, the scripts the person let run, the files its
 * builds wrote and the last margins, and any run folder Windows held on to.
 * Deleting a conversation deletes what it kept (ADR 0025), so the folder goes
 * with it. The files its builds wrote are in the workspace, which is the
 * person's, and stay.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";

export class CadConversations {
  /** `directory` is the studio's folder in the app's data. */
  constructor(private readonly directory: string) {}

  /** The conversation's own folder, made by the studio when it first keeps something. */
  folder(conversationId: string): string {
    return join(this.directory, conversationId);
  }

  /**
   * Removes the conversation's folder. Windows can hold a confined run's
   * profile for a moment after it ends, so the removal is tried again; a
   * folder still held is left rather than failing the deletion.
   */
  async forget(conversationId: string): Promise<void> {
    await rm(this.folder(conversationId), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    }).catch(() => undefined);
  }
}
