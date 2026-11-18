/**
 * The CAD studio's tool as the model and the person meet it: what a build is
 * approved as, what it may reach, and what it answers and writes. Python is a
 * stand-in that answers as the harness would; the real harness runs in the
 * system-boundary tests.
 */

import {
  link,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import type {
  SceneLines,
  SceneLinesRequest,
  ToolCallInspection,
} from "@zhiyin/contract";
import { cadAutomation, type CadPython, type CadRun } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const plate = {
  name: "Plate",
  valid: true,
  solids: 1,
  size: [80, 50, 8],
  min: [-40, -25, -4],
  max: [40, 25, 4],
  volume: 31012.1482,
  area: 10249.9468,
  centre: [-0.0905, 0, -0.0161],
  faces: { plane: 7, cylinder: 8 },
  holes: [
    { diameter: 5, count: 2 },
    { diameter: 6, count: 1 },
  ],
};

/** The first run of a build, which runs the model's script: what it was asked, and the folder it writes. */
type ScriptRequest = {
  readonly phase: "script";
  readonly script: string;
  readonly file: string | null;
  readonly name: string | null;
  readonly source?: string;
  readonly arguments: readonly string[];
  readonly output: string;
  readonly seconds: number;
};

type Script = (request: ScriptRequest) => Promise<{
  exitCode: number | null;
  stdout?: string;
  ending?: "timeout" | "stopped" | "outputLimit";
}>;

/** Runs the script as the harness would: hands on the parts it built, and prints. */
const scripts: Script = async (request) => {
  await writeFile(join(request.output, "manifest.json"), "{}");
  return { exitCode: 0, stdout: "made it\n" };
};

/** A script that prints nothing. */
const quietly: Script = async (request) => {
  await writeFile(join(request.output, "manifest.json"), "{}");
  return { exitCode: 0 };
};

/** The second run, the harness alone, measuring what the first built: the drawing's or build's request. */
type Harness = (request: {
  readonly output: string;
  readonly exports: readonly { file: string; kind: string; parts?: string[] }[];
  readonly picture: string;
  readonly preview?: string;
}) => Promise<{
  exitCode: number | null;
  ending?: "timeout" | "stopped" | "outputLimit";
}>;

/** Writes what the harness would: the exports, a picture and the answer. */
const builds: Harness = async (request) => {
  for (const one of request.exports)
    await writeFile(join(request.output, one.file), `${one.kind} of the part`);
  await writeFile(
    join(request.output, request.picture),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
  );
  if (request.preview)
    await writeFile(join(request.output, request.preview), "glTF of the parts");
  await writeFile(
    join(request.output, "answer.json"),
    JSON.stringify({
      ...(request.preview ? { preview: request.preview } : {}),
      parts: [plate],
      overlaps: [],
      exports: request.exports.map((one) => ({
        file: one.file,
        bytes: 2048,
        // The helpers module holds no part.
        parts: one.kind === "helpers" ? [] : (one.parts ?? ["Plate"]),
      })),
      seconds: { total: 3.4 },
      picture: request.picture,
    }),
  );
  return { exitCode: 0 };
};

async function studio(
  options: {
    readonly state?: "ready" | "unavailable";
    readonly harness?: Harness;
    /** The run of the model's script, before the harness measures what it built. */
    readonly script?: Script;
    /** Zhiyin's data reached through a junction, as when AppData is moved. */
    readonly dataThroughJunction?: boolean;
    /** The conversation's Blender scene, which a drawing can be of. */
    readonly sceneLines?: SceneLines;
    /** Zhiyin's own folders, which no file is written in. */
    readonly protect?: readonly string[];
  } = {},
) {
  const root = await folders.make("zhiyin-cad-workspace-");
  let data = await folders.make("zhiyin-cad-data-");
  if (options.dataThroughJunction) {
    await mkdir(join(data, "real"));
    await symlink(join(data, "real"), join(data, "moved"), "junction");
    data = join(data, "moved");
  }
  const runs: CadRun[] = [];
  let asked: ScriptRequest | undefined;
  /** Each preview of the parts shown beside the conversation, read as it was handed over. */
  const previews: { model: string; parts: unknown; script?: string }[] = [];
  const python: CadPython = {
    state: async () => options.state ?? "ready",
    run: async (request) => {
      runs.push(request);
      const given = JSON.parse(
        await readFile(request.arguments.at(-1)!, "utf8"),
      ) as Record<string, unknown>;
      // What the script's run was asked, which a harness below may look at too.
      if (given["phase"] === "script") asked = given as ScriptRequest;
      const ran: Awaited<ReturnType<Script>> =
        given["phase"] === "script"
          ? await (options.script ?? scripts)(given as ScriptRequest)
          : await (options.harness ?? builds)({
              ...asked,
              ...given,
            } as Parameters<Harness>[0]);
      return {
        ok: true,
        run: {
          exitCode: ran.exitCode,
          stdout: ran.stdout ?? "",
          stderr: "",
          ...(ran.ending ? { ending: ran.ending } : {}),
        },
      };
    },
  };
  const harness = join(data, "harness", "run.py");
  const tools = cadAutomation(python, {
    workspaceRoot: () => root,
    harness,
    directory: join(data, "cad-studio"),
    preview: async (model, parts, script) => {
      previews.push({
        model: await readFile(model, "utf8"),
        parts,
        ...(script === undefined ? {} : { script }),
      });
    },
    ...(options.sceneLines ? { sceneLines: options.sceneLines } : {}),
    ...(options.protect ? { protect: options.protect } : {}),
  });
  return { root, data, runs, tools, harness, previews };
}

const code = 'from build123d import *\nshow(Box(80, 50, 8), name="Plate")\n';

/** The identity an approval holds, of an inspection that found the call valid. */
const identityOf = (inspected: ToolCallInspection) =>
  inspected.ok ? inspected.identity : undefined;

describe("a workspace script and the modules beside it", () => {
  it("does not run an approved build once a module beside its script changed after the approval", async () => {
    const { tools, root, runs } = await studio();
    await writeFile(join(root, "plate.py"), code);
    await writeFile(join(root, "sizes.py"), "WIDTH = 80\n");
    const asked = await tools.inspect("cad_build", { file: "plate.py" });
    await writeFile(join(root, "sizes.py"), "WIDTH = 90\n");

    await tools.callTool(
      "cad_build",
      { file: "plate.py" },
      undefined,
      identityOf(asked),
    );

    expect(runs).toHaveLength(0);
  });
});

describe("approving a build", () => {
  it("names a script by the parts it shows, else by the files it writes", async () => {
    const { tools } = await studio();
    const assembly = [
      "from build123d import *",
      'show(Box(1, 1, 1), name="Base")',
      'show([Box(1, 1, 1).moved(Location((x, 0, 0))) for x in (1, 2)], name="Block")',
      "show(Box(1, 1, 1).moved(Location((0, 0, 2))),",
      '     name="Shaft")',
      "show(Box(1, 1, 1), name='Disc')",
    ].join("\n");
    const unnamed = [
      "from build123d import *",
      "for n in ('A', 'B'):",
      "    show(Box(1, 1, 1), name=n)",
    ].join("\n");

    const parts = await tools.inspect("cad_build", { code: assembly });
    const drawing = await tools.inspect("cad_draw", {
      code: assembly,
      parts: ["Shaft"],
      outputs: [{ path: "shaft.pdf" }],
    });
    const exported = await tools.inspect("cad_build", {
      code: unnamed,
      exports: [{ path: "a.step" }, { path: "b.step" }],
    });
    const bare = await tools.inspect("cad_build", { code: unnamed });

    expect(parts).toMatchObject({
      action: "Build CAD parts",
      target: "Base, Block, Shaft and Disc",
    });
    expect(drawing).toMatchObject({
      action: "Draw a CAD part",
      target: "Shaft",
    });
    expect(exported).toMatchObject({ target: "a.step and b.step" });
    expect(bare).toMatchObject({ target: "a script" });
  });

  it("shows the script whole, says it reads the workspace offline, and names each file it writes", async () => {
    const { tools, root } = await studio();
    await writeFile(join(root, "old.step"), "an older part");

    const asked = await tools.inspect("cad_build", {
      code,
      exports: [{ path: "parts/plate.stl" }, { path: "old.step" }],
    });

    expect(asked).toMatchObject({
      ok: true,
      action: "Build a CAD part",
      target: "Plate",
      command: code,
      detail:
        "The script reads the workspace and cannot use the internet. Zhiyin writes only parts/plate.stl, old.step.",
      effects: expect.objectContaining({ changes: "workspace" }),
      changes: [
        { path: "parts/plate.stl", change: "created" },
        { path: "old.step", change: "updated" },
      ],
    });
    // One that replaces a file is asked about on its own.
    expect(asked).not.toHaveProperty("allowance");
  });

  it("lays a build out for the person in words, a workspace script's code whole", async () => {
    const { tools, root } = await studio();
    await writeFile(join(root, "plate.py"), code);

    const asked = await tools.inspect("cad_build", {
      file: "plate.py",
      arguments: ["80", "50", "steel plate"],
      exports: [
        { path: "plate.step" },
        { path: "plate.stl", parts: ["Plate"] },
        { path: "plate-views.png", parts: ["Plate"] },
        { path: "plate.glb" },
        { path: "plate-close.glb", detail: "close-up" },
      ],
    });
    const measured = await tools.inspect("cad_build", { code });

    expect(asked).toMatchObject({
      ok: true,
      invocation: {
        name: "Build a CAD part",
        arguments: [
          { name: "Code", value: code, runs: true },
          { name: "Script", value: "plate.py", readable: true },
          { name: "Arguments", value: '80 50 "steel plate"', readable: true },
        ],
      },
      // Each file it writes is listed once, with what it holds.
      changes: [
        {
          path: "plate.step",
          change: "created",
          omitted: "The part's exact faces in STEP.",
        },
        {
          path: "plate.stl",
          change: "created",
          omitted: "A mesh of Plate in STL, for printing.",
        },
        {
          path: "plate-views.png",
          change: "created",
          omitted: "The views of Plate in PNG, as the answer shows them.",
        },
        {
          path: "plate.glb",
          change: "created",
          omitted: "A mesh of the parts shown in glTF binary, for viewing.",
        },
        {
          path: "plate-close.glb",
          change: "created",
          omitted: "A mesh of the parts shown in glTF binary, for close-ups.",
        },
      ],
    });
    expect(asked.ok && asked.invocation?.arguments).toHaveLength(3);
    // A build that writes nothing says so, once.
    expect(measured).toMatchObject({
      detail: expect.stringContaining("Nothing is written."),
      invocation: {
        name: "Build a CAD part",
        arguments: [{ name: "Code", value: code, runs: true }],
      },
    });
    expect(measured.ok && measured.invocation?.arguments).toHaveLength(1);
  });

  it("lets builds that write only new files be allowed for the conversation", async () => {
    const { tools } = await studio();

    const asked = await tools.inspect("cad_build", {
      code,
      exports: [{ path: "plate.step" }],
    });
    const reading = await tools.inspect("cad_build", { code });

    expect(asked).toMatchObject({
      ok: true,
      allowance: { label: expect.any(String) },
    });
    expect(reading).toMatchObject({
      ok: true,
      effects: expect.objectContaining({ changes: "none" }),
      detail:
        "The script reads the workspace and cannot use the internet. Nothing is written.",
    });
  });

  it("keeps the allowance for a build that replaces only files this conversation's builds wrote, unchanged since", async () => {
    const { tools, root } = await studio();
    const exports = [{ path: "plate.step" }];
    await tools.callTool(
      "cad_build",
      { code, exports },
      undefined,
      identityOf(await tools.inspect("cad_build", { code, exports })),
    );

    const again = await tools.inspect("cad_build", { code, exports });
    await writeFile(join(root, "plate.step"), "edited by the person");
    const edited = await tools.inspect("cad_build", { code, exports });
    await writeFile(join(root, "kept.step"), "the person's own part");
    const theirs = await tools.inspect("cad_build", {
      code,
      exports: [{ path: "kept.step" }],
    });

    expect(again).toMatchObject({
      ok: true,
      changes: [{ path: "plate.step", change: "updated" }],
      allowance: { label: expect.any(String) },
    });
    expect(edited).not.toHaveProperty("allowance");
    expect(theirs).not.toHaveProperty("allowance");
  });

  it("does not run a build allowed to replace its own file once the file has changed since", async () => {
    const { tools, root } = await studio();
    const exports = [{ path: "plate.step" }];
    const first = await tools.inspect("cad_build", { code, exports });
    await tools.callTool(
      "cad_build",
      { code, exports },
      undefined,
      identityOf(first),
    );
    const allowed = await tools.inspect("cad_build", { code, exports });

    await writeFile(join(root, "plate.step"), "edited by the person");
    const ran = (await tools.callTool(
      "cad_build",
      { code, exports },
      undefined,
      identityOf(allowed),
    )) as { isError?: boolean };

    expect(ran.isError).toBe(true);
    expect(await readFile(join(root, "plate.step"), "utf8")).toBe(
      "edited by the person",
    );
  });

  it("shows a workspace script as the code it holds", async () => {
    const { tools, root } = await studio();
    await mkdir(join(root, "cad"));
    await writeFile(join(root, "cad", "plate.py"), code);

    const asked = await tools.inspect("cad_build", { file: "cad/plate.py" });

    expect(asked).toMatchObject({
      ok: true,
      target: "cad/plate.py",
      command: code,
    });
  });

  it("refuses what cannot run as shown, before anyone is asked", async () => {
    const { tools, root } = await studio();
    await writeFile(join(root, "notes.txt"), "not code");
    const refused = async (args: Record<string, unknown>) =>
      tools.inspect("cad_build", args);

    expect(await refused({ code, file: "plate.py" })).toMatchObject({
      ok: false,
      reason: "Give code or a file, not both.",
      correctable: true,
    });
    expect(await refused({})).toMatchObject({ ok: false, correctable: true });
    expect(await refused({ file: "notes.txt" })).toMatchObject({
      ok: false,
      reason: "notes.txt is not a .py file.",
    });
    expect(
      await refused({ code: "# -*- coding: utf-7 -*-\nshow(x)" }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("utf-7") });
    expect(
      await refused({ code, exports: [{ path: "plate.obj" }] }),
    ).toMatchObject({
      ok: false,
      reason:
        "plate.obj must end in .step, .stp, .stl, .3mf, .glb, .png, .csv or .json.",
    });
    expect(
      await refused({
        code,
        exports: [{ path: "plate.stl", detail: "close-up" }],
      }),
    ).toMatchObject({
      ok: false,
      reason:
        'exports[0].detail "close-up" meshes a .glb finer; .stl and .3mf are always meshed for printing.',
      correctable: true,
    });
    expect(
      await refused({
        code,
        exports: [{ path: "a.step" }, { path: "sub/../a.step" }],
      }),
    ).toMatchObject({ ok: false, reason: "a.step is named twice in exports." });
    expect(
      await refused({
        code,
        exports: Array.from({ length: 9 }, (_, n) => ({ path: `${n}.stl` })),
      }),
    ).toMatchObject({
      ok: false,
      reason: "exports lists at most 8 files to write.",
    });
  });

  it("writes the helpers module beside a script only under its own name, and says what it holds", async () => {
    const { tools, root } = await studio();
    await writeFile(join(root, "plate.py"), code);

    expect(
      await tools.inspect("cad_build", {
        file: "plate.py",
        exports: [{ path: "helpers.py" }],
      }),
    ).toMatchObject({
      ok: false,
      reason:
        "helpers.py: a .py export is the helpers module, named zhiyin_cad_helpers.py beside the script that imports it.",
      correctable: true,
    });
    expect(
      await tools.inspect("cad_build", {
        file: "plate.py",
        exports: [{ path: "zhiyin_cad_helpers.py", parts: ["Plate"] }],
      }),
    ).toMatchObject({
      ok: false,
      reason:
        "zhiyin_cad_helpers.py holds show and the helpers, no part: give it only its path.",
    });
    const approved = await tools.inspect("cad_build", {
      file: "plate.py",
      exports: [{ path: "zhiyin_cad_helpers.py" }],
    });
    expect(approved).toMatchObject({
      ok: true,
      changes: [
        {
          path: "zhiyin_cad_helpers.py",
          change: "created",
          omitted:
            "Show and the helpers as one module, so a script beside it runs with build123d outside Zhiyin.",
        },
      ],
    });

    const result = await tools.callTool(
      "cad_build",
      { file: "plate.py", exports: [{ path: "zhiyin_cad_helpers.py" }] },
      undefined,
      identityOf(approved),
    );
    expect(await readFile(join(root, "zhiyin_cad_helpers.py"), "utf8")).toBe(
      "helpers of the part",
    );
    expect(JSON.stringify(result)).toContain(
      "Wrote zhiyin_cad_helpers.py (1 KB): show and the helpers as one module, so a script beside it runs with build123d outside Zhiyin.",
    );
  });

  it("refuses a script or an export outside the workspace, as nothing the model can fix", async () => {
    const { tools } = await studio();

    const script = await tools.inspect("cad_build", { file: "../part.py" });
    const exported = await tools.inspect("cad_build", {
      code,
      exports: [{ path: "../part.step" }],
    });

    expect(script).toEqual({
      ok: false,
      reason: "../part.py is outside the workspace.",
    });
    expect(exported).toEqual({
      ok: false,
      reason: "../part.step is outside the workspace.",
    });
  });

  it("writes an export outside the workspace where the person approves its whole real path, which no allowance covers", async () => {
    const { tools, root } = await studio();
    const elsewhere = await realpath(
      await folders.make("zhiyin-cad-elsewhere-"),
    );
    const target = join(elsewhere, "out", "part.step");
    const args = {
      code,
      exports: [{ path: target }, { path: "inside.stl" }],
    };

    const asked = await tools.inspect("cad_build", args);

    expect(asked).toMatchObject({
      ok: true,
      effects: expect.objectContaining({ changes: "elsewhere" }),
      changes: [
        { path: target, change: "created" },
        { path: "inside.stl", change: "created" },
      ],
    });
    expect(asked.ok && asked.detail).toMatch(
      new RegExp(
        `^The STEP file ${target.replaceAll("\\", "\\\\")} is written outside the folder you selected\\. `,
      ),
    );
    expect(asked.ok && "allowance" in asked).toBe(false);

    const result = await tools.callTool(
      "cad_build",
      args,
      undefined,
      identityOf(asked),
    );

    expect(await readFile(target, "utf8")).toBe("step of the part");
    expect(await readFile(join(root, "inside.stl"), "utf8")).toBe(
      "stl of the part",
    );
    expect(
      (result as { content: { text?: string }[] }).content[0]?.text,
    ).toContain(`Wrote ${target} (1 KB)`);
    expect(tools.produced("cad_build", args, result)).toEqual([
      {
        path: target.replaceAll("\\", "/"),
        change: "created",
        bytes: "step of the part".length,
      },
      {
        path: "inside.stl",
        change: "created",
        bytes: "stl of the part".length,
      },
    ]);
  });

  it("refuses an export outside the workspace in Zhiyin's own folders, or through a link whose target is missing", async () => {
    // Zhiyin's own data folder, which no file a call writes may be in.
    const kept = await folders.make("zhiyin-cad-own-data-");
    const { tools } = await studio({ protect: [kept] });
    const record = join(kept, "cad-studio", "part.step");
    const elsewhere = await realpath(
      await folders.make("zhiyin-cad-elsewhere-"),
    );
    await mkdir(join(elsewhere, "gone"));
    await symlink(join(elsewhere, "gone"), join(elsewhere, "link"), "junction");
    await rm(join(elsewhere, "gone"), { recursive: true });
    const dangling = join(elsewhere, "link", "part.step");

    expect(
      await tools.inspect("cad_build", {
        code,
        exports: [{ path: record }],
      }),
    ).toMatchObject({
      ok: false,
      correctable: true,
      reason: `${record} is in a folder Zhiyin keeps for itself, which no tool writes. Choose another place for the file.`,
    });
    expect(
      await tools.inspect("cad_build", {
        code,
        exports: [{ path: dangling }],
      }),
    ).toEqual({
      ok: false,
      reason: `${dangling} leads through a link whose target is missing, so where it would be written is not known.`,
    });
  });

  it("names each tool for the person while a call to it is written", async () => {
    const { tools } = await studio();

    expect(
      Object.fromEntries(
        (await tools.listTools()).map((tool) => [tool.name, tool.label]),
      ),
    ).toEqual({
      cad_build: "Build a CAD part",
      cad_draw: "Make an engineering drawing",
      cad_api: "Look up the CAD library",
    });
  });

  it("looks a name up in the CAD library without reading or writing the workspace", async () => {
    const { tools, runs } = await studio();

    const inspected = await tools.inspect("cad_api", { name: "round_edges" });
    expect(inspected).toMatchObject({
      ok: true,
      action: "Look up the CAD library",
      target: "round_edges",
      effects: expect.objectContaining({ changes: "none" }),
    });
    expect(runs).toHaveLength(0);
    expect(
      await tools.inspect("cad_api", { name: "import os; os.remove('x')" }),
    ).toMatchObject({ ok: false, correctable: true });
  });

  it("looks several names up in one call, and refuses a list holding one that is not a name", async () => {
    const { tools } = await studio();

    const several = await tools.inspect("cad_api", {
      names: ["round_edges", "coil", "bd_warehouse.bearing"],
    });
    expect(several).toMatchObject({
      ok: true,
      target: "round_edges, coil, bd_warehouse.bearing",
      invocation: {
        arguments: [
          {
            name: "Looks up",
            value: "round_edges, coil, bd_warehouse.bearing",
          },
        ],
      },
    });
    expect(
      await tools.inspect("cad_api", { names: ["coil", "os.system('x')"] }),
    ).toMatchObject({ ok: false, correctable: true });
    expect(
      await tools.inspect("cad_api", { name: "coil", names: ["pipe"] }),
    ).toMatchObject({ ok: false, correctable: true });
    expect(
      await tools.inspect("cad_api", {
        names: Array.from({ length: 13 }, (_, k) => `name${k}`),
      }),
    ).toMatchObject({ ok: false, correctable: true });
  });

  it("tells the model how long a look-up may take, and says one stopped there took too long, with what to do instead", async () => {
    const { tools } = await studio({
      harness: async () => ({ exitCode: null, ending: "timeout" }),
    });

    const description = (await tools.listTools()).find(
      (tool) => tool.name === "cad_api",
    )?.description;
    const result = (await tools.callTool("cad_api", {
      names: ["round_edges", "coil"],
    })) as { isError?: boolean; content: { text?: string }[] };

    expect(description).toContain("A look-up may take a minute.");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "The look-up took longer than a minute, the most one may take, so it was stopped. Look up fewer names at a time.",
    );
  });

  it("takes where a draft requirement's mould parts, as a height along its pull, and says it does not check one that is not a number", async () => {
    const handed: unknown[] = [];
    const { tools, root } = await studio({
      harness: async (request) => {
        handed.push((request as { requirements?: unknown }).requirements);
        return builds(request);
      },
    });
    const draft = { id: "D1", check: "draft", part: "Plate", min: 2 };
    await writeFile(
      join(root, "parted.json"),
      JSON.stringify({ requirements: [{ ...draft, parting: 4.5 }] }),
    );
    await writeFile(
      join(root, "worded.json"),
      JSON.stringify({ requirements: [{ ...draft, parting: "the middle" }] }),
    );

    const parted = await tools.inspect("cad_build", {
      code,
      requirements: "parted.json",
    });
    await tools.callTool(
      "cad_build",
      { code, requirements: "parted.json" },
      undefined,
      identityOf(parted),
    );
    const wordedAsked = await tools.inspect("cad_build", {
      code,
      requirements: "worded.json",
    });
    const worded = (await tools.callTool(
      "cad_build",
      { code, requirements: "worded.json" },
      undefined,
      identityOf(wordedAsked),
    )) as { content: { text?: string }[] };

    expect(parted).toMatchObject({ ok: true });
    // The build goes ahead, checking nothing, and says why.
    expect(handed).toEqual([[{ ...draft, parting: 4.5 }], undefined]);
    expect(worded.content[0]?.text).toContain(
      "No requirement was checked: worded.json: D1: parting is the height along the pull, in mm, where the mould splits; left out, at the part's lowest.",
    );
  });

  it("reads a file shared with the 3D studio, checking the kinds it measures and saying the others are measured there", async () => {
    const handed: unknown[] = [];
    const { tools, root } = await studio({
      harness: async (request) => {
        handed.push((request as { requirements?: unknown }).requirements);
        return builds(request);
      },
    });
    const fits = { id: "R1", check: "fits", box: [256, 256, 256] };
    const thickness = {
      id: "R2",
      says: "The seat is 40 to 60 mm thick",
      check: "thickness",
      part: "Seat",
      range: [40, 60],
    };
    await writeFile(
      join(root, "shared.json"),
      JSON.stringify({ requirements: [thickness, fits] }),
    );
    await writeFile(
      join(root, "misfielded.json"),
      JSON.stringify({ requirements: [{ ...thickness, range: "thick" }] }),
    );
    const build = async (file: string) => {
      const asked = await tools.inspect("cad_build", {
        code,
        requirements: file,
      });
      return (await tools.callTool(
        "cad_build",
        { code, requirements: file },
        undefined,
        identityOf(asked),
      )) as { content: { text?: string }[] };
    };

    const shared = await build("shared.json");
    const misfielded = await build("misfielded.json");

    // Only the kinds the CAD studio measures reach its harness.
    expect(handed).toEqual([[fits], undefined]);
    expect(shared.content[0]?.text).toContain(
      "R2 (The seat is 40 to 60 mm thick) not checked: a thickness requirement is measured in the 3D studio.",
    );
    expect(misfielded.content[0]?.text).toContain(
      "No requirement was checked: misfielded.json: R2: range is the thickness in mm, a number it must be or [least, most].",
    );
  });

  it("takes how wide a bridge an overhang requirement allows, in mm, and says it does not check one below zero", async () => {
    const handed: unknown[] = [];
    const { tools, root } = await studio({
      harness: async (request) => {
        handed.push((request as { requirements?: unknown }).requirements);
        return builds(request);
      },
    });
    const overhang = { id: "O1", check: "overhang", part: "Plate", max: 45 };
    await writeFile(
      join(root, "bridged.json"),
      JSON.stringify({ requirements: [{ ...overhang, bridge: 10 }] }),
    );
    await writeFile(
      join(root, "negative.json"),
      JSON.stringify({ requirements: [{ ...overhang, bridge: -1 }] }),
    );

    const bridged = await tools.inspect("cad_build", {
      code,
      requirements: "bridged.json",
    });
    await tools.callTool(
      "cad_build",
      { code, requirements: "bridged.json" },
      undefined,
      identityOf(bridged),
    );
    const negativeAsked = await tools.inspect("cad_build", {
      code,
      requirements: "negative.json",
    });
    const negative = (await tools.callTool(
      "cad_build",
      { code, requirements: "negative.json" },
      undefined,
      identityOf(negativeAsked),
    )) as { content: { text?: string }[] };

    expect(bridged).toMatchObject({ ok: true });
    // The build goes ahead, checking nothing, and says why.
    expect(handed).toEqual([[{ ...overhang, bridge: 10 }], undefined]);
    expect(negative.content[0]?.text).toContain(
      "No requirement was checked: negative.json: O1: bridge is the widest gap in mm the printer crosses in the air, from one edge held up from below to another; 0 or more.",
    );
  });

  it("offers no tool, and runs nothing, a look-up included, until its environment is installed", async () => {
    const { tools, runs } = await studio({ state: "unavailable" });
    const refused = {
      ok: false,
      reason: expect.stringContaining("not installed"),
    };

    await expect(tools.listTools()).rejects.toThrow(/not installed/);
    expect(await tools.inspect("cad_build", { code })).toMatchObject(refused);
    expect(
      await tools.inspect("cad_draw", {
        code,
        outputs: [{ path: "plate.pdf" }],
      }),
    ).toMatchObject(refused);
    expect(await tools.inspect("cad_api", { name: "extrude" })).toMatchObject(
      refused,
    );
    expect(runs).toHaveLength(0);
  });
});

