/**
 * Rigging objects, a change to the scene, and how a rig reads for approval.
 */

import { sceneChange } from "./prepared-call.js";
import { rigBindRows } from "./rig-bind-rows.js";
import { rigBoneRows } from "./rig-bones-rows.js";
import { inWords } from "./wording.js";

export const prepareRig = sceneChange("rig", (args) => ({
  args: { ...args },
  action: "Rig objects in a 3D scene",
  rows: inWords([...rigBoneRows(args), ...rigBindRows(args)]),
}));
