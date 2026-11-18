/**
 * The tool that simulates: rigid bodies, cloth and liquids, baked, and kept
 * where they come to rest.
 */

import {
  simulateBodiesDescribed,
  simulateBodyProperties,
} from "./simulate-bodies-schema.js";
import {
  simulateClothDescribed,
  simulateClothProperties,
} from "./simulate-cloth-schema.js";
import type { StudioTool } from "./schema-parts.js";
import { timeLimitStated } from "./time-limits.js";
import { toolkits } from "./toolkits.js";

export const simulateTools: readonly StudioTool[] = [
  {
    name: "blender_simulate",
    toolkit: toolkits.simulate.id,
    label: "Simulate physics in a 3D scene",
    checksWork: "runs",
    description: `${simulateBodiesDescribed} ${simulateClothDescribed} ${timeLimitStated("simulate")}`,
    inputSchema: {
      type: "object",
      properties: {
        ...simulateBodyProperties,
        ...simulateClothProperties,
      },
      additionalProperties: false,
    },
  },
];