describe("checking a build at several positions", () => {
  it("lays out each position, hands them all to the harness, and refuses them beside arguments or in a drawing", async () => {
    let given: unknown;
    const { tools, root } = await studio({
      harness: async (request) => {
        given = request;
        return { exitCode: 2 };
      },
    });
    await writeFile(join(root, "hinge.py"), code);
    const positions = [["0"], ["90"], ["180", "open"]];

    const asked = await tools.inspect("cad_build", {
      file: "hinge.py",
      positions,
    });
    await tools.callTool("cad_build", { file: "hinge.py", positions });
    const both = await tools.inspect("cad_build", {
      file: "hinge.py",
      arguments: ["0"],
      positions,
    });
    const drawn = await tools.inspect("cad_draw", {
      file: "hinge.py",
      positions,
      outputs: [{ path: "hinge.pdf" }],
    });
    const empty = await tools.inspect("cad_build", {
      file: "hinge.py",
      positions: [],
    });

    expect(asked.ok && asked.invocation?.arguments).toContainEqual({
      name: "Positions",
      value: "0; 90; 180 open",
      readable: true,
    });
    expect(given).toMatchObject({ arguments: ["0"], positions });
    expect(both).toMatchObject({
      ok: false,
      reason:
        "positions gives the arguments of each run; leave out arguments, or give one position.",
    });
    expect(drawn).toMatchObject({
      ok: false,
      reason:
        "positions is for cad_build; a drawing is of one position, given in arguments.",
    });
    expect(empty).toMatchObject({
      ok: false,
      reason:
        "positions lists from 1 to 24 runs, each a list of the arguments it is given.",
    });
  });

  it("refuses a rigid sweep beside positions, or in a drawing", async () => {
    const { tools, root } = await studio({
      harness: async () => ({ exitCode: 2 }),
    });
    await writeFile(join(root, "hinge.py"), code);
    const sweep = {
      parts: ["Lid"],
      through: [0, 0, 0],
      along: [0, 0, 1],
      from: 0,
      to: 90,
      steps: 6,
    };

    const both = await tools.inspect("cad_build", {
      file: "hinge.py",
      positions: [["0"], ["90"]],
      sweep,
    });
    const drawn = await tools.inspect("cad_draw", {
      file: "hinge.py",
      sweep,
      outputs: [{ path: "hinge.pdf" }],
    });

    expect(both).toMatchObject({
      ok: false,
      reason:
        "sweep moves parts of one build; leave positions out, or check the move with positions alone.",
    });
    expect(drawn).toMatchObject({ ok: false });
  });

  it("says which positions have parts overlapping, and where", async () => {
    const plate = {
      name: "Arm",
      valid: true,
      solids: 1,
      size: [80, 50, 8],
      min: [-40, -25, -4],
      max: [40, 25, 4],
      volume: 32000,
      area: 9000,
      centre: [0, 0, 0],
      faces: { plane: 6 },
      holes: [],
    };
    const answering =
      (positions: unknown[]): Harness =>
      async (request) => {
        await writeFile(
          join(request.output, "answer.json"),
          JSON.stringify({
            parts: [plate, { ...plate, name: "Stop" }],
            overlaps: [],
            positions,
            exports: [],
            seconds: { total: 1 },
          }),
        );
        return { exitCode: 0 };
      };
    const clashing = await studio({
      harness: answering([
        { arguments: ["0"], overlaps: [] },
        {
          arguments: ["90"],
          overlaps: [
            {
              first: "Arm",
              second: "Stop",
              volume: 1200,
              min: [30, -5, 40],
              max: [40, 5, 50],
            },
          ],
        },
        { arguments: ["180"], overlaps: [] },
      ]),
    });
    const clear = await studio({
      harness: answering([
        { arguments: ["0"], overlaps: [] },
        { arguments: ["90"], overlaps: [] },
      ]),
    });

    const some = JSON.stringify(
      await clashing.tools.callTool("cad_build", {
        code,
        positions: [["0"], ["90"], ["180"]],
      }),
    );
    const none = JSON.stringify(
      await clear.tools.callTool("cad_build", {
        code,
        positions: [["0"], ["90"]],
      }),
    );

    expect(some).toContain(
      "Checked for overlaps at 3 positions. At 90: Arm and Stop overlap by 1,200 mm³, from (30, -5, 40) to (40, 5, 50): parts that should only touch share that volume. No two parts overlap at 0 and 180.",
    );
    expect(none).toContain(
      "Checked for overlaps at 2 positions: no two parts overlap at any.",
    );
  });
});

