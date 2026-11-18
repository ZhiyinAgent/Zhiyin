import type {
  ArtifactExport,
  ConversationFormat,
  WorkspaceTask,
} from "@zhiyin/contract";
import { replaceFile } from "@zhiyin/files";
import { fileNameFor } from "@zhiyin/text-and-names";
import type { ExportAbout } from "./about.js";
import { conversationHtml } from "./conversation-html.js";
import { conversationTrajectory } from "./conversation-trajectory.js";
import type { PictureReader } from "./trajectory-pictures.js";
import { zipArchive } from "./zip.js";

/** Asked for the destination at the moment of export, never before. */
export type DestinationChooser = (
  suggestedName: string,
) => Promise<string | undefined>;

export interface ConversationExport {
  /**
   * Writes the conversation where the person chooses, as they asked for it.
   * A trajectory takes the pictures it refers to from `readPicture`.
   */
  save(
    task: WorkspaceTask,
    format: ConversationFormat,
    chooseDestination: DestinationChooser,
    readPicture: PictureReader,
  ): Promise<ArtifactExport>;
}

/** What an exported conversation is called: its title, as a file name. */
function fileName(title: string, format: ConversationFormat): string {
  return fileNameFor(title, "conversation", format === "html" ? "html" : "zip");
}

export function conversationExport(
  about: () => ExportAbout,
): ConversationExport {
  return {
    async save(task, format, chooseDestination, readPicture) {
      const destination = await chooseDestination(fileName(task.title, format));
      if (!destination) return { status: "cancelled" };
      const contents =
        format === "html"
          ? conversationHtml(task, about())
          : await trajectoryArchive(task, about(), readPicture);
      try {
        await replaceFile(destination, contents);
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

/** The trajectory and its pictures, as one .zip. */
async function trajectoryArchive(
  task: WorkspaceTask,
  about: ExportAbout,
  readPicture: PictureReader,
): Promise<Uint8Array> {
  const { trajectory, pictures } = await conversationTrajectory(
    task,
    about,
    readPicture,
  );
  return zipArchive(
    [
      { path: "trajectory.json", data: Buffer.from(trajectory, "utf8") },
      ...pictures,
    ],
    about.exportedAt,
  );
}
