/**
 * Simulating physics, a change to the scene, and how a simulation reads for
 * approval.
 */

import { sceneChange } from "./prepared-call.js";
import { simulateBodyRows } from "./simulate-bodies-rows.js";
import { simulateClothRows } from "./simulate-cloth-rows.js";
import { inWords } from "./wording.js";

export const prepareSimulate = sceneChange("simulate", (args) => ({
  args: { ...args },
  action: "Simulate physics in a 3D scene",
  rows: inWords([...simulateBodyRows(args), ...simulateClothRows(args)]),
}));
