/**
 * What the 3D studio hands the reviewer of a scene a conversation changed:
 * its spec as first written there, with what was removed or changed since
 * and the latest measures, the scene as described now, fresh views from four
 * sides in each of the three shadings, and close-ups of the objects the scene
 * is mostly about. A scene that is no longer the one open is described from
 * its last measures alone, without views.
 */

import type {
  OfferedConnection,
  ProducedImage,
  ReviewMaterial,
  StudioReviews,
} from "@zhiyin/contract";
import { reviewBrief } from "@zhiyin/studio-requirements";
import { SceneSpecs } from "./scene-spec.js";

/** The reviewer the 3D studio's plugin defines. */
export const sceneReviewer = "3d-rendering/scene-reviewer";

const shadings = ["shaded", "wireframe", "faces"] as const;
/** How many objects the close-ups show: few enough that each stays large on the one sheet. */
const closeUps = 4;

export type SceneReviewsOptions = {
  /** This conversation's own folder in the app's data. */
  readonly directory: (conversationId: string) => string;
  /** The studio's tools on the conversation's scene, as the model calls them. */
  readonly tools: (
    conversationId: string,
  ) => Pick<OfferedConnection, "callTool">;
  /** The scene open in the conversation now, workspace-relative, if any. */
  readonly open: (conversationId: string) => Promise<string | undefined>;
};

type Part = {
  readonly type?: string;
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
};

/** A call's answer as its parts; nothing from one that failed. */
function partsOf(answer: unknown): readonly Part[] {
  if (!answer || typeof answer !== "object") return [];
  const { content, isError } = answer as {
    content?: unknown;
    isError?: unknown;
  };
  return isError === true || !Array.isArray(content) ? [] : (content as Part[]);
}

const textOf = (parts: readonly Part[]) =>
  parts
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n");

const picturesOf = (parts: readonly Part[]): ProducedImage[] =>
  parts.flatMap((part) =>
    part.type === "image" && part.data
      ? [{ mediaType: part.mimeType ?? "image/jpeg", data: part.data }]
      : [],
  );

const folderOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")).toLowerCase() : "";

/**
 * Where the spec and the scene are, by the workspace paths read_file takes:
 * a bare file name otherwise reads as one beside the scene.
 */
function filesText(spec: string, scene: string): string {
  const where =
    folderOf(spec) === folderOf(scene)
      ? ", beside the scene"
      : folderOf(spec) === ""
        ? ", at the workspace's top"
        : "";
  return `The spec is ${spec}${where}, and the scene is ${scene}, each a path from the workspace's top as read_file takes it. The scene is a Blender file that read_file and read_document cannot read; the 3D tools look at it.`;
}

export function sceneReviews(options: SceneReviewsOptions): StudioReviews {
  return {
    reviewer: sceneReviewer,
    async hasChangedSince(conversationId, since) {
      const changed = await new SceneSpecs(
        options.directory(conversationId),
      ).changedSince(since);
      return changed.length > 0;
    },
    async changedSince(conversationId, since, pictures) {
      const changed = await new SceneSpecs(
        options.directory(conversationId),
      ).changedSince(since);
      if (!changed.length) return [];
      const open = (await options.open(conversationId))?.toLowerCase();
      const tools = options.tools(conversationId);
      const material: ReviewMaterial[] = [];
      for (const spec of changed) {
        const subject = `the scene ${spec.scene}`;
        const brief = [
          reviewBrief({
            title: spec.object ? `Spec for ${spec.object}` : "Spec",
            first: spec.first,
            current: spec.current,
            last: spec.last,
          }),
          filesText(spec.file, spec.scene),
        ].join("\n\n");
        if (spec.scene.toLowerCase() !== open) {
          material.push({
            reviewer: sceneReviewer,
            subject,
            brief: `${brief}\n\nThis scene is no longer the one open, so it is judged from these measures alone; say so in your report.`,
            pictures: [],
          });
          continue;
        }
        const described = textOf(
          partsOf(await tools.callTool("blender_describe_scene", {})),
        );
        const views: ProducedImage[] = [];
        const counts: string[] = [];
        for (const shading of pictures ? shadings : (["shaded"] as const)) {
          const looked = partsOf(
            await tools.callTool("blender_look", { shading }),
          );
          if (pictures) views.push(...picturesOf(looked));
          if (shading === "shaded") counts.push(textOf(looked));
        }
        // The objects the scene is mostly about, up close, where a view of the
        // whole is too small to judge how each is made.
        const close = pictures
          ? partsOf(
              await tools.callTool("blender_close_ups", { main: closeUps }),
            )
          : [];
        views.push(...picturesOf(close));
        const closeText = textOf(close);
        material.push({
          reviewer: sceneReviewer,
          subject,
          brief: [
            brief,
            ...(described ? ["## The scene as described now", described] : []),
            ...(counts.join("")
              ? ["## Each object's mesh, as counted now", ...counts]
              : []),
            ...(closeText
              ? [
                  "## The objects the scene is mostly about, up close",
                  closeText,
                ]
              : []),
            ...(views.length
              ? [
                  `The views come in this order: ${shadings.join(", ")}; each from the front, the right, the top and three-quarter.` +
                    (picturesOf(close).length
                      ? ` Then a close-up of each of the objects the scene is mostly about, from two sides: judge how each is made from it.`
                      : ""),
                ]
              : []),
          ].join("\n\n"),
          pictures: views,
        });
      }
      return material;
    },
  };
}
