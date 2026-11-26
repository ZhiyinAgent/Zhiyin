/**
 * The calls that look at the open scene and change nothing: a description of
 * it, and the sheets of frames and close-ups, which are for the model to see
 * and kept in the app's data.
 */

import type { Preparer } from "./prepared-call.js";
import { timeLimits } from "./time-limits.js";
import {
  closeUpRows,
  describeRows,
  framesRows,
  inWords,
  lookRows,
} from "./wording.js";

export const prepareDescribe: Preparer = (args, { scene }) => ({
  command: "describe",
  args: Array.isArray(args["objects"]) ? { objects: args["objects"] } : {},
  timeoutMs: timeLimits.describe,
  action: "Describe a 3D scene",
  target: scene,
  rows: inWords(describeRows(args)),
  access: "read",
});

export const prepareFrameSheet: Preparer = (args, { scene }) => {
  // Without pictures it is a report of every frame, which needs no spacing;
  // with them, frames left unspaced spread to an end.
  const pictures = args["pictures"] !== false;
  const every = args["every_ms"];
  if (
    pictures &&
    every !== undefined &&
    !(typeof every === "number" && every >= 1)
  )
    return {
      reason: "every_ms is the time between frames, in milliseconds from 1.",
      correctable: true,
    };
  return {
    command: "frames",
    // The time limit goes with it, so a scan of every frame stops in time to answer.
    args: { ...args, limit_seconds: timeLimits.frames / 1_000 },
    timeoutMs: timeLimits.frames,
    action: pictures
      ? "Look at frames of a 3D animation"
      : "Check every frame of a 3D animation",
    target: scene,
    rows: inWords(framesRows(args)),
    access: "read",
    ...(pictures ? { picture: true as const } : {}),
  };
};

export const prepareCloseUps: Preparer = (args, { scene }) => {
  const objects = args["objects"];
  const main = args["main"];
  if (
    main !== undefined &&
    (objects !== undefined ||
      !Number.isInteger(main) ||
      (main as number) < 1 ||
      (main as number) > 8)
  )
    return {
      reason:
        "main is how many of the objects the scene is mostly about to look at, from 1 to 8, given instead of objects.",
      correctable: true,
    };
  if (
    main === undefined &&
    (!Array.isArray(objects) ||
      !objects.length ||
      !objects.every((one) => typeof one === "string" && one.trim()))
  )
    return {
      reason:
        "objects names the objects to look at closely, or main how many of those the scene is mostly about.",
      correctable: true,
    };
  return {
    command: "closeups",
    args,
    timeoutMs: timeLimits.closeups,
    action: "Look closely at parts of a 3D scene",
    target: scene,
    rows: inWords(closeUpRows(args)),
    access: "read",
    picture: true,
  };
};

export const prepareLook: Preparer = (args, { scene }) => ({
  command: "look",
  args,
  timeoutMs: timeLimits.look,
  action: "Look at a 3D scene from four sides",
  target: scene,
  rows: inWords(lookRows(args)),
  access: "read",
  picture: true,
});
