import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  FileChange,
  ProducedFile,
  WritingConnection,
} from "@zhiyin/contract";
import {
  folderFor,
  font,
  kinds,
  readable,
  sceneIn,
  writable,
  type Refusal,
} from "./paths.js";
import {
  cannotDraw,
  type SceneCommand,
  type SceneSession,
} from "./scene-session.js";
import { studioTools } from "./tools.js";
import {
  addRows,
  cameraRows,
  describeRows,
  editRows,
  exportRows,
  inWords,
  lightingRows,
  materialRows,
  openRows,
  renderRows,
  scriptRows,
  shapeRows,
  type Row,
} from "./wording.js";

type Args = Readonly<Record<string, unknown>>;

export type SceneAutomationOptions = {
  readonly workspaceRoot: () => string | undefined;
  /** The installed Blender, or nothing; no Blender, no tools. */
  readonly blender: () => Promise<string | undefined>;
  /** This conversation's own folder in the app's data. */
  readonly directory: string;
};

type Written = {
  readonly absolute: string;
  readonly relative: string;
  readonly exists: boolean;
};

type Prepared = {
  readonly command: SceneCommand;
  readonly args: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
  readonly action: string;
  readonly target: string;
  /** The call as a person reads it. */
  readonly rows: readonly Row[];
  readonly access: "read" | "change";
  readonly changes?: readonly FileChange[];
  readonly written?: readonly Written[];
  readonly opening?: { readonly relative: string; readonly absolute: string };
  /**
   * Blender also writes a smaller copy for the model to see. Where it goes is
   * chosen only when the call runs: what the call is described as must stay
   * the same between approval and running.
   */
  readonly picture?: true;
};

const minutes = (n: number) => n * 60_000;
const notInstalled =
  "Blender is not installed. Install it from the 3D & Rendering plugin first.";
const noScene: Refusal = {
  reason: "No scene is open. Open or create one with blender_open_scene first.",
  correctable: true,
};
const changesMeaning: Record<string, SceneCommand> = {
  blender_add_objects: "add",
  blender_edit_objects: "edit",
  blender_shape_objects: "shape",
  blender_set_material: "material",
  blender_set_camera: "camera",
  blender_set_lighting: "lighting",
  blender_run_script: "script",
};
const largestScript = 100_000;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: text || "(no answer)" }],
    ...(isError ? { isError: true } : {}),
  };
}

/** The open scene, named as this workspace has it; nothing if it is not in it. */
async function sceneHere(
  root: string,
  session: SceneSession,
): Promise<string | undefined> {
  const file = session.sceneFile();
  return file ? sceneIn(root, file) : undefined;
}

/** The scene file as a change, so going back can restore it. */
const sceneChange = (scene: string): FileChange => ({
  path: scene,
  change: "updated",
  omitted: "The scene, saved in Blender's own format.",
});

const fileChange = (file: Written, what: string): FileChange => ({
  path: file.relative,
  change: file.exists ? "updated" : "created",
  omitted: what,
});

/** The text of a tool's answer, without the pictures it carries. */
function answerText(value: unknown): string {
  const content = (value as { content?: unknown } | undefined)?.content;
  return Array.isArray(content)
    ? content
        .map((part: { type?: unknown; text?: unknown }) =>
          part.type === "text" && typeof part.text === "string"
            ? part.text
            : "",
        )
        .filter((part) => part && !part.startsWith("[image"))
        .join("\n")
    : "";
}

/**
 * A background or engine Blender refuses for this render, refused before it
 * is approved, in Blender's own words and in the order Blender checks them: a
 * plan has a white background of its own and is drawn with EEVEE, and a white
 * background with the product's shadow renders with Cycles.
 */
function renderRefusal(
  args: Readonly<Record<string, unknown>>,
): Refusal | undefined {
  const plan = args["view"] === "plan";
  const background = args["background"];
  if (plan && background !== undefined && background !== "scene")
    return {
      reason: "A plan has a white background of its own: leave background out.",
      correctable: true,
      faulty: ["background"],
    };
  const engine = args["engine"];
  if (engine === undefined) return undefined;
  if (plan && engine !== "eevee")
    return {
      reason:
        "A plan is drawn with EEVEE, whose light from the background walls do not shade: leave engine out.",
      correctable: true,
      faulty: ["engine"],
    };
  if (args["background"] === "white" && engine !== "cycles")
    return {
      reason:
        "A white background with the product's shadow renders with Cycles: use engine cycles.",
      correctable: true,
      faulty: ["engine"],
    };
  return undefined;
}

