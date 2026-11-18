/**
 * A build whose script fails where the library's words mislead is answered
 * with what fixes it: a CadQuery habit with build123d's form, a name only a
 * later release has with what the version installed has instead, and the
 * geometry kernel's failure with its likeliest cause. cad_api answers such a
 * name the same way. Python is a stand-in answering as the harness would;
 * that each error is the real library's is shown in the system-boundary
 * tests.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  cadAutomation,
  cadEnvironment,
  cadTools,
  type CadPython,
} from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const pinned = (name: string) =>
  cadEnvironment.lock.locked.find((one) => one.name === name)!.version;
const build123d = pinned("build123d");
const warehouse = pinned("bd-warehouse");
const short = build123d.split(".").slice(0, 2).join(".");

type Answer = { isError?: boolean; content: { text?: string }[] };

async function studio() {
  const root = await folders.make("zhiyin-cad-hints-workspace-");
  const data = await folders.make("zhiyin-cad-hints-data-");
  const said = { failed: "" };
  const requests: unknown[] = [];
  const python: CadPython = {
    state: async () => "ready",
    run: async (request) => {
      const given = JSON.parse(
        await readFile(request.arguments.at(-1)!, "utf8"),
      ) as { phase?: string; api?: string[]; output: string };
      requests.push(given);
      const answer = given.api
        ? { api: given.api.map((name) => `${name}(): looked up`).join("\n\n") }
        : { failed: said.failed };
      await writeFile(
        join(given.output, "answer.json"),
        JSON.stringify(answer),
      );
      return {
        ok: true,
        run: { exitCode: given.api ? 0 : 2, stdout: "", stderr: "" },
      };
    },
  };
  const tools = cadAutomation(python, {
    workspaceRoot: () => root,
    harness: join(data, "harness", "run.py"),
    directory: join(data, "cad-studio"),
  });
  const call = async (tool: string, args: Record<string, unknown>) => {
    const asked = await tools.inspect(tool, args);
    if (!asked.ok) throw new Error(asked.reason);
    return (await tools.callTool(
      tool,
      args,
      undefined,
      asked.identity,
    )) as Answer;
  };
  /** The answer to a build whose script fails with `error` on `line`. */
  const fails = async (line: string, error: string) => {
    said.failed = `The script failed:\n  File "the script", line 4, in <module>\n    ${line}\n${error}`;
    return (await call("cad_build", { code: "show(Box(1, 1, 1))" })).content[0]
      ?.text;
  };
  return { call, fails, requests };
}

