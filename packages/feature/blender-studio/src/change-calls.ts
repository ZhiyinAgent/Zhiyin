/**
 * The calls that change the open scene through a tool of their own: adding,
 * changing and modelling objects, their materials, their animation, the
 * camera and the light. Each workspace file one names is checked and sent to
 * Blender by its absolute path.
 */

import { materialWithPaths } from "./material-paths.js";
import { font, kinds, readable, type Refusal } from "./paths.js";
import { record, sceneChange } from "./prepared-call.js";
import { materialRows } from "./material-rows.js";
import { stepsWithPaths } from "./shape-calls.js";
import {
  addRows,
  animateRows,
  cameraRows,
  editRows,
  inWords,
  lightingRows,
  settleRows,
  shapeRows,
} from "./wording.js";

/** Turns each workspace path in a list of object descriptions into a checked absolute one. */
async function objectsWithPaths(
  root: string,
  objects: unknown,
): Promise<readonly Record<string, unknown>[] | Refusal> {
  if (!Array.isArray(objects) || objects.length === 0)
    return {
      reason: "objects must list at least one object.",
      correctable: true,
    };
  const checked: Record<string, unknown>[] = [];
  for (const item of objects) {
    const spec = record(item);
    const kind = spec["kind"];
    if (kind === "image" || kind === "svg" || kind === "model") {
      const allowed =
        kind === "image"
          ? kinds.picture
          : kind === "svg"
            ? kinds.drawing
            : kinds.model;
      const what =
        kind === "image"
          ? "A picture"
          : kind === "svg"
            ? "A drawing"
            : "A model";
      const found = await readable(root, spec["path"], allowed, what);
      if (!("absolute" in found)) return found;
      spec["path"] = found.absolute;
    }
    if (spec["font"] !== undefined) {
      const found = await font(root, spec["font"]);
      if (!("absolute" in found)) return found;
      spec["font"] = found.absolute;
    }
    checked.push(spec);
  }
  return checked;
}

/** Turns the model file each edit takes new shapes from into a checked absolute path. */
async function editsWithPaths(
  root: string,
  edits: unknown,
): Promise<readonly Record<string, unknown>[] | Refusal> {
  const checked: Record<string, unknown>[] = [];
  for (const item of Array.isArray(edits) ? edits : []) {
    const edit = { ...record(item) };
    if (edit["shapes_from"] !== undefined) {
      const found = await readable(
        root,
        edit["shapes_from"],
        kinds.model,
        "A model",
      );
      if (!("absolute" in found)) return found;
      edit["shapes_from"] = found.absolute;
    }
    checked.push(edit);
  }
  return checked;
}

export const prepareAdd = sceneChange("add", async (args, { root }) => {
  const objects = await objectsWithPaths(root, args["objects"]);
  if (!Array.isArray(objects)) return objects as Refusal;
  return {
    // A model file may name other files; Blender checks them against this.
    args: { objects, workspace: root },
    action: "Add objects to a 3D scene",
    rows: inWords(addRows(args)),
  };
});

export const prepareEdit = sceneChange("edit", async (args, { root }) => {
  const edits = await editsWithPaths(root, args["edits"]);
  if (!Array.isArray(edits)) return edits as Refusal;
  return {
    // A model file may name other files; Blender checks them against this.
    args: { edits, workspace: root },
    action: "Change objects in a 3D scene",
    rows: inWords(editRows(args)),
  };
});

export const prepareSettle = sceneChange("settle", (args) => ({
  args: { ...args },
  action: "Settle objects with physics in a 3D scene",
  rows: inWords(settleRows(args)),
}));

export const prepareShape = sceneChange("shape", async (args, { root }) => {
  const operations = await stepsWithPaths(root, args["operations"]);
  if (!Array.isArray(operations)) return operations as Refusal;
  return {
    args: { ...args, operations },
    action: "Model an object in a 3D scene",
    rows: inWords(shapeRows(args)),
  };
});

export const prepareMaterial = sceneChange(
  "material",
  async (args, { root }) => {
    const material = await materialWithPaths(root, args["material"]);
    if ("reason" in material) return material as Refusal;
    return {
      args: { ...args, material },
      action: "Set a material in a 3D scene",
      rows: inWords(materialRows(args)),
    };
  },
);

export const prepareAnimate = sceneChange("animate", async (args, { root }) => {
  const sets =
    [
      "keys",
      "poses",
      "paths",
      "aim",
      "follow",
      "drive",
      "belts",
      "clear",
      "extend",
    ].some((key) => Array.isArray(args[key]) && args[key].length > 0) ||
    args["cad_motion"] !== undefined ||
    args["fps"] !== undefined ||
    args["duration"] !== undefined;
  if (!sets)
    return {
      reason:
        "This call sets nothing: give keys, poses, paths, aim, follow, drive, belts, cad_motion, clear, extend, fps or duration.",
      correctable: true,
    };
  let sent: Record<string, unknown> = { ...args };
  if (args["cad_motion"] !== undefined) {
    const motion = { ...record(args["cad_motion"]) };
    const found = await readable(
      root,
      motion["file"],
      kinds.motion,
      "A CAD motion file",
    );
    if (!("absolute" in found)) return found;
    sent = { ...args, cad_motion: { ...motion, file: found.absolute } };
  }
  return {
    args: sent,
    action: "Animate a 3D scene",
    rows: inWords(animateRows(args)),
  };
});

export const prepareCamera = sceneChange("camera", (args) => ({
  args: { ...args },
  action: "Set the camera of a 3D scene",
  rows: inWords(cameraRows(args)),
}));

export const prepareLighting = sceneChange(
  "lighting",
  async (args, { root }) => {
    let sent: Record<string, unknown> = { ...args };
    const background = record(args["background"]);
    if (background["hdri"] !== undefined) {
      const found = await readable(
        root,
        background["hdri"],
        kinds.surroundings,
        "A picture of surroundings",
      );
      if (!("absolute" in found)) return found;
      background["hdri"] = found.absolute;
      sent = { ...args, background };
    }
    return {
      args: sent,
      action: "Light a 3D scene",
      rows: inWords(lightingRows(args)),
    };
  },
);
