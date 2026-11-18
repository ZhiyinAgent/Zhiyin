import type { ConnectionTool } from "@zhiyin/contract";
import { lookUpTime } from "./library-look-up.js";
import { libraries, versionWords } from "./library-versions.js";
import { cadKindNames, requirementLimits } from "./requirements-request.js";
import { mostSteps } from "./rigid-sweep.js";
import { allHelpers, helpersFile, helpersModule } from "./script-helpers.js";
import { largestScript, largestScriptWords } from "./script-source.js";
import { writtenPageId } from "./written-pages.js";

/** Where a definition sends the model for what it leaves out. */
const read = (topic: string) => `open ${writtenPageId(topic)}`;

/** What a list of part names takes, beside names. */
const patterns = "/Pin_.*/ between slashes matches parts.";

/** How a build or a drawing moves its parts apart, as an exploded view. */
const explode = {
  type: "object",
  properties: {
    parts: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      description: "Taken out; else all but stay, or the largest.",
    },
    stay: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      description: "Kept in place.",
    },
    spread: {
      type: "number",
      minimum: 0,
      maximum: 4,
      description: "× part size; 0.5.",
    },
  },
  additionalProperties: false,
  description: `An exploded view; ${read("assemblies")}.`,
};

/** The script a build or a drawing runs, given as code. */
const code = {
  type: "string",
  maxLength: largestScript,
  description: `The script, as Python code, at most ${largestScriptWords}.`,
};

/** The script a build or a drawing runs, given as a workspace file. */
const file = {
  type: "string",
  description: `A workspace .py file instead of code; files beside it import. At most ${largestScriptWords}.`,
};

const scriptArguments = {
  type: "array",
  items: { type: "string" },
  description: "The script's sys.argv after its name.",
};

/** How long a build or a drawing may run. */
const minutes = {
  type: "integer",
  minimum: 1,
  maximum: 30,
  description: "Minutes; 5 if left out.",
};

/** A point [x, y, z] in mm, or a direction: three numbers, as every point a drawing takes is. */
const point = (description: string) => ({
  type: "array",
  items: { type: "number" },
  minItems: 3,
  maxItems: 3,
  description,
});

/** A parts list's materials, each part's by its name or a pattern, as the pages say. */
const materials = {
  type: "object",
  description:
    'Each part\'s material, by name or pattern: { "/Screw.*/": "steel" }.',
};

/** The straight views, which a section looks as. */
const straight = ["front", "back", "top", "bottom", "left", "right"];

const partNames = (what: string) => ({
  type: "array",
  items: { type: "string" },
  minItems: 1,
  description: `${what}; left out, all. ${patterns}`,
});

