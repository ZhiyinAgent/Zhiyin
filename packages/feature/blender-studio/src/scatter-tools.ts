/**
 * The tool that scatters objects over a surface.
 */

import { objectNames, point2, type StudioTool } from "./schema-parts.js";
import { statedNumbers } from "./stated-numbers.js";
import { timeLimitStated } from "./time-limits.js";
import { toolkits } from "./toolkits.js";

/** The most copies a scatter places, as instances. */
const mostInstances = 10_000;

/** Objects and a distance from their surfaces, in metres. */
const objectsAndDistance = (description: string) => ({
  type: "object",
  properties: {
    objects: objectNames,
    distance: { type: "number", description: "In metres." },
  },
  required: ["objects", "distance"],
  additionalProperties: false,
  description,
});

const range = (description: string) => ({ ...point2, description });

export const scatterTools: readonly StudioTool[] = [
  {
    name: "blender_scatter",
    toolkit: toolkits.scatter.id,
    label: "Scatter objects over a surface in a 3D scene",
    checksWork: "runs",
    description: `Scatter copies of objects over a surface, as stones, plants or props: by count or density, kept to where the rules allow, each copy's footprint (the circle round its own box seen from its up, at its scale) clear of every other's, its bottom standing on the surface. Copies are linked objects sharing the items' meshes, in a collection of their own, or instances geometry nodes place, for many. The answer gives how many were placed against asked, how many points each rule and the footprints removed, the least gap between footprints, the slopes the copies stand on, the faces they draw against those held in memory, each copy that goes into another object (for instances, measured as Blender evaluated them), and how many objects and instances the scene now has. Scattering the same items onto the same object again replaces the earlier scatter, and says so. A scatter that places nothing is refused with what the surface has. In detail: open doc:3d-rendering/scattering. ${timeLimitStated("scatter")}`,
    inputSchema: {
      type: "object",
      properties: {
        items: {
          ...objectNames,
          description:
            "The objects copies are made of, each copy one of them at random; they stay where they are. A name between slashes, such as /Rock_.*/, stands for every object whose whole name it matches.",
        },
        weights: {
          type: "object",
          additionalProperties: { type: "number", minimum: 0 },
          description: `How likely each item is to be drawn, by its name: {“Rock A”: 3, “Rock B”: 1} makes three of A for one of B. An item not named weighs ${statedNumbers.scatter.weight}.`,
        },
        onto: { type: "string", description: "The surface: a mesh object." },
        count: {
          type: "integer",
          minimum: 1,
          maximum: mostInstances,
          description: `How many copies; at most ${statedNumbers.scatter.most_objects.toLocaleString("en")} as objects, ${mostInstances.toLocaleString("en")} as instances.`,
        },
        density: {
          type: "number",
          description:
            "Copies per square metre of the surface the rules leave, instead of count.",
        },
        where: {
          type: "object",
          properties: {
            material: {
              type: "string",
              description: "Only on faces of this material.",
            },
            vertex_group: {
              type: "string",
              description:
                "Only where this vertex group is painted, as likely as its weight.",
            },
            slope: range(
              "Only where the surface slopes between these angles from level, in degrees.",
            ),
            height: range("Only between these heights, in metres."),
            away_from: objectsAndDistance(
              "Only at least this far from these objects' surfaces.",
            ),
            near: objectsAndDistance(
              "Only within this distance of these objects' surfaces.",
            ),
          },
          additionalProperties: false,
          description:
            "Where copies may stand, measured where each stands on the surface.",
        },
        spacing: {
          type: "number",
          default: 0,
          description:
            "The least clear gap between footprints, in metres; at the default, none touch.",
        },
        keep_clear: {
          ...objectNames,
          description:
            "Objects no copy may go into, as a path or a house; a copy may stand against one.",
        },
        align: {
          type: "string",
          enum: ["up", "surface"],
          description:
            "up (default): each copy's +z stays upright; surface: tilted to follow the surface.",
        },
        offset: {
          type: "number",
          description:
            "Each copy raised by this much along its up, in metres, as leaves floating on water; below 0 lowers it.",
        },
        sink: range(
          "Each copy sunk into the surface along its up by between these, in metres, at random, as stones bedded in soil.",
        ),
        jitter: {
          type: "object",
          description: "How each copy differs, at random.",
          properties: {
            seed: {
              type: "integer",
              default: 0,
              description: "The same seed scatters the same way.",
            },
            turn: {
              type: "number",
              default: 360,
              description:
                "Each copy turned about its up by up to this many degrees at random; 0 keeps the item's facing.",
            },
            scale: {
              ...range(
                "Each copy scaled by a multiple between these, at random.",
              ),
              default: [1, 1],
            },
          },
          additionalProperties: false,
        },
        as: {
          type: "string",
          enum: ["objects", "instances"],
          description:
            "objects (default): linked copies you can edit one by one; instances: placed by geometry nodes on one object, for many.",
        },
      },
      required: ["items", "onto"],
      additionalProperties: false,
    },
  },
];
