import { withoutCredentials, type WorkspaceTask } from "@zhiyin/contract";
import { leftOut, type ExportAbout } from "./about.js";

/**
 * The conversation's saved record, close to raw and never shortened, for a
 * program or another model to analyse. The header names the format, so a
 * reader knows what it is looking at when the record's shape changes.
 */
export function conversationJson(
  task: WorkspaceTask,
  about: ExportAbout,
): string {
  return JSON.stringify(
    {
      format: "zhiyin.conversation",
      app: { name: "Zhiyin", version: about.appVersion },
      exportedAt: about.exportedAt.toISOString(),
      notes: leftOut.json,
      conversation: withoutCredentials(task),
    },
    null,
    2,
  );
}
