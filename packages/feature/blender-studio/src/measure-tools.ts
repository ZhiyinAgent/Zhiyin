/**
 * The tool that measures between objects' surfaces.
 */

import type { StudioTool } from "./schema-parts.js";
import { statedNumbers } from "./stated-numbers.js";
import { timeLimitStated } from "./time-limits.js";
import { toolkits } from "./toolkits.js";

export const measureTools: readonly StudioTool[] = [
  {
    name: "blender_measure",
    toolkit: toolkits.measure.id,
    label: "Measure distances in a 3D scene",
    access: "read",
    checksWork: "runs",
    description: `Measure between objects' shapes, never their boxes, and change nothing. A gap between two objects is surface to surface, with the two nearest points, or how deep they go into each other and where, or that they touch; then how far apart their extents are along x, y and z, and, when they are apart along one axis only, how far one would move along it to touch the other. centres gives the distance between the middles of their extents, and along each axis. from an object along an axis gives what it meets first that way and how far. clearance gives the least distance from an object to everything else, naming the nearest and the next ${statedNumbers.measure.next}. deviation gives how far one shape strays from another: the most, the mean, what 95% lies within, and where. What an object places as instances is its shape; in a clearance each instance is measured as an object of its own. ${timeLimitStated("measure")}`,
    inputSchema: {
      type: "object",
      properties: {
        between: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 2,
          description: "The two objects to measure between, by name.",
        },
        from: {
          type: "string",
          description:
            "The object measured from: along an axis, or for its clearance.",
        },
        along: {
          type: "string",
          enum: ["x", "-x", "y", "-y", "z", "-z"],
          description: "With from: the way to look for what lies next.",
        },
        kind: {
          type: "string",
          enum: ["gap", "centres", "clearance", "deviation"],
          description:
            "gap (default): between two objects' surfaces, or from one along an axis; centres: between two objects' middles; clearance: from one object to everything else; deviation: how far the second of between strays from the first, as after a remesh or a wrap.",
        },
      },
      additionalProperties: false,
    },
  },
];