/** Turns each workspace path in a list of object descriptions into a checked absolute one. */
async function objectsWithPaths(
  root: string,
  objects: unknown,
): Promise<readonly Record<string, unknown>[] | Refusal> {
  if (!Array.isArray(objects) || objects.length === 0)
    return {
      reason: "objects must list at least one object.",
      correctable: true,
    };
  const checked: Record<string, unknown>[] = [];
  for (const [index, item] of objects.entries()) {
    const spec = record(item);
    const kind = spec["kind"];
    if (kind === "image" || kind === "svg" || kind === "model") {
      const allowed =
        kind === "image"
          ? kinds.picture
          : kind === "svg"
            ? kinds.drawing
            : kinds.model;
      const what =
        kind === "image"
          ? "A picture"
          : kind === "svg"
            ? "A drawing"
            : "A model";
      const found = await readable(
        root,
        spec["path"],
        allowed,
        what,
        `objects[${index}].path`,
      );
      if (!("absolute" in found)) return found;
      spec["path"] = found.absolute;
    }
    if (spec["font"] !== undefined) {
      const found = await font(root, spec["font"], `objects[${index}].font`);
      if (!("absolute" in found)) return found;
      spec["font"] = found.absolute;
    }
    checked.push(spec);
  }
  return checked;
}

async function pictureMapWithPath(
  root: string,
  value: unknown,
  field: string,
): Promise<Record<string, unknown> | Refusal | undefined> {
  if (value === undefined) return undefined;
  const map = record(value);
  const found = await readable(
    root,
    map["path"],
    kinds.picture,
    "A picture",
    `${field}.path`,
  );
  if (!("absolute" in found)) return found;
  return { ...map, path: found.absolute };
}

/**
 * One call as Blender will run it and as a person approves it. Every path is
 * checked here, once, for both: what is approved is what runs.
 */