export const cadTools: readonly ConnectionTool[] = [
  {
    name: "cad_build",
    label: "Build a CAD part",
    reportsState: true,
    description: [
      `Build exact CAD parts with ${versionWords("build123d")} and check them, to print, mill or assemble.`,
      `The script passes each part to show(part, name="Bracket"); making="printed", "moulded", "milled" or "sheet" has a part checked for how it is made. Sizes are millimetres. \`from build123d import *\` and \`from ${helpersModule} import *\` give the library, show and these: round_edges(part, edges, radius), which never fails the build; ${allHelpers.filter((helper) => helper !== "round_edges").join(", ")}. bd_warehouse holds standard parts.`,
      `How to write the script, and every helper: ${read("scripts")}.`,
      `The answer measures each part and its overlaps, with four views (${read("build-answer")}).`,
      "Each call starts from nothing. The script reads the workspace, not the internet, and writes no files: name them in exports.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        code,
        file,
        arguments: scriptArguments,
        positions: {
          type: "array",
          minItems: 1,
          maxItems: 24,
          items: { type: "array", items: { type: "string" } },
          description: `Instead of arguments, each run's, as [["0"], ["90"]], each checked; ${read("assemblies")}.`,
        },
        steps: {
          type: "integer",
          maximum: 24,
          description: "With positions: steps per move.",
        },
        sweep: {
          type: "object",
          description: `A swing, a slide or gears, built once; ${read("assemblies")}.`,
          properties: {
            parts: {
              type: "array",
              items: { type: "string" },
              description: "The parts that move together.",
            },
            through: point("A point on the axis, mm; none: they slide."),
            along: point("The axis's direction, or the slide's."),
            from: {
              type: "number",
              description: "Start: degrees turning, mm sliding.",
            },
            to: { type: "number", description: "End: degrees or mm, as from." },
            steps: {
              type: "integer",
              description: `Positions checked, 1 to ${mostSteps}.`,
            },
            with: {
              type: "array",
              description: "Groups moved with the first, as gears it drives.",
              items: {
                type: "object",
                properties: {
                  parts: {
                    type: "array",
                    items: { type: "string" },
                    description: "Its parts.",
                  },
                  through: point("On its axis, mm; none: it slides."),
                  along: point("Its axis's direction, or its slide's."),
                  rate: {
                    type: "number",
                    description:
                      "Its degrees or mm per degree or mm the first moves; not 0.",
                  },
                },
                required: ["parts", "along", "rate"],
              },
            },
          },
          required: ["parts", "along", "from", "to", "steps"],
        },
        explode,
        minutes,
        requirements: {
          type: "string",
          description: [
            'A workspace .json of the person\'s requirements: { "requirements": [{ "id": "R1", "says": "…", "check": "fits", … }] }; else requirements.json beside the script.',
            `check is ${cadKindNames.slice(0, -1).join(", ")} or ${cadKindNames.at(-1)}; each kind's fields: ${read("requirements")}.`,
            requirementLimits,
          ].join(" "),
        },
        sections: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              through: point("A point of the plane, mm."),
              looking: {
                type: "string",
                enum: ["front", "back", "top", "bottom", "right", "left"],
                description: "The straight view it is seen as.",
              },
              parts: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                description: "The parts it cuts; left out, all.",
              },
            },
            required: ["through", "looking"],
          },
          description:
            "Cut views, each a plane through a point, square to looking.",
        },
        exports: {
          type: "array",
          maxItems: 8,
          description: "Files Zhiyin writes once the build succeeds.",
          items: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: `A workspace path, or a whole path outside it the person approves: .step/.stp (exact), .stl/.3mf (printing), .glb (metres, 3D studio), .png (views), .csv (parts list), .json (cad_motion, with positions or explode), or ${helpersFile} beside the script, for it to run outside Zhiyin. ${read("exports")}.`,
              },
              parts: partNames("Parts to write"),
              detail: {
                type: "string",
                enum: ["close-up"],
                description: "For a .glb: four times finer.",
              },
              exploded: {
                type: "boolean",
                description: "With explode: the parts moved apart.",
              },
              materials,
            },
            required: ["path"],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "cad_draw",
    label: "Make an engineering drawing",
    checksWork: "runs",
    description: [
      "Make an engineering drawing of CAD parts: a titled sheet of views, hatched sections, details and dimensions measured on the part.",
      "The script is a cad_build script; points are the part's own, in mm. scene: true draws the open 3D scene instead.",
      `Views, sections, details, sheets: ${read("drawings")}; dimensions: ${read("dimensions")}.`,
      "A view not done in time is left out and named; draw one subsystem per call.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        again: {
          type: "string",
          description:
            "A file a drawing here wrote, to redraw with the inputs given beside it.",
        },
        code,
        file,
        arguments: scriptArguments,
        parts: partNames("The shown parts to draw"),
        minutes,
        explode,
        scene: {
          type: "boolean",
          description: "Draw the open 3D scene, with no script.",
        },
        objects: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 200,
          description: "With scene; left out, all.",
        },
        sheet: {
          type: "string",
          enum: ["A4", "A3", "A2", "A1", "A0"],
          description: "A3 when left out.",
        },
        orientation: {
          type: "string",
          enum: ["landscape", "portrait"],
          description: "Landscape when left out.",
        },
        projection: {
          type: "string",
          enum: ["first", "third"],
          description: "First angle (ISO) when left out.",
        },
        scale: {
          type: "string",
          description: "As 1:2; left out, the largest that fits.",
        },
        views: {
          type: "array",
          maxItems: 12,
          description: "Left out: front, top, right and iso.",
          items: {
            type: "object",
            properties: {
              view: {
                type: "string",
                enum: [...straight, "iso"],
                description: "A named view.",
              },
              hidden: {
                type: "boolean",
                description: "false leaves hidden edges out.",
              },
              section: { type: "string", description: "A to Z." },
              detail: { type: "string", description: "A to Z." },
              auxiliary: { type: "string", description: "A to Z." },
              looking: {
                type: "string",
                enum: straight,
                description: "A section's.",
              },
              direction: point("An auxiliary's direction."),
              through: point("A section's point, mm."),
              uncut: {
                type: "array",
                items: { type: "string" },
                maxItems: 20,
                description: "Left whole.",
              },
              revolved: {
                type: "array",
                items: { type: "string" },
                maxItems: 40,
                description: "Turned about axis.",
              },
              axis: {
                type: "object",
                description: "What revolved turns about.",
                properties: {
                  through: point("On it, mm."),
                  along: point("Its direction."),
                },
              },
              of: { type: "string", description: "A detail's view." },
              at: point("A detail's centre, mm."),
              radius: { type: "number", description: "A detail's, mm." },
              scale: {
                type: "number",
                description: "A detail's, × 1 to 20; 2 when left out.",
              },
            },
            additionalProperties: false,
          },
        },
        dimensions: {
          type: "array",
          maxItems: 80,
          description: "Measured on the part; [] for none.",
          items: {
            type: "object",
            properties: {
              view: { type: "string", description: "The view it is on." },
              kind: {
                description: "What it measures.",
                type: "string",
                enum: [
                  "length",
                  "overall",
                  "diameter",
                  "radius",
                  "angle",
                  "chamfer",
                  "hole_callout",
                  "ordinate",
                ],
              },
              from: point("A length's start or an ordinate's datum, mm."),
              to: point("A length's end or an ordinate's point, mm."),
              direction: {
                type: "string",
                enum: ["horizontal", "vertical", "aligned"],
                description: "Left out: the longer of across and up.",
              },
              diameter: {
                type: "boolean",
                description: "A length written with Ø.",
              },
              at: point("On the circle, hole or edge measured, mm."),
              all: {
                type: "boolean",
                description: "Counts every hole alike, as 4× Ø6.",
              },
              expect: {
                type: "number",
                description: "mm or degrees; the part must measure it.",
              },
              tolerance: {
                type: "string",
                description: "After the size: ±0.1, +0.1/-0 or H7.",
              },
            },
            required: ["view", "kind"],
            additionalProperties: false,
          },
        },
        parts_list: {
          type: "boolean",
          description: "Draw the parts list, with balloons.",
        },
        balloons: { type: "string", description: "Their view." },
        materials,
        title: {
          type: "object",
          properties: {
            title: { type: "string", description: "What is drawn." },
            number: { type: "string", description: "The drawing's number." },
            material: { type: "string", description: "What it is made of." },
            author: { type: "string", description: "Who drew it." },
            company: { type: "string", description: "Whose it is." },
            revision: { type: "string", description: "As A or 2." },
            date: { type: "string", description: "As written." },
          },
          additionalProperties: false,
          description: "Each at most 80 characters.",
        },
        outputs: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          description: "Files Zhiyin writes the sheet to.",
          items: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "A workspace path, or a whole path the person approves: .pdf, .svg, .png or .dxf.",
              },
              view: {
                type: "string",
                description: "A .dxf's one view, at full size.",
              },
            },
            required: ["path"],
            additionalProperties: false,
          },
        },
      },
      // outputs, unless again draws a drawing of this conversation again.
      additionalProperties: false,
    },
  },
  {
    name: "cad_api",
    label: "Look up the CAD library",
    access: "read",
    description: `Ask the installed CAD library what a name accepts: a helper's inputs (${allHelpers.join(", ")}), a build123d class, function or method (Box, extrude, fillet, Plane, Location), or a bd_warehouse part (bd_warehouse.fastener.HexHeadScrew, bd_warehouse.bearing). The answer is its signature and the library's own description, with a class's methods and a module's parts, for the version installed, build123d ${libraries.build123d} and bd_warehouse ${libraries.bd_warehouse}; a name not found is answered with the names near it. The development docs (readthedocs "latest") describe a later release: a name only they have, such as BuildSheet, flange or BevelGear, is answered with what ${libraries.build123d} has instead. Use it before writing a script with a name you are unsure of. A look-up may take ${lookUpTime}.`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "One name to look up." },
        names: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 12,
          description:
            "Several names to look up in one call, answered in the order given: every helper and class a script will use, at once. Give name or names, not both.",
        },
      },
      additionalProperties: false,
    },
  },
];
