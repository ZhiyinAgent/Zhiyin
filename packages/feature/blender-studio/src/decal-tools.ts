/**
 * The tool that puts decals on objects' surfaces: a picture or text laid on
 * the surface, and strips run along its edges, seams or lines.
 */

import {
  colour,
  vector3,
  workspaceFile,
  type StudioTool,
} from "./schema-parts.js";
import { statedNumbers } from "./stated-numbers.js";
import { timeLimitStated } from "./time-limits.js";
import { toolkits } from "./toolkits.js";

const decal = statedNumbers.decal;

const share = (what: string) => ({
  type: "number",
  minimum: 0,
  maximum: 1,
  description: what,
});

export const decalTools: readonly StudioTool[] = [
  {
    name: "blender_add_decal",
    toolkit: toolkits.decals.id,
    label: "Add decals to objects in a 3D scene",
    checksWork: "runs",
    description: `Put a label, logo, sticker or printed text on an object's surface, wrap a label round a bottle, jar, can or tube, draw relief by shading alone (vents, rivets, screws, grilles, hinges, seams), or run a strip of stitches, dashes, chevrons, a repeated picture or a plain band along its sharp edges, seams, a CAD surface group's boundary, a curve or round it at a height, grooves and rivet rows among them. A decal is an object of its own that moves with the object, with materials of its own: a projected or mesh decal's is a copy of the surface's material with the decal mixed into the channels it affects, so the rest matches. The answer gives where it landed and which way the surface faces there, its size on the surface and worst stretch, how much is off an edge or on the back side, its overlap with other decals, the gap to the surface and whether EEVEE or Cycles would mix the two up (z-fighting) at the camera's distance; a label's arc and its stretch on a taper; a strip's length, pattern count, gaps at corners and standoff, a groove's continuity and where it meets the outline. In detail: open doc:3d-rendering/decals. ${timeLimitStated("decal")}`,
    inputSchema: {
      type: "object",
      properties: {
        object: { type: "string", description: "The object it goes on." },
        name: {
          type: "string",
          description:
            "Left out, “<object> decal”. A decal's name replaces that decal; another object's is refused.",
        },
        kind: {
          type: "string",
          enum: ["projected", "mesh", "normal", "wrap", "strip"],
          description:
            "projected (default): the surface itself under the decal, the picture cast onto it along direction. mesh: a card of its own, bent to the surface unless conform is false. normal: relief by shading alone, projected as projected is, the surface's shape and colour untouched. wrap: a label round the object's axis, its own material. strip: runs along a line on the surface.",
        },
        picture: workspaceFile(
          "A workspace picture; its transparent parts let the surface show. For a strip, the picture its pattern repeats; for a normal decal, its brightness is the height, white highest.",
        ),
        shape: {
          type: "string",
          enum: ["vent", "rivet", "screw", "grille", "hinge", "seam"],
          description: `A normal decal's or shape strip's relief: vent ${decal.vent_aspect}:1, hinge ${decal.hinge_aspect}:1, seam ${decal.seam_aspect}:1, the rest square.`,
        },
        count: {
          type: "integer",
          description: `How many of a vent's slots (${decal.vent_slots}), a grille's holes across (${decal.grille_holes}) or a hinge's knuckles (${decal.hinge_knuckles}).`,
        },
        axis: {
          type: "string",
          enum: ["x", "y", "z"],
          description:
            "The object's own axis a wrap label goes round, through its middle; z by default.",
        },
        label: {
          type: "string",
          enum: ["paper", "clear"],
          description:
            "A wrap label's stock: paper (default) shows white where the picture is clear; clear film shows the surface there.",
        },
        white_ink: {
          type: "boolean",
          description:
            "A clear label's ink printed over white, hiding the surface (default), or without, the surface showing through it tinted.",
        },
        text: { type: "string", description: "Text in place of a picture." },
        font: workspaceFile(
          "The text's font: a workspace file or a Windows font's file name.",
        ),
        color: colour(
          "The text's or strip's colour, or a picture's shape painted in one colour.",
        ),
        at: vector3("A point on or near the surface, in metres."),
        direction: vector3(
          "A direction to cast the decal along, through at, onto the first surface it meets: [0, 1, 0] lands on a face looking toward -y. Without it, the surface nearest at.",
        ),
        size: {
          type: "number",
          description:
            "Its width in metres; its height follows the picture's or text's proportions.",
        },
        rotation: {
          type: "number",
          description:
            "Degrees round the surface's normal, counter-clockwise as seen.",
        },
        conform: {
          type: "boolean",
          description:
            "A mesh decal bends to the surface (default) or stays flat.",
        },
        affects: {
          type: "array",
          items: {
            type: "string",
            enum: ["color", "roughness", "metal", "coat", "normal"],
          },
          description:
            "What it changes of the surface: color, and whichever of roughness, metal, coat and relief are given, by default.",
        },
        roughness: share(
          `The decal's roughness, 0 mirror, 1 matte; a wrap label's own, ${decal.paper_roughness} for paper and ${decal.film_roughness} for clear film by default.`,
        ),
        metal: share("0 not metal, 1 metal."),
        coat: share("The decal's clear coat, 0 none, 1 full."),
        relief: {
          type: "number",
          description:
            "How far its shape stands up, in metres, pressed in when negative: for affects normal, a normal decal and a groove or shape strip.",
        },
        offset: {
          type: "number",
          default: 0.0001,
          description: "How far it stands off the surface, in metres.",
        },
        along: {
          type: "object",
          description: "A strip's line, exactly one of these.",
          properties: {
            sharp_angle: {
              type: "number",
              description: "Edges sharper than this, in degrees.",
            },
            surface_group: {
              type: "string",
              description: "Round a CAD part's group of surfaces.",
            },
            seams: { type: "boolean", description: "Along its UV seams." },
            curve: {
              type: "string",
              description: "A curve object, laid onto the surface.",
            },
            height: {
              type: "number",
              description: "Round the object at this world height, in metres.",
            },
          },
          additionalProperties: false,
        },
        width: { type: "number", description: "A strip's width, in metres." },
        pattern: {
          type: "string",
          enum: [
            "stitch",
            "dash",
            "chevron",
            "picture",
            "solid",
            "groove",
            "shape",
          ],
          description:
            "A strip's pattern; dash by default. groove: a panel line pressed in by shading. shape: shape repeated along it.",
        },
        pitch: {
          type: "number",
          description:
            "How far one pattern repeat runs, in metres, evened out to fit each run whole.",
        },
        raised: {
          type: "number",
          description:
            "How high a strip's pattern stands, in metres; printed flat when left out.",
        },
      },
      required: ["object"],
      additionalProperties: false,
    },
  },
];