async function prepare(
  name: string,
  args: Args,
  root: string,
  session: SceneSession,
): Promise<Prepared | Refusal> {
  if (name === "blender_open_scene") {
    const file = await writable(
      root,
      args["path"],
      kinds.scene,
      "A scene file",
      "path",
    );
    if (!("absolute" in file)) return file;
    const create = args["create"] === true;
    if (!file.exists && !create)
      return {
        reason: `${file.relative} does not exist. Pass create: true to start a new scene there.`,
        correctable: true,
        faulty: ["path"],
      };
    return {
      command: "open",
      args: { path: file.absolute, create, workspace: root },
      timeoutMs: minutes(3),
      action: file.exists ? "Open a 3D scene" : "Create a 3D scene",
      target: file.relative,
      rows: inWords(openRows(file.relative, file.exists)),
      access: file.exists ? "read" : "change",
      ...(file.exists
        ? {}
        : {
            changes: [
              fileChange(file, "A new scene, in Blender's own format."),
            ],
            written: [file],
          }),
      opening: { relative: file.relative, absolute: file.absolute },
    };
  }
  if (name === "blender_api") {
    if (typeof args["name"] !== "string" || !args["name"].trim())
      return {
        reason: "Name a type, node or operator to look up.",
        correctable: true,
      };
    return {
      command: "api",
      args: { name: args["name"] },
      timeoutMs: minutes(1),
      action: "Look up Blender's API",
      target: args["name"],
      rows: inWords([{ name: "Looks up", value: args["name"] }]),
      access: "read",
    };
  }
  // A scene opened in a folder the conversation has since left is not this
  // workspace's: nothing here changes it.
  const scene = await sceneHere(root, session);
  if (!scene) {
    const why = session.whyNoScene();
    return why ? { ...noScene, reason: `${why} ${noScene.reason}` } : noScene;
  }
  if (name === "blender_describe_scene")
    return {
      command: "describe",
      args: Array.isArray(args["objects"]) ? { objects: args["objects"] } : {},
      timeoutMs: minutes(1),
      action: "Describe a 3D scene",
      target: scene,
      rows: inWords(describeRows(args)),
      access: "read",
    };
  if (name === "blender_render") {
    const refused = renderRefusal(args);
    if (refused) return refused;
    const output = await writable(
      root,
      args["output"],
      kinds.render,
      "A render",
      "output",
    );
    if (!("absolute" in output)) return output;
    return {
      command: "render",
      args: { ...args, output: output.absolute },
      timeoutMs: minutes(30),
      action: "Render a 3D scene",
      target: output.relative,
      rows: inWords(renderRows(args, output.relative)),
      access: "change",
      // The render's settings are kept in the scene.
      changes: [
        fileChange(output, "The picture Blender renders."),
        sceneChange(scene),
      ],
      written: [output],
      picture: true,
    };
  }
  if (name === "blender_export") {
    const output = await writable(
      root,
      args["output"],
      kinds.export,
      "An export",
      "output",
    );
    if (!("absolute" in output)) return output;
    return {
      command: "export",
      args: { ...args, output: output.absolute },
      timeoutMs: minutes(5),
      action: "Export a 3D model",
      target: output.relative,
      rows: inWords(exportRows(args, output.relative)),
      access: "change",
      changes: [fileChange(output, "The model file Blender writes.")],
      written: [output],
    };
  }
  const command = changesMeaning[name];
  if (!command)
    return {
      reason: `The tool “${name}” is not available.`,
      correctable: false,
    };
  let sent: Record<string, unknown> = { ...args };
  let action: string;
  let rows: readonly Row[];
  switch (command) {
    case "add": {
      const objects = await objectsWithPaths(root, args["objects"]);
      if (!Array.isArray(objects)) return objects as Refusal;
      // A model file may name other files; Blender checks them against this.
      sent = { objects, workspace: root };
      action = "Add objects to a 3D scene";
      rows = inWords(addRows(args));
      break;
    }
    case "edit":
      action = "Change objects in a 3D scene";
      rows = inWords(editRows(args));
      break;
    case "shape":
      action = "Model an object in a 3D scene";
      rows = inWords(shapeRows(args));
      break;
    case "material": {
      const material = record(args["material"]);
      for (const key of ["texture", "normal_map"] as const) {
        const map = await pictureMapWithPath(
          root,
          material[key],
          `material.${key}`,
        );
        if (map && "reason" in map) return map as Refusal;
        if (map) material[key] = map;
      }
      sent = { ...args, material };
      action = "Set a material in a 3D scene";
      rows = inWords(materialRows(args));
      break;
    }
    case "camera":
      action = "Set the camera of a 3D scene";
      rows = inWords(cameraRows(args));
      break;
    case "lighting": {
      const background = record(args["background"]);
      if (background["hdri"] !== undefined) {
        const found = await readable(
          root,
          background["hdri"],
          kinds.surroundings,
          "A picture of surroundings",
          "background.hdri",
        );
        if (!("absolute" in found)) return found;
        background["hdri"] = found.absolute;
        sent = { ...args, background };
      }
      action = "Light a 3D scene";
      rows = inWords(lightingRows(args));
      break;
    }
    default: {
      const code = args["code"];
      if (typeof code !== "string" || !code.trim())
        return { reason: "Give the script to run as code.", correctable: true };
      if (code.length > largestScript)
        return {
          reason: `A script may be at most ${largestScript} characters.`,
          correctable: true,
        };
      action = "Run a Blender script in a 3D scene";
      rows = scriptRows(code);
      // What it can reach is said beside the code, in the rows.
      sent = { ...args, folder: root };
    }
  }
  return {
    command,
    args: sent,
    timeoutMs: minutes(command === "script" ? 5 : 2),
    action,
    target: scene,
    rows,
    access: "change",
    changes: [sceneChange(scene)],
  };
}

async function produced(written: readonly Written[]): Promise<ProducedFile[]> {
  const files: ProducedFile[] = [];
  for (const file of written) {
    const status = await stat(file.absolute).catch(() => undefined);
    if (status?.isFile())
      files.push({
        path: file.relative,
        change: file.exists ? "updated" : "created",
        bytes: status.size,
      });
  }
  return files;
}