describe("running a build", () => {
  it("lets the script read the workspace and write only a folder of its own, then removes that folder", async () => {
    const { tools, runs, root, data, harness } = await studio();

    await tools.callTool("cad_build", { code });

    const [run] = runs;
    expect(run?.cwd).toBe(root);
    // Neither the script's folder nor the current one on Python's path, and nothing compiled written.
    expect(run?.arguments.slice(0, 3)).toEqual(["-P", "-B", harness]);
    expect(run?.read).toEqual(
      expect.arrayContaining([root, join(data, "harness")]),
    );
    expect(run?.write).toHaveLength(1);
    expect(run?.write[0]).not.toContain(root);
    // A home of the run's own, which the studio removes with it.
    expect(run?.homeLastsOneRun).toBe(true);
    expect(await readdir(join(data, "cad-studio", "runs"))).toEqual([]);
  });

  it("removes, at the next run, a run folder Windows held on to, and never one a call is still using", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const { tools, data } = await studio({
      script: async (request) => {
        if (first) {
          // The first call waits, its run folder in use, while another call runs.
          first = false;
          await held;
        }
        return scripts(request);
      },
    });
    const runs = join(data, "cad-studio", "runs");

    const waiting = tools.callTool("cad_build", { code }) as Promise<{
      isError?: boolean;
    }>;
    while ((await readdir(runs).catch(() => [])).length < 1)
      await new Promise((wait) => setTimeout(wait, 5));
    // A folder an earlier run left, as when Windows held its profile.
    await mkdir(join(runs, "left-by-windows", "home"), { recursive: true });
    await writeFile(join(runs, "left-by-windows", "home", "profile"), "kept");
    const other = (await tools.callTool("cad_build", { code })) as {
      isError?: boolean;
    };
    const during = await readdir(runs);
    release();
    const waited = await waiting;

    expect(other.isError).toBeUndefined();
    expect(during).not.toContain("left-by-windows");
    // The waiting call's folder was left alone, and its build went on.
    expect(during).toHaveLength(1);
    expect(waited.isError).toBeUndefined();
    expect(await readdir(runs)).toEqual([]);
  });

  it("measures what the script built in a second run of the harness alone, which the script's run could not write to", async () => {
    const handed: unknown[] = [];
    const { tools, runs, root, data, harness } = await studio({
      harness: async (request) => {
        handed.push((request as { parts?: string }).parts);
        return builds(request);
      },
    });

    await tools.callTool("cad_build", { code, exports: [{ path: "p.step" }] });

    expect(runs).toHaveLength(2);
    const [script, measuring] = runs;
    // Isolated: nothing of the workspace on its path, nor of its environment, and UTF-8 as before.
    expect(measuring?.arguments.slice(0, 4)).toEqual([
      "-I",
      "-X",
      "utf8",
      harness,
    ]);
    expect(measuring?.read).not.toContain(root);
    expect(measuring?.read).toContain(join(data, "harness"));
    expect(measuring?.cwd).not.toBe(root);
    expect(measuring?.homeLastsOneRun).toBe(true);
    // Its output folder and home are of its own, and neither is one the script could write.
    for (const own of [...measuring!.write, measuring!.home]) {
      expect(script!.write).not.toContain(own);
      expect(own).not.toBe(script!.home);
      for (const written of [...script!.write, script!.home])
        expect(own.startsWith(written)).toBe(false);
    }
    // What the script's run handed on is the measuring run's only input from it.
    expect(handed).toEqual([join(script!.write[0]!, "manifest.json")]);
    expect(await readFile(join(root, "p.step"), "utf8")).toBe(
      "step of the part",
    );
  });

  it("writes the exports at the paths approved, and says what it built, with the picture", async () => {
    const { tools, root } = await studio();

    const result = (await tools.callTool("cad_build", {
      code,
      exports: [{ path: "out/plate.step" }],
    })) as { content: { type: string; text?: string; mimeType?: string }[] };

    expect(await readFile(join(root, "out", "plate.step"), "utf8")).toBe(
      "step of the part",
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Built 1 part in 3.4 s.");
    expect(text).toContain(
      "Plate: a valid solid, 80 × 50 × 8 mm, from (-40, -25, -4) to (40, 25, 4). Volume 31,012 mm³ (31 cm³), surface 10,250 mm², centre of mass at (-0.091, 0, -0.016). 15 faces: 8 cylindrical, 7 flat. Round holes: 2 of 5 mm, 1 of 6 mm.",
    );
    expect(text).toContain("Wrote out/plate.step (1 KB): Plate.");
    expect(text).toContain("What the script printed:\nmade it");
    expect(result.content[1]).toMatchObject({
      type: "image",
      mimeType: "image/png",
    });
    expect(tools.produced("cad_build", {}, result)).toEqual([
      { path: "out/plate.step", change: "created", bytes: 16 },
    ]);
  });

  it("shows the parts it built beside the conversation, from a preview kept out of the workspace", async () => {
    const { tools, root, data, previews } = await studio();
    await mkdir(join(root, "parts"));
    await writeFile(join(root, "parts", "plate.py"), code);

    await tools.callTool("cad_build", { code });
    await tools.callTool("cad_build", { file: "parts/plate.py" });

    expect(previews).toEqual([
      {
        model: "glTF of the parts",
        parts: [{ name: "Plate", size: [80, 50, 8], valid: true }],
      },
      {
        model: "glTF of the parts",
        parts: [{ name: "Plate", size: [80, 50, 8], valid: true }],
        script: "parts/plate.py",
      },
    ]);
    expect(await readdir(root)).toEqual(["parts"]);
    expect(await readdir(join(data, "cad-studio", "runs"))).toEqual([]);
  });

  it("shows nothing new for a build that failed, or whose preview could not be made", async () => {
    const failing = await studio({
      harness: async (request) => {
        await writeFile(
          join(request.output, "answer.json"),
          JSON.stringify({ failed: "The script failed:\nNameError" }),
        );
        return { exitCode: 2 };
      },
    });
    await failing.tools.callTool("cad_build", { code });
    expect(failing.previews).toEqual([]);

    const unpreviewed = await studio({
      harness: async (request) => {
        // A build whose mesh could not be written: everything else as usual.
        await builds({
          output: request.output,
          picture: request.picture,
          exports: [],
        });
        const answer = JSON.parse(
          await readFile(join(request.output, "answer.json"), "utf8"),
        ) as Record<string, unknown>;
        await writeFile(
          join(request.output, "answer.json"),
          JSON.stringify({ ...answer, previewFailed: "no mesh" }),
        );
        return { exitCode: 0 };
      },
    });
    const built = (await unpreviewed.tools.callTool("cad_build", { code })) as {
      isError?: boolean;
    };
    expect(built.isError).toBeUndefined();
    expect(unpreviewed.previews).toEqual([]);
  });

  it("answers a failed script with its reason and what it printed, and writes nothing", async () => {
    const { tools, root, runs } = await studio({
      script: async (request) => {
        await writeFile(
          join(request.output, "answer.json"),
          JSON.stringify({
            failed:
              "The script failed:\n  File \"script.py\", line 2, in <module>\nNameError: name 'Bx' is not defined",
          }),
        );
        return { exitCode: 2, stdout: "before\n" };
      },
    });

    const result = await tools.callTool("cad_build", {
      code,
      exports: [{ path: "plate.step" }],
    });

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain("NameError");
    expect(JSON.stringify(result)).toContain(
      "What the script printed:\\nbefore",
    );
    expect(await readdir(root)).toEqual([]);
    // Nothing is measured of a script that failed.
    expect(runs).toHaveLength(1);
  });

  it("says where a module the code could not import is, and how to build beside it", async () => {
    const failing = (module: string) => async (request: { output: string }) => {
      await writeFile(
        join(request.output, "answer.json"),
        JSON.stringify({
          failed: `The script failed:\n  File "script.py", line 2, in <module>\nModuleNotFoundError: No module named '${module}'`,
        }),
      );
      return { exitCode: 2 };
    };
    const { tools, root } = await studio({ script: failing("layout") });
    await mkdir(join(root, "design"));
    await writeFile(join(root, "design", "layout.py"), "BORE = 10\n");
    const missing = await studio({ script: failing("gears") });

    const beside = JSON.stringify(
      await tools.callTool("cad_build", { code: "import layout\n" }),
    );
    const nowhere = JSON.stringify(
      await missing.tools.callTool("cad_build", { code: "import gears\n" }),
    );

    expect(beside).toContain(
      "layout.py is in design: code runs from the workspace's top folder, so write this script into design and build it with file, where the files beside it import.",
    );
    expect(nowhere).not.toContain("code runs from the workspace's top folder");
  });

  it("says a build stopped or out of time did not finish, why when it is known, and what it printed", async () => {
    const ended = async (ending?: "timeout" | "stopped") => {
      const { tools } = await studio({
        script: async () => ({
          exitCode: null,
          stdout: "lobe 3 of 6\n",
          ...(ending ? { ending } : {}),
        }),
      });
      return (await tools.callTool("cad_build", { code })) as {
        isError?: boolean;
        content: { text?: string }[];
      };
    };

    const late = await ended("timeout");
    const stopped = await ended("stopped");
    const unknown = await ended();

    expect(late.isError).toBe(true);
    expect(late.content[0]?.text).toBe(
      "The build did not finish: it ran past the five minutes a build has.\nBuild less in a call, or ask again with more minutes, up to 30.\nWhat the script printed:\nlobe 3 of 6",
    );
    expect(stopped.content[0]?.text).toContain(
      "The build did not finish: it was stopped.",
    );
    expect(unknown.content[0]?.text).toContain(
      "The build did not finish: it was stopped, or ran past the five minutes a build has.",
    );
  });

  it("says a build that printed past its limit was stopped there, naming the limit and what to do instead", async () => {
    const { tools, runs } = await studio({
      script: async () => ({
        exitCode: null,
        stdout: "lobe 3 of 6\n",
        ending: "outputLimit",
      }),
    });

    const result = (await tools.callTool("cad_build", { code })) as {
      isError?: boolean;
      content: { text?: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "The build did not finish: it printed more than 64 MB, the most a build may print.\nPrint less from the script, such as a summary.\nWhat the script printed:\nlobe 3 of 6",
    );
    expect(runs.map((run) => run.maximumOutputBytes)).toEqual([
      64 * 1024 * 1024,
    ]);
  });

  it("names what nothing holds, and says when there was no time to find out", async () => {
    const answering = (loose: unknown) =>
      studio({
        harness: async (request) => {
          await writeFile(
            join(request.output, "answer.json"),
            JSON.stringify({
              parts: [plate, { ...plate, name: "Pin" }],
              overlaps: [],
              loose,
              exports: [],
              seconds: { total: 2 },
              picture: null,
            }),
          );
          return { exitCode: 0 };
        },
      });
    const said = async (loose: unknown) => {
      const { tools } = await answering(loose);
      const result = (await tools.callTool("cad_build", { code })) as {
        content: { text?: string }[];
      };
      return result.content[0]?.text ?? "";
    };

    const floating = await said({
      parts: ["Pin"],
      pieces: [{ part: "Plate", loose: 2, of: 5 }],
    });
    const late = await said({ parts: [], pieces: [], unchecked: true });
    const partly = await said({
      parts: [],
      pieces: [],
      unchecked: true,
      left: ["Bearing_1", "Plate"],
    });
    const none = await said({ parts: [], pieces: [] });

    expect(floating).toContain(
      "Held by nothing: Pin and 2 of the 5 pieces of Plate. Each piece of an assembly sits on, in or against another, or turns or slides in it with a clearance of a millimetre or less; one further than that from everything floats where it was put.",
    );
    expect(late).toContain(
      "Whether each piece is held by another was not found, for want of time",
    );
    expect(partly).toContain(
      "Whether every piece of Bearing_1 and Plate is held by another was not found, for want of time: so many curved pieces lie near others that measuring them all would take most of the build. Every other part is held. Check those parts alone, or fewer at once, to find what floats.",
    );
    expect(partly).not.toContain("Whether each piece");
    expect(none).not.toContain("Held by nothing");
    expect(none).not.toContain("for want of time");
  });

  it("says a drawing out of time ran past the time a drawing has, with how far its drafting got", async () => {
    const { tools } = await studio({
      script: async (request) => {
        await writeFile(join(request.output, "manifest.json"), "{}");
        return { exitCode: 0, stdout: "tip 3\n" };
      },
      harness: async (request) => {
        await writeFile(
          join(request.output, "progress.txt"),
          "Drew the top view: 12 lines.\nDrawing the front view, from 76412 lines Blender found.\n",
        );
        return { exitCode: null, ending: "timeout" };
      },
    });

    const late = (await tools.callTool("cad_draw", {
      code,
      outputs: [{ path: "late.pdf" }],
    })) as { isError?: boolean; content: { text?: string }[] };

    expect(late.isError).toBe(true);
    expect(late.content[0]?.text).toBe(
      "The drawing did not finish: it ran past the five minutes a drawing has.\nHow far it got:\nDrew the top view: 12 lines.\nDrawing the front view, from 76412 lines Blender found.\nDraw one subsystem per call, or, where the whole assembly is needed, ask again with more minutes, up to 30.\nWhat the script printed:\ntip 3",
    );
  });

  it("gives a build or a drawing the minutes the model asks for, up to 30, and says so in the approval", async () => {
    const given: unknown[] = [];
    const { tools, runs } = await studio({
      // Only the time each build is given matters here.
      script: async (request) => {
        given.push(request.seconds);
        return { exitCode: null, ending: "stopped" };
      },
    });
    const asked = (await tools.inspect("cad_build", {
      code,
      minutes: 12,
    })) as unknown as {
      invocation: { arguments: { name: string; value: string }[] };
    };

    expect(asked.invocation.arguments).toContainEqual({
      name: "Time",
      value: "runs for at most 12 minutes",
      readable: true,
    });
    await tools.callTool("cad_build", { code, minutes: 12 });
    await tools.callTool("cad_draw", {
      code,
      minutes: 30,
      outputs: [{ path: "long.pdf" }],
    });
    await tools.callTool("cad_build", { code });
    expect(given).toEqual([720, 1800, 300]);
    expect(runs.map((run) => run.timeoutMs)).toEqual([
      720_000, 1_800_000, 300_000,
    ]);
    for (const minutes of [0, 31, 2.5, "ten"])
      expect(
        await tools.inspect("cad_draw", {
          code,
          minutes,
          outputs: [{ path: "long.pdf" }],
        }),
      ).toMatchObject({
        ok: false,
        reason:
          "minutes is how long the drawing may run, a whole number from 1 to 30; left out, it has 5.",
      });
  });

  it("hands the sections asked for to the harness, says what the picture holds, and refuses a section it cannot draw", async () => {
    const asked: unknown[] = [];
    const { tools } = await studio({
      harness: async (request) => {
        asked.push((request as { sections?: unknown }).sections);
        await writeFile(
          join(request.output, request.picture),
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
        );
        await writeFile(
          join(request.output, "answer.json"),
          JSON.stringify({
            parts: [plate],
            overlaps: [],
            exports: [],
            seconds: { total: 2 },
            picture: request.picture,
            sections: 1,
            sectionNotes: [
              "Section 2 was not drawn: section 2's plane through (0, 0, 900) cuts no part: it lies beside them; put it through the part.",
            ],
          }),
        );
        return { exitCode: 0 };
      },
    });
    const sections = [
      { through: [0, 0, 0], looking: "front" },
      { through: [0, 0, 900], looking: "top", parts: ["Plate"] },
    ];

    const result = (await tools.callTool("cad_build", { code, sections })) as {
      content: { type: string; text?: string }[];
    };
    const sideways = await tools.inspect("cad_build", {
      code,
      sections: [{ through: [0, 0, 0], looking: "sideways" }],
    });
    const drawn = await tools.inspect("cad_draw", {
      code,
      sections,
      outputs: [{ path: "plate.pdf" }],
    });

    expect(asked).toEqual([sections]);
    expect(result.content[0]?.text).toContain(
      "Below them, the section asked for, numbered in order: each part's cut faces filled in its colour and hatched, the edges beyond the cut drawn.",
    );
    expect(result.content[0]?.text).toContain(
      "Section 2 was not drawn: section 2's plane through (0, 0, 900) cuts no part",
    );
    expect(sideways).toMatchObject({
      ok: false,
      reason:
        "sections[0].looking is the side it is seen from: front, back, top, bottom, right, left.",
    });
    expect(drawn).toMatchObject({
      ok: false,
      reason:
        "sections is for cad_build's picture; a drawing's sections are views, listed in views.",
    });
  });

  it("names the positions the build's time ran out before, to check in another call", async () => {
    const { tools } = await studio({
      harness: async (request) => {
        await writeFile(
          join(request.output, "answer.json"),
          JSON.stringify({
            parts: [plate, { ...plate, name: "Arm", holes: [] }],
            overlaps: [],
            positions: [
              { arguments: ["0"], overlaps: [] },
              { arguments: ["90"], overlaps: [] },
            ],
            unchecked: [["180"], ["270"]],
            exports: [],
            seconds: { total: 280, position: 21.37 },
          }),
        );
        return { exitCode: 0 };
      },
    });

    const result = (await tools.callTool("cad_build", {
      code,
      positions: [["0"], ["90"], ["180"], ["270"]],
    })) as { isError?: boolean; content: { text?: string }[] };

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain(
      "Checked for overlaps at 2 positions: no two parts overlap at any.",
    );
    expect(result.content[0]?.text).toContain(
      "Not checked, for want of time, each position taking about 21 s: at 180 and 270. Check them in another call.",
    );
  });

  it("does not run a workspace script changed after it was approved", async () => {
    const { tools, root, runs } = await studio();
    await writeFile(join(root, "plate.py"), code);
    const asked = await tools.inspect("cad_build", { file: "plate.py" });
    await writeFile(join(root, "plate.py"), `${code}import os\n`);

    const result = await tools.callTool(
      "cad_build",
      { file: "plate.py" },
      undefined,
      (asked as { identity?: string }).identity,
    );

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain(
      "changed after this build was approved",
    );
    expect(runs).toHaveLength(0);
  });

  it("does not write over a file that appeared at an export's path while the part was built", async () => {
    let root = "";
    const made = await studio({
      harness: async (request) => {
        await writeFile(join(root, "plate.step"), "made meanwhile");
        return builds(request);
      },
    });
    root = made.root;

    const result = await made.tools.callTool("cad_build", {
      code,
      exports: [{ path: "plate.step" }, { path: "plate.stl" }],
    });

    expect(await readFile(join(root, "plate.step"), "utf8")).toBe(
      "made meanwhile",
    );
    expect(await readFile(join(root, "plate.stl"), "utf8")).toBe(
      "stl of the part",
    );
    expect(JSON.stringify(result)).toContain(
      "plate.step was not written: a file appeared there while the part was built. Build again to approve replacing it.",
    );
    expect(made.tools.produced("cad_build", {}, result)).toEqual([
      { path: "plate.stl", change: "created", bytes: 15 },
    ]);
  });

  it("does not write through a folder that became a link elsewhere while the part was built", async () => {
    let root = "";
    const elsewhere = await folders.make("zhiyin-cad-elsewhere-");
    const made = await studio({
      harness: async (request) => {
        await rm(join(root, "out"), { recursive: true });
        await symlink(elsewhere, join(root, "out"), "junction");
        return builds(request);
      },
    });
    root = made.root;
    await mkdir(join(root, "out"));

    const result = await made.tools.callTool("cad_build", {
      code,
      exports: [{ path: "out/plate.step" }],
    });

    expect(await readdir(elsewhere)).toEqual([]);
    expect(JSON.stringify(result)).toContain(
      "out/plate.step was not written: its folder changed while the part was built.",
    );
  });

  it("never writes an export through a link whose target is missing, which could lead anywhere", async () => {
    const elsewhere = await folders.make("zhiyin-cad-elsewhere-");
    const { tools, root } = await studio();
    await symlink(
      join(elsewhere, "plate.step"),
      join(root, "plate.step"),
      "file",
    );
    const exports = [{ path: "plate.step" }];

    const inspected = await tools.inspect("cad_build", { code, exports });
    await tools.callTool("cad_build", { code, exports });

    expect(inspected.ok).toBe(false);
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it("does not replace a file of its own that changed while the part was built", async () => {
    let root = "";
    let during = async () => {};
    const made = await studio({
      harness: async (request) => {
        await during();
        return builds(request);
      },
    });
    root = made.root;
    const exports = [{ path: "plate.step" }];
    await made.tools.callTool("cad_build", { code, exports });
    during = () => writeFile(join(root, "plate.step"), "edited meanwhile");

    const result = await made.tools.callTool(
      "cad_build",
      { code, exports },
      undefined,
      identityOf(await made.tools.inspect("cad_build", { code, exports })),
    );

    expect(await readFile(join(root, "plate.step"), "utf8")).toBe(
      "edited meanwhile",
    );
    expect(JSON.stringify(result)).toContain(
      "plate.step was not written: it changed while the part was built, so it was not replaced.",
    );
  });

  it("does not replace a file the person approved replacing once it changed while the part was built", async () => {
    let root = "";
    const made = await studio({
      harness: async (request) => {
        await writeFile(join(root, "kept.step"), "edited meanwhile");
        return builds(request);
      },
    });
    root = made.root;
    await writeFile(join(root, "kept.step"), "the person's own part");
    const exports = [{ path: "kept.step" }];

    const result = await made.tools.callTool(
      "cad_build",
      { code, exports },
      undefined,
      identityOf(await made.tools.inspect("cad_build", { code, exports })),
    );

    expect(await readFile(join(root, "kept.step"), "utf8")).toBe(
      "edited meanwhile",
    );
    expect(JSON.stringify(result)).toContain(
      "kept.step was not written: it changed while the part was built, so it was not replaced.",
    );
  });

  it("does not run a build approved to replace a file that changed after the approval", async () => {
    const { tools, root } = await studio();
    await writeFile(join(root, "kept.step"), "the person's own part");
    const exports = [{ path: "kept.step" }];
    const approved = await tools.inspect("cad_build", { code, exports });

    await writeFile(join(root, "kept.step"), "edited after the approval");
    const ran = (await tools.callTool(
      "cad_build",
      { code, exports },
      undefined,
      identityOf(approved),
    )) as { isError?: boolean };

    expect(ran.isError).toBe(true);
    expect(await readFile(join(root, "kept.step"), "utf8")).toBe(
      "edited after the approval",
    );
  });

  it("takes nothing from the run's answer but what it says: no file it names, and no link out of its folder", async () => {
    const outside = await folders.make("zhiyin-cad-outside-");
    const secret = join(outside, "secret.txt");
    await writeFile(secret, "TOP SECRET");
    const made = await studio({
      harness: async (request) => {
        // A hard link where the export should be, and an answer naming the secret.
        await link(secret, join(request.output, request.exports[0]!.file));
        await writeFile(
          join(request.output, "answer.json"),
          JSON.stringify({
            parts: [plate],
            overlaps: [],
            exports: [
              {
                file: relative(request.output, secret),
                bytes: 1,
                parts: ["Plate"],
              },
              {
                file: relative(request.output, secret),
                bytes: 1,
                parts: ["Plate"],
              },
            ],
            seconds: { total: 1 },
            picture: relative(request.output, secret),
          }),
        );
        return { exitCode: 0 };
      },
    });

    const result = await made.tools.callTool("cad_build", {
      code,
      exports: [{ path: "a.step" }, { path: "b.step" }],
    });

    expect(JSON.stringify(result)).not.toContain("TOP SECRET");
    expect(JSON.stringify(result)).not.toContain(
      Buffer.from("TOP SECRET").toString("base64"),
    );
    expect(await readdir(made.root)).toEqual([]);
    expect(JSON.stringify(result)).toContain("a.step was not written");
    expect(JSON.stringify(result)).toContain("b.step was not written");
  });

  it("answers a run whose answer is not one the harness writes as a failed build", async () => {
    const made = await studio({
      harness: async (request) => {
        await writeFile(
          join(request.output, "answer.json"),
          JSON.stringify({ parts: "many", exports: 3 }),
        );
        return { exitCode: 0 };
      },
    });

    const result = await made.tools.callTool("cad_build", { code });

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain("could not build this");
  });

  it("refuses two spellings of one file, and an export onto a folder, before anyone is asked", async () => {
    const { tools, root } = await studio();
    await mkdir(join(root, "dir.stl"));

    const twice = await tools.inspect("cad_build", {
      code,
      exports: [{ path: "case/Part.step" }, { path: "case/part.STEP" }],
    });
    const folder = await tools.inspect("cad_build", {
      code,
      exports: [{ path: "first.step" }, { path: "dir.stl" }],
    });

    expect(twice).toMatchObject({
      ok: false,
      reason: "case/part.STEP is named twice in exports.",
    });
    expect(folder).toMatchObject({
      ok: false,
      reason: "dir.stl is a folder. Name a file to write.",
    });
  });

  it("refuses an export inside another export's path, before anyone is asked", async () => {
    const { tools } = await studio();

    const nested = await tools.inspect("cad_build", {
      code,
      exports: [{ path: "x.step" }, { path: "X.step/y.step" }],
    });

    expect(nested).toMatchObject({
      ok: false,
      reason:
        "X.step/y.step and x.step cannot both be written: one names the other as a folder.",
    });
  });

  it("gives volumes in cm³ to three figures, and whole from a thousand", async () => {
    const said = async (volume: number) => {
      const { tools } = await studio({
        harness: async (request) => {
          await writeFile(
            join(request.output, "answer.json"),
            JSON.stringify({
              parts: [{ ...plate, volume }],
              overlaps: [],
              exports: [],
              seconds: { total: 1 },
            }),
          );
          return { exitCode: 0 };
        },
      });
      return JSON.stringify(await tools.callTool("cad_build", { code }));
    };

    expect(await said(100_000)).toContain("Volume 100,000 mm³ (100 cm³)");
    expect(await said(120_000)).toContain("Volume 120,000 mm³ (120 cm³)");
    expect(await said(1_000_000)).toContain("Volume 1,000,000 mm³ (1,000 cm³)");
    expect(await said(1_234.5)).toContain("Volume 1,235 mm³ (1.23 cm³)");
  });

  it("builds where Zhiyin's data is reached through a junction", async () => {
    const { tools, root } = await studio({ dataThroughJunction: true });

    const result = (await tools.callTool("cad_build", {
      code,
      exports: [{ path: "plate.step" }],
    })) as { isError?: boolean; content: { text?: string }[] };

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("Built 1 part");
    expect(await readFile(join(root, "plate.step"), "utf8")).toBe(
      "step of the part",
    );
  });

  it("says which parts the views leave out and why, why none could be drawn, and that a script showed no part", async () => {
    const answerWith =
      (answer: Record<string, unknown>, picture: boolean): Harness =>
      async (request) => {
        if (picture)
          await writeFile(
            join(request.output, request.picture),
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
          );
        await writeFile(
          join(request.output, "answer.json"),
          JSON.stringify({
            overlaps: [],
            exports: [],
            seconds: { total: 1.2 },
            ...answer,
          }),
        );
        return { exitCode: 0 };
      };
    const call = async (harness: Harness) =>
      (await (
        await studio({
          harness,
          script: async (request) => {
            await writeFile(join(request.output, "manifest.json"), "{}");
            return { exitCode: 0, stdout: "lift 7.0\n" };
          },
        })
      ).tools.callTool("cad_build", {
        code,
      })) as { isError?: boolean; content: { type: string; text?: string }[] };

    const some = await call(
      answerWith(
        {
          parts: [plate, { ...plate, name: "Gear", valid: false }],
          picture: "picture.png",
          undrawn: [{ name: "Gear", why: "is not a valid solid" }],
        },
        true,
      ),
    );
    const none = await call(
      answerWith(
        {
          parts: [{ ...plate, name: "Gear", valid: false }],
          pictureFailed: "Gear is not a valid solid.",
        },
        false,
      ),
    );
    const empty = await call(answerWith({ parts: [] }, false));

    expect(some.content.map((one) => one.type)).toEqual(["text", "image"]);
    expect(some.content[0]?.text).toContain(
      "Not in the views: Gear, which is not a valid solid.",
    );
    expect(none.content.map((one) => one.type)).toEqual(["text"]);
    expect(none.content[0]?.text).toContain(
      "The views could not be drawn this time: Gear is not a valid solid. The measurements above stand.",
    );
    expect(empty.isError).toBeUndefined();
    expect(empty.content[0]?.text).toBe(
      "The script ran in 1.2 s and showed no part, so nothing was measured or drawn.\nWhat the script printed:\nlift 7.0",
    );
  });

  it("names parts that overlap, and says none do when none do", async () => {
    const answerWith =
      (overlaps: unknown[]): Harness =>
      async (request) => {
        await writeFile(
          join(request.output, "answer.json"),
          JSON.stringify({
            parts: [plate, { ...plate, name: "Rib", holes: [] }],
            overlaps,
            exports: [],
            seconds: { total: 1 },
          }),
        );
        return { exitCode: 0 };
      };
    const apart = await studio({ harness: answerWith([]) });
    const into = await studio({
      harness: answerWith([
        {
          first: "Plate",
          second: "Rib",
          volume: 1200.4,
          min: [-20, -5, 2],
          max: [20, 5, 4.5],
        },
      ]),
    });

    const none = JSON.stringify(
      await apart.tools.callTool("cad_build", { code }),
    );
    const some = JSON.stringify(
      await into.tools.callTool("cad_build", { code }),
    );

    expect(none).toContain("No two parts overlap.");
    expect(some).toContain(
      "Plate and Rib overlap by 1,200 mm³, from (-20, -5, 2) to (20, 5, 4.5): parts that should only touch share that volume.",
    );
    expect(none).toContain("The views could not be drawn this time");
  });
});

describe("drawing a part", () => {
  const report = {
    sheet: "A3",
    orientation: "landscape",
    scale: "1:2",
    projection: "first",
    views: [
      { name: "front", kind: "named", scale: "1:2" },
      { name: "A", kind: "section", scale: "1:2" },
      { name: "B", kind: "detail", scale: "2:1" },
    ],
    dimensions: [
      { view: "front", text: "80", kind: "length" },
      { view: "front", text: "4× Ø6 H7", kind: "diameter" },
    ],
    outputs: ["export-0.pdf"],
  };
  /** Writes what the harness would for a drawing: its files, its picture and its report. */
  const draws: Harness = async (request) => {
    const asked = (
      request as unknown as {
        drawing: { outputs: { file: string; kind: string }[]; picture: string };
      }
    ).drawing;
    for (const one of asked.outputs)
      await writeFile(join(request.output, one.file), `${one.kind} drawing`);
    await writeFile(
      join(request.output, asked.picture),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
    );
    await writeFile(
      join(request.output, "answer.json"),
      JSON.stringify({
        drawing: { ...report, seconds: { total: 2.1 }, picture: true },
      }),
    );
    return { exitCode: 0 };
  };
  const views = [
    { view: "front" },
    { section: "A", looking: "top", through: [0, 0, 0] },
  ];

  it("lays a drawing out for the person in words, its script whole", async () => {
    const { tools } = await studio();

    const asked = await tools.inspect("cad_draw", {
      code,
      parts: ["Plate"],
      sheet: "A4",
      scale: "1:2",
      views: [
        { view: "top" },
        { section: "A", looking: "front", through: [0, 0, 4], uncut: ["Pin"] },
        { detail: "B", of: "A", at: [40, 0, 4], radius: 5, scale: 3 },
        { auxiliary: "C", direction: [1, 1, 0] },
      ],
      dimensions: [
        { view: "top", kind: "length", from: [0, 0, 8], to: [80, 0, 8] },
        { view: "top", kind: "diameter", at: [10, 10, 8], all: true },
        { view: "A", kind: "length", from: [0, 0, 0], to: [0, 0, 8] },
      ],
      title: { title: "Mounting plate", number: "MP-1" },
      outputs: [{ path: "plate.pdf" }, { path: "cut.dxf", view: "top" }],
    });

    expect(asked).toMatchObject({
      ok: true,
      invocation: {
        name: "Draw a CAD part",
        arguments: [
          { name: "Code", value: code, runs: true },
          { name: "Parts", value: "Plate", readable: true },
          {
            name: "Sheet",
            value: "A4 landscape, first-angle projection, at 1:2",
            readable: true,
          },
          {
            name: "Views",
            value:
              "top; section A looking front through (0, 0, 4), Pin left whole; detail B of A at (40, 0, 4), 5 mm round, at 3 times the sheet's scale; view C looking along (1, 1, 0)",
            readable: true,
          },
          {
            name: "Dimensions",
            value: "2 on top, 1 on A",
            readable: true,
          },
          {
            name: "Title block",
            value: "Mounting plate, MP-1",
            readable: true,
          },
        ],
      },
      changes: [
        {
          path: "plate.pdf",
          change: "created",
          omitted: "The drawing in PDF.",
        },
        {
          path: "cut.dxf",
          change: "created",
          omitted: "The top view alone at full size, in DXF.",
        },
      ],
    });
  });

  it("says a drawing of parts asked for no dimensions gives its overall sizes", async () => {
    const { tools } = await studio();

    const asked = await tools.inspect("cad_draw", {
      code,
      views,
      outputs: [{ path: "plate.pdf" }],
    });
    const none = await tools.inspect("cad_draw", {
      code,
      views,
      dimensions: [],
      outputs: [{ path: "plate.pdf" }],
    });

    expect(asked).toMatchObject({
      invocation: {
        arguments: expect.arrayContaining([
          {
            name: "Dimensions",
            value:
              "none asked for, so the overall sizes, and how far apart the axes of each two gears in mesh are",
            readable: true,
          },
        ]),
      },
    });
    expect(JSON.stringify(none)).not.toContain('"Dimensions"');
  });

  it("is approved as a drawing that writes only the files it names", async () => {
    const { tools } = await studio();

    const asked = await tools.inspect("cad_draw", {
      code,
      views,
      outputs: [
        { path: "plate.pdf" },
        { path: "cut/plate.dxf", view: "front" },
      ],
    });

    expect(asked).toMatchObject({
      ok: true,
      action: "Draw a CAD part",
      detail:
        "The script reads the workspace and cannot use the internet. Zhiyin writes only plate.pdf, cut/plate.dxf.",
      changes: [
        { path: "plate.pdf", change: "created" },
        { path: "cut/plate.dxf", change: "created" },
      ],
    });
  });

  it("refuses a drawing that cannot be made as asked, before anyone is asked", async () => {
    const { tools } = await studio();
    const refusal = async (args: Record<string, unknown>) =>
      (await tools.inspect("cad_draw", {
        code,
        outputs: [{ path: "plate.pdf" }],
        ...args,
      })) as { ok: boolean; reason?: string };

    expect(await refusal({ outputs: [] })).toMatchObject({
      reason: "outputs names at least one file to write the drawing to.",
    });
    expect(await refusal({ outputs: [{ path: "plate.step" }] })).toMatchObject({
      reason: "plate.step must end in .svg, .pdf, .dxf or .png.",
    });
    expect(
      await refusal({ outputs: [{ path: "plate.pdf", view: "front" }] }),
    ).toMatchObject({
      reason:
        "outputs[0].view names the view a .dxf holds alone, at full size.",
    });
    expect(await refusal({ exports: [{ path: "plate.step" }] })).toMatchObject({
      reason: "A drawing does not take exports.",
    });
    expect(
      await refusal({ outputs: [{ path: "plate.pdf", parts: ["Plate"] }] }),
    ).toMatchObject({
      reason:
        "outputs[0] is the whole drawing; name the parts it shows in the drawing's own parts.",
    });
    expect(await refusal({ sheet: "B4" })).toMatchObject({
      reason: "sheet is one of A4, A3, A2, A1, A0.",
    });
    expect(
      await refusal({ views: [{ view: "front", looking: "top" }] }),
    ).toMatchObject({
      reason: "views[0] gives looking, which a view does not take.",
    });
    expect(
      await refusal({
        dimensions: [
          {
            view: "front",
            kind: "length",
            from: [0, 0, 0],
            to: [1, 0, 0],
            tolerence: "±0.1",
          },
        ],
      }),
    ).toMatchObject({
      reason: "dimensions[0] gives tolerence, which a dimension does not take.",
    });
    expect(
      await refusal({
        dimensions: [
          { view: "front", kind: "radius", at: [0, 0, 0], all: true },
        ],
      }),
    ).toMatchObject({
      reason:
        "dimensions[0].all is true when a diameter names every hole of its size in the view, as 4× Ø6.",
    });
    expect(
      await refusal({ views: [{ auxiliary: "C", direction: [0, 0, 0] }] }),
    ).toMatchObject({
      reason:
        "views[0].direction is the direction [x, y, z] the view looks in, not [0, 0, 0].",
    });
    // Each input has one type: a section's looking names a straight view, an
    // auxiliary view's direction is three numbers.
    expect(
      await refusal({ views: [{ auxiliary: "C", looking: [1, 1, 0] }] }),
    ).toMatchObject({
      reason:
        "views[0].looking is a section's straight view; an auxiliary view looks along direction: [x, y, z].",
    });
    expect(
      await refusal({
        views: [{ section: "A", looking: [0, 1, 0], through: [0, 0, 0] }],
      }),
    ).toMatchObject({
      reason:
        "views[0].looking is the straight view the section looks as: front, back, top, bottom, left, right.",
    });
    expect(
      await refusal({
        views: [{ section: "A", direction: [0, 1, 0], through: [0, 0, 0] }],
      }),
    ).toMatchObject({
      reason: "views[0] gives direction, which a section does not take.",
    });
    expect(await refusal({ scale: "5:10" })).toMatchObject({
      reason: "scale 5:10 is written 1:2, in its lowest terms.",
    });
    const section = { section: "A", looking: "front", through: [0, 0, 0] };
    for (const uncut of ["Shaft", [""], [3], Array(21).fill("Pin")])
      expect(
        await refusal({ views: [{ view: "top" }, { ...section, uncut }] }),
      ).toMatchObject({
        reason:
          "views[1].uncut lists the names of up to 20 parts, or objects of a scene, the section leaves whole.",
      });
    expect(
      await refusal({ views: [{ view: "top", uncut: ["Shaft"] }] }),
    ).toMatchObject({
      reason: "views[0] gives uncut, which a view does not take.",
    });
    expect(
      await refusal({
        views: [{ view: "top" }, { ...section, uncut: ["Shaft", "Pin"] }],
      }),
    ).toMatchObject({ ok: true });
    // Revolved parts turn about an axis lying in the cutting plane.
    const axis = { through: [0, 0, 0], along: [1, 0, 0] };
    const revolved = (more: Record<string, unknown>) =>
      refusal({ views: [{ view: "top" }, { ...section, ...more }] });
    expect(await revolved({ revolved: ["Blades"], axis })).toMatchObject({
      ok: true,
    });
    expect(await revolved({ revolved: ["Blades"] })).toMatchObject({
      reason:
        "views[1].revolved needs axis: { through: [x, y, z], along: [x, y, z] }, the axis its parts turn about.",
    });
    expect(await revolved({ axis })).toMatchObject({
      reason:
        "views[1].axis is the axis revolved parts turn about; name them in revolved.",
    });
    for (const names of ["Blades", [], [""], Array(41).fill("Blade")])
      expect(await revolved({ revolved: names, axis })).toMatchObject({
        reason:
          "views[1].revolved lists the names of up to 40 parts, or objects of a scene, the section draws turned into its plane.",
      });
    expect(
      await revolved({
        revolved: ["Blades"],
        axis: { through: [0, 0, 0], along: [0, 1, 0] },
      }),
    ).toMatchObject({
      reason:
        "views[1].axis runs across the cutting plane, square to it in part; revolved parts turn about an axis lying in the plane, square to the way the section looks.",
    });
    expect(
      await revolved({ revolved: ["Blades"], axis: { through: [0, 0, 0] } }),
    ).toMatchObject({
      reason:
        "views[1].axis is { through: [x, y, z], along: [x, y, z] }: a point on it in mm and its direction.",
    });
    expect(
      await revolved({ revolved: ["Blades"], uncut: ["Blades"], axis }),
    ).toMatchObject({
      reason:
        "views[1] both leaves Blades whole and revolves it; give it once.",
    });
    // Keys of another kind of dimension would be dropped unread.
    expect(
      await refusal({
        dimensions: [
          {
            view: "front",
            kind: "diameter",
            at: [0, 0, 0],
            direction: "vertical",
          },
        ],
      }),
    ).toMatchObject({
      reason:
        "dimensions[0] is a diameter, found by its point at; direction is a length's.",
    });
    expect(
      await refusal({
        dimensions: [
          {
            view: "front",
            kind: "length",
            from: [0, 0, 0],
            to: [1, 0, 0],
            at: [0, 0, 0],
          },
        ],
      }),
    ).toMatchObject({
      reason:
        "dimensions[0] is a length, between from and to; at is a diameter's or a radius's point.",
    });
    expect(
      await refusal({ dimensions: [{ view: "front", kind: "overall" }] }),
    ).toMatchObject({
      reason:
        "dimensions[0] is an overall size: direction is horizontal for the view's whole width or vertical for its whole height.",
    });
    expect(
      await refusal({
        dimensions: [
          {
            view: "front",
            kind: "overall",
            direction: "horizontal",
            from: [0, 0, 0],
          },
        ],
      }),
    ).toMatchObject({
      reason:
        "dimensions[0] is an overall size, found from the whole view; it takes no from.",
    });
    expect(
      await refusal({ dimensions: [{ view: "front", kind: "radius" }] }),
    ).toMatchObject({
      reason:
        "dimensions[0] is a radius: at is a point [x, y, z] in mm on the circle or at its centre, or expect is its size, which finds the arc of that size in the view.",
    });
  });

  it("refuses a drawing that refers to a view it does not have, before anyone is asked", async () => {
    const { tools } = await studio();
    const refusal = async (args: Record<string, unknown>) =>
      (await tools.inspect("cad_draw", {
        code,
        outputs: [{ path: "plate.pdf" }],
        ...args,
      })) as { ok: boolean; reason?: string };

    expect(
      await refusal({
        dimensions: [
          { view: "side", kind: "length", from: [0, 0, 0], to: [1, 0, 0] },
        ],
      }),
    ).toMatchObject({
      reason:
        "dimensions[0] is on the side view, which the drawing does not have; it has front, top, right, iso.",
    });
    expect(
      await refusal({
        views: [
          { view: "front" },
          { detail: "B", of: "top", at: [0, 0, 0], radius: 5 },
        ],
      }),
    ).toMatchObject({
      reason:
        "views[1] is a detail of the top view, which the drawing does not have; it has front, B.",
    });
    expect(
      await refusal({
        views: [{ detail: "B", of: "B", at: [0, 0, 0], radius: 5 }],
      }),
    ).toMatchObject({
      reason: "views[0] is a detail of itself; name the view it is taken from.",
    });
    expect(
      await refusal({
        views: [
          { view: "front" },
          { detail: "A", of: "B", at: [0, 0, 0], radius: 5 },
          { detail: "B", of: "A", at: [0, 0, 0], radius: 5 },
        ],
      }),
    ).toMatchObject({
      reason:
        "views[1] is detail A, of B, which is of A: no view of the drawing comes first; take one of them from a view that is not a detail.",
    });
    expect(
      await refusal({
        views: [
          { view: "front" },
          { detail: "C", of: "front", at: [0, 0, 0], radius: 5 },
          { detail: "A", of: "B", at: [0, 0, 0], radius: 5 },
          { detail: "B", of: "D", at: [0, 0, 0], radius: 5 },
          { detail: "D", of: "A", at: [0, 0, 0], radius: 5 },
        ],
      }),
    ).toMatchObject({
      reason:
        "views[2] is detail A, of B, which is of D, which is of A: no view of the drawing comes first; take one of them from a view that is not a detail.",
    });
    expect(
      await refusal({
        views: [
          { view: "front" },
          { section: "A", looking: "top", through: [0, 0, 0] },
          { auxiliary: "A", direction: [1, 1, 0] },
        ],
      }),
    ).toMatchObject({ reason: "two views are called A." });
    expect(
      await refusal({
        views: [{ view: "front" }],
        outputs: [{ path: "cut.dxf", view: "top" }],
      }),
    ).toMatchObject({
      reason:
        "outputs[0] is of the top view, which the drawing does not have; it has front.",
    });
  });

  it("says which dimensions the sheet had no clear room for, and what gives them room", async () => {
    const crowdedAt = (scaleAsked: boolean) =>
      studio({
        harness: async (request) => {
          const asked = (
            request as unknown as {
              drawing: { outputs: { file: string }[]; picture: string };
            }
          ).drawing;
          await writeFile(join(request.output, asked.outputs[0]!.file), "pdf");
          await writeFile(
            join(request.output, "answer.json"),
            JSON.stringify({
              drawing: {
                ...report,
                dimensions: [
                  { view: "front", text: "80", kind: "length" },
                  { view: "front", text: "12", kind: "length", crowded: true },
                  { view: "A", text: "Ø6", kind: "diameter", crowded: true },
                ],
                seconds: { total: 2.1 },
                picture: false,
                ...(scaleAsked ? { scaleAsked: true } : {}),
              },
            }),
          );
          return { exitCode: 0 };
        },
      });
    const said = async (scaleAsked: boolean) => {
      const { tools } = await crowdedAt(scaleAsked);
      const result = (await tools.callTool("cad_draw", {
        code,
        views,
        outputs: [{ path: "plate.pdf" }],
      })) as { content: { text?: string }[] };
      return result.content[0]?.text ?? "";
    };

    // At the largest scale that fits, a smaller one is what was already tried.
    expect(await said(false)).toContain(
      "Drawn where it meets other lines or text, for want of room: 12 on front, Ø6 on A. A larger sheet, or fewer dimensions on a view, gives them room.",
    );
    expect(await said(true)).toContain(
      "Drawn where it meets other lines or text, for want of room: 12 on front, Ø6 on A. A smaller scale or a larger sheet gives them room.",
    );
  });

  it("says which dimensions reach past the frame, apart from those that only meet other lines", async () => {
    const { tools } = await studio({
      harness: async (request) => {
        const asked = (
          request as unknown as { drawing: { outputs: { file: string }[] } }
        ).drawing;
        await writeFile(join(request.output, asked.outputs[0]!.file), "pdf");
        await writeFile(
          join(request.output, "answer.json"),
          JSON.stringify({
            drawing: {
              ...report,
              dimensions: [
                { view: "front", text: "80", kind: "length" },
                {
                  view: "front",
                  text: "120",
                  kind: "length",
                  crowded: true,
                  outside: true,
                },
                { view: "top", text: "Ø6", kind: "diameter", crowded: true },
              ],
              seconds: { total: 2.1 },
              picture: false,
            },
          }),
        );
        return { exitCode: 0 };
      },
    });
    const result = (await tools.callTool("cad_draw", {
      code,
      views,
      outputs: [{ path: "plate.pdf" }],
    })) as { content: { text?: string }[] };
    const said = result.content[0]?.text ?? "";

    expect(said).toContain(
      "Drawn past the frame, the sheet having no room for it inside: 120 on front. A larger sheet, or fewer dimensions on a view, gives them room.",
    );
    expect(said).toContain(
      "Drawn where it meets other lines or text, for want of room: Ø6 on top.",
    );
  });

  it("says which title block fields were cut short to fit", async () => {
    const { tools } = await studio({
      harness: async (request) => {
        const asked = (
          request as unknown as { drawing: { outputs: { file: string }[] } }
        ).drawing;
        await writeFile(join(request.output, asked.outputs[0]!.file), "pdf");
        await writeFile(
          join(request.output, "answer.json"),
          JSON.stringify({
            drawing: {
              ...report,
              seconds: { total: 1.2 },
              picture: false,
              titleCut: ["material", "company"],
            },
          }),
        );
        return { exitCode: 0 };
      },
    });

    const result = (await tools.callTool("cad_draw", {
      code,
      views,
      outputs: [{ path: "plate.pdf" }],
    })) as { content: { text?: string }[] };

    expect(result.content[0]?.text).toContain(
      "Cut short to fit the title block, with an ellipsis: material, company. Shorter text is written whole.",
    );
  });

  it("says in its first line that a cut of the script was skipped, and where, below", async () => {
    const skippedCut =
      "At line 4 of the script: a cut of the part 100 × 60 × 10 mm about (0, 0, 0), its cutter 200 × 200 × 200 mm about (0, 0, 0): it would leave nothing of the part, so the part was kept as it was before it.";
    const { tools } = await studio({
      harness: async (request) => {
        const asked = (
          request as unknown as { drawing: { outputs: { file: string }[] } }
        ).drawing;
        await writeFile(join(request.output, asked.outputs[0]!.file), "pdf");
        await writeFile(
          join(request.output, "answer.json"),
          JSON.stringify({
            drawing: {
              ...report,
              seconds: { total: 1.2 },
              picture: false,
              skipped: [skippedCut],
            },
          }),
        );
        return { exitCode: 0 };
      },
    });

    const result = (await tools.callTool("cad_draw", {
      code,
      views,
      outputs: [{ path: "plate.pdf" }],
    })) as { content: { text?: string }[] };
    const lines = (result.content[0]?.text ?? "").split("\n");

    expect(lines[0]).toMatch(
      /^Drew A3 landscape at 1:2, first-angle projection, in 1\.2 s: .*\. 1 of the script's cuts was skipped, as it would break the part it cuts: the parts drawn are not what the script writes until that cut changes\.$/,
    );
    expect(lines).toContain(
      "Cuts skipped, as each would break the part it cuts; change each in the script:",
    );
    expect(lines).toContain(`- ${skippedCut}`);
  });

  it("asks the harness for the drawing as approved, and answers with its scale, dimensions, files and sheet", async () => {
    const { tools, root, runs } = await studio({ harness: draws });

    const result = (await tools.callTool("cad_draw", {
      code,
      views,
      title: { title: "Plate", material: "6061" },
      outputs: [{ path: "plate.pdf" }],
    })) as { content: { type: string; text?: string; mimeType?: string }[] };

    expect(runs).toHaveLength(2);
    expect(await readFile(join(root, "plate.pdf"), "utf8")).toBe("pdf drawing");
    const text = result.content[0]?.text ?? "";
    expect(text).toContain(
      "Drew A3 landscape at 1:2, first-angle projection, in 2.1 s: front view, section A and detail B at 2:1.",
    );
    expect(text).toContain("Dimensions on front: 80, 4× Ø6 H7.");
    expect(text).toContain("Wrote plate.pdf (1 KB).");
    expect(text).toContain("Below, the sheet as drawn.");
    expect(result.content[1]).toMatchObject({
      type: "image",
      mimeType: "image/png",
    });
    expect(tools.produced("cad_draw", {}, result)).toEqual([
      { path: "plate.pdf", change: "created", bytes: 11 },
    ]);
  });

  it("draws a drawing of this conversation again from its kept request, with the inputs given in place of its own", async () => {
    const asks: Parameters<Harness>[0][] = [];
    const { tools } = await studio({
      harness: async (request) => {
        asks.push(request);
        return draws(request);
      },
    });
    const first = (await tools.callTool("cad_draw", {
      code,
      views,
      title: { title: "Plate", material: "6061" },
      outputs: [{ path: "drawings/plate.pdf" }],
    })) as { content: { text?: string }[] };
    expect(first.content[0]?.text).toContain(
      'The request is kept: cad_draw with again "drawings/plate.pdf" draws this drawing again',
    );

    const changed = { title: "Plate, revised", material: "7075" };
    const asked = await tools.inspect("cad_draw", {
      again: "drawings/plate.pdf",
      title: changed,
    });
    expect(asked.ok).toBe(true);
    // What is approved is the whole drawing as it will be drawn.
    expect(asked.ok && asked.command).toBe(code);
    await tools.callTool(
      "cad_draw",
      { again: "drawings/plate.pdf", title: changed },
      undefined,
      identityOf(asked),
    );
    expect(asks).toHaveLength(2);
    const request = asks[1] as unknown as {
      drawing?: { views?: unknown; title?: unknown };
    };
    expect(request.drawing?.title).toEqual(changed);
    expect(request.drawing?.views).toEqual(views);
  });

  it("gives a parts list given no materials those the last drawing of the same file gave, and says so", async () => {
    const asks: Parameters<Harness>[0][] = [];
    const { tools } = await studio({
      harness: async (request) => {
        asks.push(request);
        return draws(request);
      },
    });
    const drawing = {
      code,
      views,
      parts_list: true,
      outputs: [{ path: "drawings/plate.pdf" }],
    };
    await tools.callTool("cad_draw", {
      ...drawing,
      materials: { Plate: "6061-T6" },
    });

    const again = (await tools.callTool("cad_draw", drawing)) as {
      content: { text?: string }[];
    };

    const request = asks[1] as unknown as { drawing?: { materials?: unknown } };
    expect(request.drawing?.materials).toEqual({ Plate: "6061-T6" });
    expect(again.content[0]?.text).toContain(
      "No materials were given, so the parts list takes them from the last drawing of drawings/plate.pdf.",
    );
  });

  it("gives a parts list given no materials those the requirements beside the script name", async () => {
    const asks: Parameters<Harness>[0][] = [];
    const { tools, root } = await studio({
      harness: async (request) => {
        asks.push(request);
        return draws(request);
      },
    });
    await writeFile(join(root, "plate.py"), code);
    await writeFile(
      join(root, "requirements.json"),
      JSON.stringify({
        requirements: [
          {
            id: "R1",
            says: "The plate weighs under 100 g",
            check: "mass",
            parts: ["Plate"],
            material: "PETG",
            max: 100,
          },
        ],
      }),
    );

    const drawn = (await tools.callTool("cad_draw", {
      file: "plate.py",
      views,
      parts_list: true,
      outputs: [{ path: "plate.pdf" }],
    })) as { content: { text?: string }[] };

    const request = asks[0] as unknown as { drawing?: { materials?: unknown } };
    expect(request.drawing?.materials).toEqual({ Plate: "PETG" });
    expect(drawn.content[0]?.text).toContain(
      "No materials were given, so the parts list takes them from requirements.json (R1).",
    );
  });

  it("draws again from code given over a drawing made from a file, or from a file over one made from code, keeping its arguments and parts", async () => {
    const asks: Parameters<Harness>[0][] = [];
    const { tools, root } = await studio({
      harness: async (request) => {
        asks.push(request);
        return draws(request);
      },
    });
    await writeFile(join(root, "plate.py"), code);
    await tools.callTool("cad_draw", {
      file: "plate.py",
      arguments: ["8"],
      parts: ["Plate"],
      views,
      outputs: [{ path: "drawings/from-file.pdf" }],
    });
    await tools.callTool("cad_draw", {
      code,
      views,
      outputs: [{ path: "drawings/from-code.pdf" }],
    });
    const changed =
      'from build123d import *\nshow(Box(90, 50, 8), name="Plate")\n';

    const fromCode = await tools.inspect("cad_draw", {
      again: "drawings/from-file.pdf",
      code: changed,
    });
    const fromFile = await tools.inspect("cad_draw", {
      again: "drawings/from-code.pdf",
      file: "plate.py",
    });

    expect(fromCode.ok, JSON.stringify(fromCode)).toBe(true);
    expect(fromCode.ok && fromCode.command).toBe(changed);
    expect(fromFile.ok, JSON.stringify(fromFile)).toBe(true);
    expect(fromFile.ok && fromFile.target).toBe("plate.py");
    await tools.callTool(
      "cad_draw",
      { again: "drawings/from-file.pdf", code: changed },
      undefined,
      identityOf(fromCode),
    );
    const request = asks.at(-1) as unknown as {
      file: string | null;
      arguments: string[];
      drawing: { parts?: string[] };
    };
    expect(request.file).toBeNull();
    expect(request.arguments).toEqual(["8"]);
    expect(request.drawing.parts).toEqual(["Plate"]);
  });

  it("refuses to draw again a drawing this conversation did not make", async () => {
    const { tools, runs } = await studio({ harness: draws });

    expect(
      await tools.inspect("cad_draw", { again: "drawings/other.pdf" }),
    ).toMatchObject({
      ok: false,
      correctable: true,
      reason:
        "No drawing in this conversation wrote drawings/other.pdf, so there is none to draw again: give the drawing in full.",
    });
    expect(runs).toHaveLength(0);
  });

  it("takes a build's answer to a drawing as no answer, and writes nothing", async () => {
    const { tools, root } = await studio({
      harness: async (request) => {
        const asked = (
          request as unknown as {
            drawing: { outputs: { file: string }[] };
          }
        ).drawing;
        await writeFile(join(request.output, asked.outputs[0]!.file), "pdf");
        return builds({ ...request, exports: [], picture: "picture.png" });
      },
    });

    const result = (await tools.callTool("cad_draw", {
      code,
      outputs: [{ path: "plate.pdf" }],
    })) as { isError?: boolean; content: { text?: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "The CAD studio could not build this.",
    );
    expect(await readdir(root)).toEqual([]);
  });

  it("answers a drawing refused by the harness with its reasons", async () => {
    const { tools } = await studio({
      script: quietly,
      harness: async (request) => {
        await writeFile(
          join(request.output, "answer.json"),
          JSON.stringify({
            failed:
              "The drawing could not be made as asked:\n- dimension 1 is Ø6 on the part, where 8 was expected",
          }),
        );
        return { exitCode: 2 };
      },
    });

    const result = (await tools.callTool("cad_draw", {
      code,
      outputs: [{ path: "plate.pdf" }],
    })) as { isError?: boolean; content: { text?: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "The drawing could not be made as asked:\n- dimension 1 is Ø6 on the part, where 8 was expected",
    );
  });
});

describe("drawing the 3D scene", () => {
  /** A conversation's Blender scene: the file open, and what each request for its lines was given. */
  function blenderScene(
    open: string | undefined,
    answer = '{"views": {}}',
    installed = true,
  ) {
    const asked: { request: SceneLinesRequest; workspace: string }[] = [];
    let file = open;
    const lines: SceneLines = {
      installed: async () => installed,
      open: async () => file,
      lines: async (request, options) => {
        asked.push({ request, workspace: options.workspace });
        return answer.startsWith("{")
          ? { ok: true, lines: answer }
          : { ok: false, reason: answer };
      },
    };
    return { lines, asked, reopen: (next: string) => (file = next) };
  }
  /** The lines each drawing's harness was handed. */
  const handed: string[] = [];
  /** Writes what the harness would for a drawing, keeping the lines it was handed. */
  const draws: Harness = async (request) => {
    const given = request as unknown as {
      lines?: string;
      drawing: { outputs: { file: string; kind: string }[]; picture: string };
    };
    if (given.lines) handed.push(await readFile(given.lines, "utf8"));
    for (const one of given.drawing.outputs)
      await writeFile(join(request.output, one.file), `${one.kind} drawing`);
    await writeFile(
      join(request.output, "answer.json"),
      JSON.stringify({
        drawing: {
          sheet: "A3",
          orientation: "landscape",
          scale: "1:50",
          projection: "first",
          views: [{ name: "top", kind: "named", scale: "1:50" }],
          dimensions: [{ view: "top", text: "4200", kind: "length" }],
          outputs: given.drawing.outputs.map((one) => one.file),
          seconds: { total: 1.2 },
          picture: false,
        },
      }),
    );
    return { exitCode: 0 };
  };
  afterEach(() => {
    handed.length = 0;
  });
  type Rows = { invocation: { arguments: { name: string; value: string }[] } };

  it("is approved as a drawing of the scene open, which Blender reads and leaves as it was", async () => {
    const scene = blenderScene("rooms/flat.blend");
    const { tools } = await studio({ sceneLines: scene.lines });

    const asked = await tools.inspect("cad_draw", {
      scene: true,
      objects: ["Walls", "Sofa"],
      views: [{ view: "top" }],
      outputs: [{ path: "plan.pdf" }],
    });

    expect(asked).toMatchObject({
      ok: true,
      action: "Draw a 3D scene",
      target: "rooms/flat.blend",
      detail:
        "Blender reads the scene and leaves it as it was. Zhiyin writes only plan.pdf.",
      effects: expect.objectContaining({ changes: "workspace" }),
      changes: [{ path: "plan.pdf", change: "created" }],
    });
    const rows = (asked as unknown as Rows).invocation.arguments;
    expect(rows.map((row) => row.name)).not.toContain("Code");
    expect(rows).toContainEqual(
      expect.objectContaining({ name: "3D scene", value: "rooms/flat.blend" }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({ name: "Objects", value: "Walls, Sofa" }),
    );
    expect(scene.asked).toEqual([]);
  });

  it("says a drawing of the scene shows every shape when it names no objects", async () => {
    const { tools } = await studio({
      sceneLines: blenderScene("flat.blend").lines,
    });

    const asked = await tools.inspect("cad_draw", {
      scene: true,
      outputs: [{ path: "plan.pdf" }],
    });

    expect((asked as unknown as Rows).invocation.arguments).toContainEqual(
      expect.objectContaining({
        name: "Objects",
        value: "every shape the scene shows",
      }),
    );
  });

  it("refuses a drawing of the scene that cannot be made as asked, before anyone is asked", async () => {
    const open = await studio({ sceneLines: blenderScene("flat.blend").lines });
    const none = await studio({ sceneLines: blenderScene(undefined).lines });
    const noStudio = await studio();
    const noBlender = await studio({
      sceneLines: blenderScene(undefined, undefined, false).lines,
    });
    const refused = async (
      tools: typeof open.tools,
      args: Record<string, unknown>,
    ) => {
      const asked = await tools.inspect("cad_draw", {
        outputs: [{ path: "plan.pdf" }],
        ...args,
      });
      expect(asked.ok).toBe(false);
      return (asked as { reason: string }).reason;
    };

    expect(await refused(none.tools, { scene: true })).toBe(
      "No 3D scene is open in this conversation. Open one with blender_open_scene first, or draw parts from a script.",
    );
    expect(await refused(noStudio.tools, { scene: true })).toBe(
      "Drawing a 3D scene needs the 3D studio. Install it from the 3D & Rendering plugin first.",
    );
    expect(await refused(noBlender.tools, { scene: true })).toBe(
      "Drawing a 3D scene needs the 3D studio. Install it from the 3D & Rendering plugin first.",
    );
    expect(await refused(open.tools, { scene: true, code })).toBe(
      "A drawing of the 3D scene runs no script; leave out code.",
    );
    expect(await refused(open.tools, { scene: true, parts: ["Sofa"] })).toBe(
      "A drawing of the 3D scene shows its objects; name them in objects, not parts.",
    );
    expect(await refused(open.tools, { code, objects: ["Sofa"] })).toBe(
      "objects names what a drawing of the 3D scene shows; give scene: true, or name parts.",
    );
    expect(await refused(open.tools, { scene: true, objects: [] })).toBe(
      "objects names 1 to 200 objects of the scene.",
    );
    expect(await refused(open.tools, { scene: "yes" })).toBe(
      "scene is true to draw the 3D scene open in this conversation.",
    );
  });

  it("asks Blender for the lines of the views asked for, and draws them with no script", async () => {
    const scene = blenderScene("flat.blend", '{"views": {"top": {}}}');
    const { tools, root, runs } = await studio({
      harness: draws,
      sceneLines: scene.lines,
    });
    const views = [
      { view: "top" },
      { section: "A", looking: "front", through: [0, 0, 1200] },
      { detail: "B", of: "top", at: [0, 0, 0], radius: 300 },
    ];

    const result = (await tools.callTool("cad_draw", {
      scene: true,
      objects: ["Walls"],
      views,
      outputs: [{ path: "plan.pdf" }],
    })) as { isError?: boolean; content: { text?: string }[] };

    expect(result.isError).toBeUndefined();
    expect(scene.asked).toEqual([
      { request: { objects: ["Walls"], views }, workspace: root },
    ]);
    expect(handed).toEqual(['{"views": {"top": {}}}']);
    expect(runs).toHaveLength(1);
    expect(await readFile(join(root, "plan.pdf"), "utf8")).toBe("pdf drawing");
    expect(result.content[0]?.text).toContain("Wrote plan.pdf");
  });

  it("asks Blender for the drawing's usual views when none are given", async () => {
    const scene = blenderScene("flat.blend");
    const { tools } = await studio({ harness: draws, sceneLines: scene.lines });

    await tools.callTool("cad_draw", {
      scene: true,
      outputs: [{ path: "plan.pdf" }],
    });

    expect(scene.asked[0]?.request).toEqual({
      views: [
        { view: "front" },
        { view: "top" },
        { view: "right" },
        { view: "iso" },
      ],
    });
  });

  it("draws again from the scene over a drawing of a script's parts, and from code over one of the scene, each leaving what only the other takes", async () => {
    const scene = blenderScene("flat.blend");
    const { tools } = await studio({ harness: draws, sceneLines: scene.lines });
    await tools.callTool("cad_draw", {
      code,
      arguments: ["8"],
      parts: ["Plate"],
      outputs: [{ path: "drawings/parts.pdf" }],
    });
    await tools.callTool("cad_draw", {
      scene: true,
      objects: ["Sofa"],
      outputs: [{ path: "drawings/scene.pdf" }],
    });

    const toScene = await tools.inspect("cad_draw", {
      again: "drawings/parts.pdf",
      scene: true,
    });
    const toCode = await tools.inspect("cad_draw", {
      again: "drawings/scene.pdf",
      code,
    });

    expect(toScene.ok, JSON.stringify(toScene)).toBe(true);
    expect(toScene.ok && toScene.target).toBe("flat.blend");
    expect(toCode.ok, JSON.stringify(toCode)).toBe(true);
    expect(toCode.ok && toCode.command).toBe(code);
  });

  it("answers with Blender's reason when it cannot give the lines, and runs and writes nothing", async () => {
    const { tools, root, runs } = await studio({
      harness: draws,
      sceneLines: blenderScene("flat.blend", "There is no object called Sofa.")
        .lines,
    });

    const result = (await tools.callTool("cad_draw", {
      scene: true,
      objects: ["Sofa"],
      outputs: [{ path: "plan.pdf" }],
    })) as { isError?: boolean; content: { text?: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("There is no object called Sofa.");
    expect(runs).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  });

  it("does not draw another scene than the one approved", async () => {
    const scene = blenderScene("flat.blend");
    const { tools, runs } = await studio({
      harness: draws,
      sceneLines: scene.lines,
    });
    const args = { scene: true, outputs: [{ path: "plan.pdf" }] };
    const asked = await tools.inspect("cad_draw", args);
    scene.reopen("office.blend");

    const result = await tools.callTool(
      "cad_draw",
      args,
      undefined,
      (asked as { identity?: string }).identity,
    );

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain(
      "The scene open in this conversation or the files the drawing writes changed after this drawing was approved",
    );
    expect(scene.asked).toEqual([]);
    expect(runs).toEqual([]);
  });
});

describe("what a call declares it does", () => {
  const nothing = {
    reads: "none",
    changes: "none",
    sends: "none",
    actsAsPerson: "none",
    runs: "none",
    lasting: false,
    brings: "none",
  } as const;
  const effectsOf = (inspected: ToolCallInspection) =>
    inspected.ok ? inspected.effects : undefined;

  it("a build that writes nothing runs sealed and only reads the workspace", async () => {
    const { tools } = await studio();

    expect(effectsOf(await tools.inspect("cad_build", { code }))).toEqual({
      ...nothing,
      reads: "workspace",
      runs: "sealed",
    });
  });

  it("a build or drawing changes the workspace by the files Zhiyin writes, which are kept to put back", async () => {
    const { tools, root } = await studio();
    await writeFile(join(root, "plate.py"), code);

    const built = await tools.inspect("cad_build", {
      file: "plate.py",
      exports: [{ path: "plate.step" }],
    });
    const drawn = await tools.inspect("cad_draw", {
      code,
      outputs: [{ path: "plate.pdf" }],
    });

    for (const asked of [built, drawn])
      expect(effectsOf(asked)).toEqual({
        ...nothing,
        reads: "workspace",
        changes: "workspace",
        runs: "sealed",
      });
  });

  it("a build that writes a file outside the workspace changes elsewhere", async () => {
    const { tools } = await studio();
    const elsewhere = await realpath(
      await folders.make("zhiyin-cad-elsewhere-"),
    );

    const asked = await tools.inspect("cad_build", {
      code,
      exports: [{ path: join(elsewhere, "part.step") }, { path: "inside.stl" }],
    });

    expect(effectsOf(asked)).toEqual({
      ...nothing,
      reads: "workspace",
      changes: "elsewhere",
      runs: "sealed",
    });
  });

  it("a drawing of the 3D scene reads the workspace and changes it by the drawing it writes", async () => {
    const lines: SceneLines = {
      installed: async () => true,
      open: async () => "rooms/flat.blend",
      lines: async () => ({ ok: true, lines: '{"views": {}}' }),
    };
    const { tools } = await studio({ sceneLines: lines });

    const asked = await tools.inspect("cad_draw", {
      scene: true,
      objects: ["Walls"],
      views: [{ view: "top" }],
      outputs: [{ path: "plan.pdf" }],
    });

    expect(effectsOf(asked)).toEqual({
      ...nothing,
      reads: "workspace",
      changes: "workspace",
      runs: "sealed",
    });
  });

  it("a look-up reads only the installed CAD library", async () => {
    const { tools } = await studio();

    expect(
      effectsOf(await tools.inspect("cad_api", { name: "extrude" })),
    ).toEqual({ ...nothing, reads: "app" });
  });
});
