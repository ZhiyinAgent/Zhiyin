/**
 * A finished call's answer as the model reads it: what Blender and the
 * delivery said, the picture Blender drew for the model, and, for a
 * description, the person's preview, said to be one.
 */

import { readFile, rm } from "node:fs/promises";
import type { ScenePanelState } from "@zhiyin/contract";

type Content = {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
};

/**
 * The answer's parts: `said`, then the `picture` file, read and removed, and
 * a `preview` of the 3D view when one is given.
 */
export async function answerContent(
  said: readonly string[],
  picture: string | undefined,
  preview: ScenePanelState["preview"],
): Promise<Content[]> {
  const content: Content[] = [
    { type: "text", text: said.filter(Boolean).join("\n") },
  ];
  if (picture) {
    const copy = await readFile(picture).catch(() => undefined);
    await rm(picture, { force: true });
    if (copy)
      content.push({
        type: "image",
        data: copy.toString("base64"),
        mimeType: "image/jpeg",
      });
  }
  // Said, so a quick picture from wherever the person turned the view is
  // not judged as the render.
  if (preview)
    content.push(
      {
        type: "text",
        text: `Below, a quick preview of the 3D view, from the ${preview.view === "camera" ? "scene camera" : "overview the person can turn, not the scene camera"}, drawn at low quality: judge framing and colour by a render.`,
      },
      {
        type: "image",
        data: preview.data,
        mimeType: "image/jpeg",
      },
    );
  return content;
}