/** The model's tools on one conversation's scene. */
export function sceneAutomation(
  session: SceneSession,
  options: SceneAutomationOptions,
): WritingConnection {
  const wrote = new WeakMap<object, readonly ProducedFile[]>();
  return {
    /** Asked again every look, so installing Blender is noticed without a restart. */
    async listTools() {
      if (!(await options.blender())) throw new Error(notInstalled);
      if (!session.draws) throw new Error(cannotDraw);
      return studioTools;
    },

    async inspect(name, args) {
      const root = options.workspaceRoot();
      if (!root)
        return {
          ok: false,
          reason: "Choose a folder before working on a 3D scene.",
        };
      if (!(await options.blender()))
        return { ok: false, reason: notInstalled };
      if (!session.draws) return { ok: false, reason: cannotDraw };
      const prepared = await prepare(name, args, root, session);
      if ("reason" in prepared)
        return {
          ok: false,
          reason: prepared.reason,
          ...(prepared.correctable ? { correctable: true } : {}),
          ...(prepared.correctable && prepared.faulty
            ? { faulty: prepared.faulty }
            : {}),
        };
      // Changes to the open scene that write no file over another are one
      // set the person can allow for the conversation; a script, which
      // reaches past the scene, never is.
      const scene = await sceneHere(root, session);
      const replaces = (prepared.written ?? []).some((file) => file.exists);
      const allowance =
        scene &&
        !replaces &&
        prepared.command !== "open" &&
        prepared.command !== "script"
          ? {
              key: JSON.stringify({ workspace: root, scene }),
              label: `Changes to ${scene}, and new files in the workspace`,
            }
          : undefined;
      return {
        ok: true,
        action: prepared.action,
        target: prepared.target,
        ...(allowance ? { allowance } : {}),
        // A script reaches past the scene: it is asked about every time.
        ...(prepared.command === "script"
          ? { asksEachTime: true as const }
          : {}),
        // The call itself, for the technical details; the rows are what a
        // person reads.
        command: `${name}(${JSON.stringify(args)})`,
        invocation: { name: prepared.action, arguments: prepared.rows },
        access: prepared.access,
        scope: "workspace",
        ...(prepared.changes ? { changes: prepared.changes } : {}),
        // What it changes is part of what was approved: the scene it works
        // on, and whether each file it writes is new or replaced.
        boundToCall: true,
        identity: JSON.stringify({
          name,
          scene: scene ?? null,
          args: prepared.args,
          written: (prepared.written ?? []).map((file) => [
            file.relative,
            file.exists,
          ]),
        }),
      };
    },

    async callTool(name, args, signal) {
      const root = options.workspaceRoot();
      if (!root)
        return textResult(
          "Choose a folder before working on a 3D scene.",
          true,
        );
      const prepared = await prepare(name, args, root, session);
      if ("reason" in prepared) return textResult(prepared.reason, true);
      for (const file of prepared.written ?? []) await folderFor(file.absolute);
      const picture = prepared.picture
        ? join(options.directory, "pictures", `${randomUUID()}.jpg`)
        : undefined;
      if (picture) await mkdir(dirname(picture), { recursive: true });
      const outcome = await session.run(
        prepared.command,
        picture ? { ...prepared.args, picture } : prepared.args,
        {
          timeoutMs: prepared.timeoutMs,
          workspace: root,
          ...(signal ? { signal } : {}),
          ...(prepared.opening ? { opening: prepared.opening } : {}),
        },
      );
      if (!outcome.ok) {
        if (picture) await rm(picture, { force: true });
        return textResult(outcome.reason, true);
      }
      const content: {
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
      }[] = [
        {
          type: "text",
          text: [outcome.text, ...outcome.notes].filter(Boolean).join("\n"),
        },
      ];
      if (picture) {
        const copy = await readFile(picture).catch(() => undefined);
        await rm(picture, { force: true });
        if (copy)
          content.push({
            type: "image",
            data: copy.toString("base64"),
            mimeType: "image/jpeg",
          });
      }
      if (prepared.command === "describe") {
        const preview = session.state().preview;
        // Said, so a quick picture from wherever the person turned the view
        // is not judged as the render.
        if (preview)
          content.push(
            {
              type: "text",
              text: `Below, a quick preview of the 3D view, from the ${preview.view === "camera" ? "scene camera" : "overview the person can turn, not the scene camera"}, drawn at low quality: judge framing and colour by a render.`,
            },
            {
              type: "image",
              data: preview.data,
              mimeType: "image/jpeg",
            },
          );
      }
      const result = { content };
      const files = await produced(prepared.written ?? []);
      if (files.length) wrote.set(result, files);
      return result;
    },

    describeResult(name, _args, result) {
      if (!result.ok)
        return [
          { kind: "text", label: "Blender's answer", text: result.reason },
        ];
      const answer = answerText(result.value);
      if (!answer) return [];
      // What a script printed, and Blender's own API listing, are kept as
      // they were written.
      if (name === "blender_run_script")
        return [{ kind: "text", label: "What it printed", text: answer }];
      if (name === "blender_api")
        return [{ kind: "text", label: "Blender's answer", text: answer }];
      return [
        {
          kind: "facts",
          items: [
            {
              label:
                name === "blender_describe_scene" ? "The scene" : "Blender",
              value: answer,
            },
          ],
        },
      ];
    },

    produced(_name, _args, value) {
      return value && typeof value === "object" ? (wrote.get(value) ?? []) : [];
    },

    async close() {},
  };
}
