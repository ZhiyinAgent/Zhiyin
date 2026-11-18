import type { StoredPicture, WorkspaceTask } from "@zhiyin/contract";
import type { AtifContentPart } from "./atif.js";
import type { ArchivedFile } from "./zip.js";

/** Reads a kept picture by where it is stored. */
export type PictureReader = (source: string) => Promise<StoredPicture>;

/** The kinds of picture ATIF can name, and the file ending each is given. */
const endings: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** A picture the trajectory refers to, or says why it does not. */
export type PicturePart = (source: string | undefined) => AtifContentPart;

/**
 * Every picture the person attached or a tool's answer sent, read once, each
 * a file in `images/` beside the trajectory. One no longer kept, or of a kind
 * the format cannot name, is said to be missing in its place.
 */
export async function trajectoryPictures(
  task: WorkspaceTask,
  read: PictureReader,
): Promise<{ readonly part: PicturePart; readonly files: ArchivedFile[] }> {
  const sources = new Set<string>();
  for (const message of task.messages)
    for (const attachment of message.attachments ?? [])
      if (attachment.kind === "picture" && attachment.source)
        sources.add(attachment.source);
  for (const entry of [
    ...task.modelHistory,
    ...task.specialistRuns.flatMap((run) => run.transcript ?? []),
  ])
    if (entry.kind === "pictures")
      for (const picture of entry.pictures) sources.add(picture.source);

  const parts = new Map<string, AtifContentPart>();
  const files: ArchivedFile[] = [];
  for (const source of sources) {
    const picture = await read(source).catch((): StoredPicture => ({
      status: "missing",
      reason: "This picture could not be read.",
    }));
    if (picture.status !== "ready") {
      parts.set(source, missing(picture.reason));
      continue;
    }
    const ending = endings[picture.mediaType];
    if (!ending) {
      parts.set(
        source,
        missing(
          `A ${picture.mediaType} picture, which the format cannot name.`,
        ),
      );
      continue;
    }
    const path = `images/picture-${String(files.length + 1)}.${ending}`;
    files.push({ path, data: Buffer.from(picture.data, "base64") });
    parts.set(source, {
      type: "image",
      source: { media_type: picture.mediaType, path },
    });
  }
  return {
    part: (source) =>
      (source === undefined ? undefined : parts.get(source)) ??
      missing("This picture was not kept, so it is not included."),
    files,
  };
}

function missing(reason: string): AtifContentPart {
  return { type: "text", text: `[Picture not included: ${reason}]` };
}
