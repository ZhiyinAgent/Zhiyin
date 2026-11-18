/**
 * The tool that rigs objects: bones, a ready rig fitted to a body, a mesh
 * bound to its bones and limbs that reach for targets.
 */

import { rigBindDescribed, rigBindProperties } from "./rig-bind-schema.js";
import { rigBoneProperties, rigBonesDescribed } from "./rig-bones-schema.js";
import type { StudioTool } from "./schema-parts.js";
import { timeLimitStated } from "./time-limits.js";
import { toolkits } from "./toolkits.js";

export const rigTools: readonly StudioTool[] = [
  {
    name: "blender_rig",
    toolkit: toolkits.rig.id,
    label: "Rig objects in a 3D scene",
    checksWork: "runs",
    description: `${rigBonesDescribed} ${rigBindDescribed} ${timeLimitStated("rig")}`,
    inputSchema: {
      type: "object",
      properties: {
        ...rigBoneProperties,
        ...rigBindProperties,
      },
      additionalProperties: false,
    },
  },
];
