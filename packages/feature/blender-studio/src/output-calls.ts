/**
 * The calls that write a file from the open scene: a render, a video and an
 * export. Each writes where its output names, in the workspace or, approved
 * by its real path, outside it.
 */

import { basename } from "node:path";
import { kinds, writableOutput, type Refusal } from "./paths.js";
import {
  fileChange,
  outsideDetail,
  sceneFileChange,
  type Args,
  type Preparer,
} from "./prepared-call.js";
import { timeLimits } from "./time-limits.js";
import { exportRows, inWords, renderRows, videoRows } from "./wording.js";

/**
 * A background or engine Blender refuses for this render, refused before it
 * is approved, in Blender's own words and in the order Blender checks them: a
 * plan has a white background of its own and is drawn with EEVEE, and a white
 * background with the product's shadow renders with Cycles.
 */
function renderRefusal(args: Args): Refusal | undefined {
  const plan = args["view"] === "plan";
  const background = args["background"];
  if (plan && background !== undefined && background !== "scene")
    return {
      reason: "A plan has a white background of its own: leave background out.",
      correctable: true,
    };
  const engine = args["engine"];
  if (engine === undefined) return undefined;
  if (plan && engine !== "eevee")
    return {
      reason:
        "A plan is drawn with EEVEE, whose light from the background walls do not shade: leave engine out.",
      correctable: true,
    };
  if (args["background"] === "white" && engine !== "cycles")
    return {
      reason:
        "A white background with the product's shadow renders with Cycles: use engine cycles.",
      correctable: true,
    };
  return undefined;
}

export const prepareRender: Preparer = async (args, place) => {
  const refused = renderRefusal(args);
  if (refused) return refused;
  const output = await writableOutput(
    place.root,
    args["output"],
    kinds.render,
    "A render",
    place.protect,
  );
  if (!("absolute" in output)) return output;
  return {
    command: "render",
    // The time limit goes with it, so a picture too large to finish is refused before it starts.
    args: {
      ...args,
      output: output.absolute,
      limit_seconds: timeLimits.render / 1_000,
    },
    timeoutMs: timeLimits.render,
    action: "Render a 3D scene",
    target: output.relative,
    rows: inWords(renderRows(args, output.relative)),
    access: "change",
    // The render's settings are kept in the scene, so it is backed up
    // whether the picture goes inside the workspace or outside it.
    changes: [
      fileChange(output, "The picture Blender renders."),
      sceneFileChange(place.scene),
    ],
    written: [output],
    picture: true,
    ...outsideDetail(output, "The picture"),
  };
};

export const prepareVideo: Preparer = async (args, place) => {
  const output = await writableOutput(
    place.root,
    args["output"],
    kinds.video,
    "A video",
    place.protect,
  );
  if (!("absolute" in output)) return output;
  if (basename(output.relative).includes("#"))
    return {
      reason:
        "A video's name cannot hold #, which Blender replaces with frame numbers.",
      correctable: true,
    };
  return {
    command: "video",
    args: {
      ...args,
      output: output.absolute,
      limit_seconds: timeLimits.video / 1_000,
      // A video in the workspace too long for one call is drawn over several,
      // its frames kept under the name it was approved by.
      ...(output.outside ? {} : { video_key: output.relative }),
    },
    timeoutMs: timeLimits.video,
    action: "Render a 3D animation to a video",
    target: output.relative,
    rows: inWords(videoRows(args, output.relative)),
    access: "change",
    // The scene's render settings are put back after, so only the video
    // is written.
    changes: [fileChange(output, "The video Blender renders.")],
    written: [output],
    ...outsideDetail(output, "The video"),
  };
};

export const prepareExport: Preparer = async (args, place) => {
  const output = await writableOutput(
    place.root,
    args["output"],
    kinds.export,
    "An export",
    place.protect,
  );
  if (!("absolute" in output)) return output;
  return {
    command: "export",
    args: { ...args, output: output.absolute },
    timeoutMs: args["bake"] === true ? timeLimits.bake : timeLimits.export,
    action: "Export a 3D model",
    target: output.relative,
    rows: inWords(exportRows(args, output.relative)),
    access: "change",
    changes: [fileChange(output, "The model file Blender writes.")],
    written: [output],
    ...outsideDetail(output, "The model file"),
  };
};
