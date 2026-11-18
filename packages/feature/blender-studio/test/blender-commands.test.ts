/**
 * The tools held to what Blender says of its commands as its session starts,
 * as recorded from a real Blender: each choice, option, default and limit a
 * schema states, and each number a description states in words, is the one
 * Blender holds the call to. The system-boundary suite holds the record to
 * the real Blender.
 */

import { describe, expect, it } from "vitest";
import { studioTools } from "../src/index.js";
import {
  differencesFrom,
  type CommandsDescription,
} from "../src/blender-commands.js";
import recorded from "./blender-commands.json" with { type: "json" };

type Editable = Record<
  string,
  {
    kind: string;
    inputs?: Record<string, Record<string, unknown>>;
    numbers?: Record<string, number>;
    words?: Record<string, string>;
    signatures?: Record<string, string>;
  }
>;

/** The recorded description, changed by `edit` as a Blender that differs would describe its commands. */
function blenderWhere(edit: (commands: Editable) => void): CommandsDescription {
  const commands = structuredClone(recorded) as Editable;
  edit(commands);
  return commands as CommandsDescription;
}

describe("the tools against Blender's description of its commands", () => {
  it("agree with the description recorded from Blender", () => {
    expect(
      differencesFrom(studioTools, recorded as CommandsDescription),
    ).toEqual([]);
  });

  it("differ where Blender holds a limit the schema states otherwise", () => {
    const commands = blenderWhere((c) => {
      c["video"]!.inputs!["every"]!["maximum"] = 12;
    });

    expect(differencesFrom(studioTools, commands)).toEqual([
      "blender_render_video every maximum: 24 in the schema, 12 in Blender.",
    ]);
  });

  it("differ where Blender holds a default the schema states otherwise", () => {
    const commands = blenderWhere((c) => {
      c["look"]!.inputs!["tile_width"]!["default"] = 400;
    });

    expect(differencesFrom(studioTools, commands)).toEqual([
      "blender_look tile_width default: 480 in the schema, 400 in Blender.",
    ]);
  });

  it("differ where Blender takes other choices than the schema offers", () => {
    const commands = blenderWhere((c) => {
      c["shape"]!.inputs!["operations.solver"]!["enum"] = [
        "float",
        "exact",
        "manifold",
      ];
    });

    expect(differencesFrom(studioTools, commands)).toEqual([
      "blender_shape_objects operations.solver enum: auto, exact, float, manifold in the schema, float, exact, manifold in Blender.",
    ]);
  });

  it("differ where a shaping step's cutter takes an option the schema lacks", () => {
    const commands = blenderWhere((c) => {
      const cutter = c["shape"]!.inputs!["operations.cutter"]!;
      cutter["properties"] = [...(cutter["properties"] as string[]), "chamfer"];
    });

    const found = differencesFrom(studioTools, commands);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(
      /^blender_shape_objects operations\.cutter properties: .* in the schema, .*, chamfer in Blender\.$/,
    );
  });

  it("differ where the schema states a limit or default Blender does not describe", () => {
    const commands = blenderWhere((c) => {
      delete c["frames"]!.inputs!["count"];
    });

    expect(differencesFrom(studioTools, commands)).toEqual([
      "blender_frame_sheet count minimum: the schema states 1, and Blender does not describe it.",
      "blender_frame_sheet count maximum: the schema states 36, and Blender does not describe it.",
      "blender_frame_sheet count default: the schema states 12, and Blender does not describe it.",
    ]);
  });

  it("differ where Blender describes an input no schema has", () => {
    const commands = blenderWhere((c) => {
      c["animate"]!.inputs!["keys.speed"] = { maximum: 3 };
    });

    expect(differencesFrom(studioTools, commands)).toEqual([
      "blender_animate keys.speed: Blender describes it, and the schema has no such input.",
    ]);
  });

  it("differ where a number a description states in words is not Blender's", () => {
    const commands = blenderWhere((c) => {
      c["video"]!.numbers!["longest_video"] = 240;
      delete c["render"]!.numbers!["eevee_samples"];
    });

    expect(differencesFrom(studioTools, commands)).toEqual([
      "render eevee_samples: a tool states 64, and Blender does not describe it.",
      "video longest_video: a tool states 300, Blender holds 240.",
    ]);
  });

  it("differ where a default a description names in words is not Blender's", () => {
    const commands = blenderWhere((c) => {
      c["settle"]!.words!["shape"] = "mesh";
    });

    expect(differencesFrom(studioTools, commands)).toEqual([
      "settle shape: a tool states hull, Blender holds mesh.",
    ]);
  });

  it("differ where a library function's call in the catalog is not its signature in Python", () => {
    const commands = blenderWhere((c) => {
      const signatures = c["script"]!.signatures!;
      signatures["toon"] = signatures["toon"]!.replace("bands=3", "bands=4");
      delete signatures["outline"];
      signatures["sketch"] = "(obj)";
    });

    expect(differencesFrom(studioTools, commands)).toEqual([
      "zhiyin.toon: the catalog states (material, bands=3, *, shadow=0.35, shadow_color=None, rim=None, faceted=False), Blender declares (material, bands=4, *, shadow=0.35, shadow_color=None, rim=None, faceted=False).",
      "zhiyin.outline: the catalog lists it, and Blender does not describe it.",
      "zhiyin.sketch: Blender declares it, and the catalog does not list it.",
    ]);
  });

  it("differ where a tool is sent as a command Blender does not run", () => {
    const commands = blenderWhere((c) => {
      delete c["describe"];
    });

    expect(differencesFrom(studioTools, commands)).toEqual([
      "blender_describe_scene is sent as describe, which Blender does not describe.",
    ]);
  });

  it("differ where Blender describes the inputs of a command no tool sends", () => {
    const tools = studioTools.filter((tool) => tool.name !== "blender_export");

    expect(differencesFrom(tools, recorded as CommandsDescription)).toEqual([
      "export: Blender describes its inputs, and no tool sends it.",
    ]);
  });

  it("differ where a tool is sent as no known command", () => {
    const tools = [
      ...studioTools,
      {
        name: "blender_sketch",
        label: "Sketch",
        description: "",
        inputSchema: { type: "object" },
      },
    ] as unknown as typeof studioTools;

    expect(differencesFrom(tools, recorded as CommandsDescription)).toEqual([
      "blender_sketch: no command is known for it.",
    ]);
  });
});