describe("a build whose script fails where the library's words mislead", () => {
  it("answers a CadQuery selector string with build123d's selectors and the page to read", async () => {
    const { fails } = await studio();

    const text = await fails(
      'top = part.faces(">Z")',
      "AttributeError: 'str' object has no attribute 'name'",
    );

    expect(text).toContain(
      `build123d has no selector strings such as faces(">Z") and its selectors take no axis: faces().sort_by(Axis.Z)[-1] is the top face and [0] the bottom, edges().filter_by(Axis.Z) the edges along z, edges().group_by(Axis.Z)[-1] those at the top, filter_by(GeomType.CIRCLE) the round ones. To read more, open doc:build123d/${short}/ShapeList.`,
    );
  });

  it("answers CadQuery's chain, centring, hole and shell forms with build123d's", async () => {
    const { fails } = await studio();

    expect(
      await fails(
        'cq.Workplane("XY").box(10, 10, 10)',
        "NameError: name 'cq' is not defined",
      ),
    ).toContain("build123d is not CadQuery and has no cq or Workplane");
    expect(
      await fails(
        "Box(10, 10, 10, centered=False)",
        "TypeError: Box.__init__() got an unexpected keyword argument 'centered'",
      ),
    ).toContain(
      "align=(Align.CENTER, Align.CENTER, Align.MIN) sits it on z = 0",
    );
    expect(
      await fails(
        "Hole(diameter=4.5)",
        "TypeError: Hole.__init__() got an unexpected keyword argument 'diameter'",
      ),
    ).toContain("build123d sizes holes, circles and cylinders by radius");
    expect(
      await fails(
        "part = part.hole(4.5)",
        "AttributeError: 'Box' object has no attribute 'hole'",
      ),
    ).toContain("ClearanceHole(screw) or TapHole(screw)");
    expect(
      await fails(
        "part.shell(-2)",
        "TypeError: Shape.shell() takes 1 positional argument but 2 were given",
      ),
    ).toContain("offset(amount=-t, openings=faces)");
    expect(
      await fails(
        "part.rotate((0, 0, 0), (0, 0, 1), 90)",
        "AttributeError: 'tuple' object has no attribute 'wrapped'",
      ),
    ).toContain("part.rotate(Axis.Z, angle) or Rot(Z=angle) * part");
    expect(
      await fails("Rot(z=90)", "TypeError: Unexpected keyword arguments: z"),
    ).toContain("Pos and Rot take capitals");
  });

  it("answers a name only a later release has with what the version installed has instead", async () => {
    const { fails } = await studio();

    const sheet = await fails(
      "with BuildSheet(thickness=1):",
      "NameError: name 'BuildSheet' is not defined",
    );
    const bevel = await fails(
      "from bd_warehouse.gear import BevelGear",
      "ImportError: cannot import name 'BevelGear' from 'bd_warehouse.gear'",
    );

    expect(sheet).toContain(
      `BuildSheet is not in build123d ${build123d}, the version installed: only the development docs, which describe a later release, have it. In ${build123d}, sheet metal is folded with the helper sheet(outline, thickness, bends)`,
    );
    expect(bevel).toContain(
      `BevelGear is not in bd_warehouse ${warehouse}, the version installed`,
    );
    expect(bevel).toContain("lofted from SpurGearPlan");
  });

  it("answers the kernel's failure with its likeliest cause, the most particular one known", async () => {
    const { fails } = await studio();

    const revolve = await fails(
      "revolve(axis=Axis.Z)",
      "OCP.OCP.StdFail.StdFail_NotDone: BRep_API: command not done",
    );
    const other = await fails(
      "loft()",
      "OCP.OCP.StdFail.StdFail_NotDone: BRep_API: command not done",
    );
    const fillet = await fails(
      "fillet(made.edges(), radius=3)",
      "ValueError: Failed creating a fillet with radius of 3, try a smaller value or use max_fillet() to find the largest valid fillet radius",
    );

    expect(revolve).toContain("its profile crosses the axis it turns about");
    expect(revolve).not.toContain("its words never say why");
    expect(other).toContain(
      "The geometry kernel could not make the shape on the line the error names, and its words never say why.",
    );
    expect(fillet).toContain(
      "part.max_fillet(edges, max_iterations=20) gives the largest radius those edges take (with its default 10 steps it gives up on most parts over about 25 mm)",
    );
  });

  it("adds nothing to an error it knows nothing of", async () => {
    const { fails } = await studio();

    expect(
      await fails("Boks(1, 1, 1)", "NameError: name 'Boks' is not defined"),
    ).toBe(
      "The script failed:\n  File \"the script\", line 4, in <module>\n    Boks(1, 1, 1)\nNameError: name 'Boks' is not defined",
    );
  });
});

describe("cad_api asked for a name only a later release has", () => {
  it("answers it with what the version installed has instead, starting no Python", async () => {
    const { call, requests } = await studio();

    const answer = await call("cad_api", {
      names: ["BuildSheet", "bd_warehouse.gear.BevelGear"],
    });

    expect(requests).toEqual([]);
    expect(answer.isError).toBeUndefined();
    expect(answer.content[0]?.text).toMatch(
      new RegExp(
        `^BuildSheet is not in build123d ${build123d.replace(/\./g, "\\.")}, the version installed: only the development docs, which describe a later release, have it\\.[^\\n]*\\n\\nBevelGear is not in bd_warehouse`,
      ),
    );
  });

  it("hands the harness that answer to place among the names it looks up, and never takes bd_warehouse's flange for build123d's", async () => {
    const { call, requests } = await studio();

    await call("cad_api", {
      names: ["extrude", "filter_by_value", "bd_warehouse.flange"],
    });

    expect(requests).toEqual([
      expect.objectContaining({
        api: ["extrude", "filter_by_value", "bd_warehouse.flange"],
        later: {
          filter_by_value: expect.stringContaining(
            "filter_by(lambda edge: abs(edge.length - 20) < 0.01)",
          ),
        },
      }),
    ]);
  });
});

describe("the CAD tools' descriptions", () => {
  it("name the versions installed, and say cad_api answers a name only the development docs have", () => {
    const description = (name: string) =>
      cadTools.find((tool) => tool.name === name)!.description;

    expect(description("cad_build")).toContain(
      `Build exact CAD parts with build123d ${short} and check them`,
    );
    expect(description("cad_api")).toContain(
      `for the version installed, build123d ${build123d} and bd_warehouse ${warehouse}`,
    );
    expect(description("cad_api")).toContain(
      `a name only they have, such as BuildSheet, flange or BevelGear, is answered with what ${build123d} has instead`,
    );
  });
});
