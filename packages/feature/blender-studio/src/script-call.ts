/**
 * A Blender script the model writes, run in the open scene. It may write any
 * file in the workspace, and in the folders outside it it is given, which
 * Zhiyin copies first to put back; a workspace file it is let change though
 * Zhiyin could not copy it is changed for good (ADR 0012).
 */

import { realpath } from "node:fs/promises";
import {
  namedWorkspaceFiles,
  outsideFolders,
} from "@zhiyin/workspace-containment";
import { sceneChange } from "./prepared-call.js";
import { scriptRows } from "./wording.js";

export const largestScript = 100_000;

export const prepareScript = sceneChange(
  "script",
  async (args, { root, protect }) => {
    const code = args["code"];
    if (typeof code !== "string" || !code.trim())
      return { reason: "Give the script to run as code.", correctable: true };
    if (code.length > largestScript)
      return {
        reason: `A script may be at most ${largestScript.toLocaleString("en")} characters; this one has ${code.length.toLocaleString("en")}. Split the work over several calls: each builds on the scene the one before saved, and helpers one call writes to a workspace file the next can run with exec(open('helpers.py').read()).`,
        correctable: true,
      };
    // Placed again when it runs: a folder now reached through a link, or
    // gone, is refused rather than written.
    const outside = await outsideFolders(
      args["outside_folders"],
      await realpath(root),
      protect,
    );
    if (!outside.ok) return { reason: outside.reason, correctable: false };
    const elsewhere = outside.folders;
    const locked = namedWorkspaceFiles(args["change_locked"], elsewhere);
    if (!locked.ok) return { reason: locked.reason, correctable: true };
    const forGood = locked.paths;
    // What it can reach is said beside the code, in the rows. Which files
    // it may change for good is Zhiyin's to keep, not Blender's to read.
    const given = { ...args };
    delete given["change_locked"];
    const writesOutside = `The script can also write files in ${elsewhere.join(" and ")}, outside the folder you selected.`;
    return {
      args: {
        ...given,
        folder: root,
        ...(elsewhere.length ? { outside_folders: elsewhere } : {}),
      },
      action: "Run a Blender script in a 3D scene",
      rows: scriptRows(code, elsewhere, forGood),
      ...(elsewhere.length
        ? { outsideFolders: elsewhere, detail: writesOutside }
        : {}),
      ...(forGood.length
        ? {
            forGood,
            detail: [
              ...(elsewhere.length ? [writesOutside] : []),
              `It may also change ${forGood.join(", ")}, which Zhiyin could not copy first, so that change cannot be undone.`,
            ].join(" "),
          }
        : {}),
    };
  },
);
