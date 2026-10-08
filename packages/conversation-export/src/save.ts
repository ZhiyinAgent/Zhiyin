import { writeFile } from "node:fs/promises";
import type {
  ArtifactExport,
  ConversationFormat,
  WorkspaceTask,
} from "@zhiyin/contract";
import type { ExportAbout } from "./about.js";
import { conversationHtml } from "./conversation-html.js";
import { conversationJson } from "./conversation-json.js";

/** Asked for the destination at the moment of export, never before. */
export type DestinationChooser = (
  suggestedName: string,
) => Promise<string | undefined>;

export interface ConversationExport {
  /** Writes the conversation where the person chooses, as they asked for it. */
  save(
    task: WorkspaceTask,
    format: ConversationFormat,
    chooseDestination: DestinationChooser,
  ): Promise<ArtifactExport>;
}

/**
 * What an exported conversation is called: its title, in any script, reduced
 * to what every filesystem accepts.
 */
function fileName(title: string, format: ConversationFormat): string {
  const stem =
    title
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "conversation";
  return `${stem}.${format}`;
}

export function conversationExport(
  about: () => ExportAbout,
): ConversationExport {
  return {
    async save(task, format, chooseDestination) {
      const destination = await chooseDestination(fileName(task.title, format));
      if (!destination) return { status: "cancelled" };
      const contents =
        format === "html"
          ? conversationHtml(task, about())
          : conversationJson(task, about());
      try {
        await writeFile(destination, contents, "utf8");
        return { status: "saved", destination };
      } catch {
        return {
          status: "failed",
          reason:
            "The conversation could not be saved to that location. Check that the folder exists and allows changes.",
        };
      }
    },
  };
}
