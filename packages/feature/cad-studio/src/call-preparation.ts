/**
 * One CAD call as it will run and as the person approves it: its script, its
 * arguments, positions and the steps between them, sections, explode and
 * requirements, and each file it
 * writes, every path checked once, here; and what an approval is bound to.
 */

import { stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import type { SceneLines } from "@zhiyin/contract";
import {
  placeForWriting,
  placeOutside,
  placementRefusal,
} from "@zhiyin/workspace-containment";
import { contentDigest } from "@zhiyin/files";
import { fingerprint, scriptOf } from "./script-source.js";
import { fingerprintOf, type ScriptSources } from "./script-sources.js";
import { drawingOf, type DrawingSpec, viewNames } from "./drawing-request.js";
import { sectionsOf, type SectionAsked } from "./sections-request.js";
import { explodeOf, type ExplodeAsked } from "./explode-request.js";
import { materialsProblem } from "./drawing-kinds.js";
import { minutesOf } from "./run-time.js";
import { requirementsFor, type Requirement } from "./requirements-request.js";
import { steppedPositions } from "./position-steps.js";
import { rigidSweepOf, type RigidSweep } from "./rigid-sweep.js";
import { helpersFile } from "./script-helpers.js";

export type Args = Readonly<Record<string, unknown>>;

type Export = {
  /** Workspace-relative, or for a file outside the workspace its whole real path. */
  readonly relative: string;
  readonly absolute: string;
  /** Outside the workspace, where the person approves writing it by its whole real path (ADR 0012). */
  readonly outside?: true;
  readonly exists: boolean;
  /** The content of the file there, when one is: what the approval replaces. */
  readonly digest?: string;
  /** An existing file this conversation's builds wrote, unchanged since. */
  readonly own?: boolean;
  readonly kind: Kind;
  readonly parts?: readonly string[];
  /** A DXF of this view alone, at full size, as cutting needs. */
  readonly view?: string;
  /** A .glb meshed finer, for close-ups. */
  readonly detail?: "close-up";
  /** Written of the parts as explode moves them apart. */
  readonly exploded?: true;
  /** A parts list's materials, by part name or pattern. */
  readonly materials?: Readonly<Record<string, string>>;
};

export type Tool = "cad_build" | "cad_draw";
type Kind =
  | "step"
  | "stl"
  | "3mf"
  | "glb"
  | "motion"
  | "bom"
  | "svg"
  | "pdf"
  | "dxf"
  | "png"
  | "helpers";

export type Prepared = {
  readonly code: string;
  readonly file?: { readonly relative: string; readonly absolute: string };
  /**
   * Each file a workspace script can import, as the decision to run it saw
   * them: what the build runs, part of what an approval is bound to.
   * Nothing for a script whose folder cannot be taken as it is, as one with
   * a link in it.
   */
  readonly sources?: ScriptSources;
  readonly arguments: readonly string[];
  /** The arguments of each run a build is checked at, the first its own, the steps between those listed among them. */
  readonly positions?: readonly (readonly string[])[];
  /** The steps each move between two listed positions is cut into, for a sweep. */
  readonly steps?: number;
  /** Parts turned or slid as one piece from one build, in steps. */
  readonly sweep?: RigidSweep;
  /** The cut views a build adds to its picture. */
  readonly sections?: readonly SectionAsked[];
  /** How a build moves its parts apart, for its picture, its preview, the exports marked exploded and its assembly sequence. */
  readonly explode?: ExplodeAsked;
  /** The requirements a build is checked against, and the workspace file they are in. */
  readonly requirements?: {
    readonly file: string;
    readonly list: readonly Requirement[];
  };
  /** The requirements file found that could not be read, and why. */
  readonly unreadableRequirements?: {
    readonly file: string;
    readonly reason: string;
  };
  readonly exports: readonly Export[];
  readonly tool: Tool;
  readonly drawing?: DrawingSpec;
  /** The 3D scene a drawing is of, workspace-relative, instead of a script's parts. */
  readonly scene?: string;
  /** How long the call may run, when the model chose it, in minutes. */
  readonly minutes?: number;
};

export type Refusal = {
  readonly reason: string;
  readonly correctable: boolean;
};

/** What each tool writes: the list it names its files in, their kinds by ending, and how many at most. */
const forms: Record<
  Tool,
  {
    readonly field: string;
    readonly kinds: Readonly<Record<string, Kind>>;
    readonly endings: string;
    readonly most: number;
  }
> = {
  cad_build: {
    field: "exports",
    kinds: {
      ".step": "step",
      ".stp": "step",
      ".stl": "stl",
      ".3mf": "3mf",
      ".glb": "glb",
      ".png": "png",
      ".json": "motion",
      ".csv": "bom",
      ".py": "helpers",
    },
    endings: ".step, .stp, .stl, .3mf, .glb, .png, .csv or .json",
    most: 8,
  },
  cad_draw: {
    field: "outputs",
    kinds: { ".svg": "svg", ".pdf": "pdf", ".dxf": "dxf", ".png": "png" },
    endings: ".svg, .pdf, .dxf or .png",
    most: 6,
  },
};

export const isTool = (name: string): name is Tool =>
  name === "cad_build" || name === "cad_draw";

/** One call as it will run and as a person approves it: every path checked once, here. */
export async function prepare(
  root: string,
  args: Args,
  tool: Tool,
  lines: SceneLines | undefined,
  protect: readonly string[] = [],
): Promise<Prepared | Refusal> {
  const form = forms[tool];
  if (
    tool === "cad_draw" &&
    args["scene"] !== undefined &&
    typeof args["scene"] !== "boolean"
  )
    return {
      reason: "scene is true to draw the 3D scene open in this conversation.",
      correctable: true,
    };
  const ofScene = tool === "cad_draw" && args["scene"] === true;
  let scene: string | undefined;
  if (ofScene) {
    const stray = ["code", "file", "arguments"].find(
      (key) => args[key] !== undefined,
    );
    if (stray)
      return {
        reason: `A drawing of the 3D scene runs no script; leave out ${stray}.`,
        correctable: true,
      };
    if (!lines || !(await lines.installed()))
      return {
        reason:
          "Drawing a 3D scene needs the 3D studio. Install it from the 3D & Rendering plugin first.",
        correctable: false,
      };
    scene = await lines.open(root);
    if (!scene)
      return {
        reason:
          "No 3D scene is open in this conversation. Open one with blender_open_scene first, or draw parts from a script.",
        correctable: true,
      };
  }
  const script = ofScene
    ? ({ ok: true, code: "" } as const)
    : await scriptOf(root, args);
  if (!script.ok)
    return { reason: script.reason, correctable: script.outside !== true };
  const sources = script.file
    ? await fingerprintOf(script.file.absolute)
    : undefined;
  const given = args["arguments"];
  if (
    given !== undefined &&
    !(Array.isArray(given) && given.every((item) => typeof item === "string"))
  )
    return {
      reason: "arguments is a list of text.",
      correctable: true,
    };
  const positions = args["positions"];
  if (positions !== undefined) {
    if (tool !== "cad_build")
      return {
        reason:
          "positions is for cad_build; a drawing is of one position, given in arguments.",
        correctable: true,
      };
    if (given !== undefined)
      return {
        reason:
          "positions gives the arguments of each run; leave out arguments, or give one position.",
        correctable: true,
      };
    if (
      !Array.isArray(positions) ||
      positions.length < 1 ||
      positions.length > 24 ||
      !positions.every(
        (one) =>
          Array.isArray(one) && one.every((item) => typeof item === "string"),
      )
    )
      return {
        reason:
          "positions lists from 1 to 24 runs, each a list of the arguments it is given.",
        correctable: true,
      };
  }
  const steps = args["steps"];
  let runs = positions as readonly (readonly string[])[] | undefined;
  if (steps !== undefined) {
    if (!runs)
      return {
        reason:
          "steps cuts the moves between positions into steps; give positions with it.",
        correctable: true,
      };
    if (
      !Number.isInteger(steps) ||
      (steps as number) < 2 ||
      (steps as number) > 24
    )
      return {
        reason: "steps is a whole number from 2 to 24.",
        correctable: true,
      };
    const stepped = steppedPositions(runs, steps as number);
    if (!stepped.ok) return { reason: stepped.reason, correctable: true };
    runs = stepped.positions;
  }
  let sweep: RigidSweep | undefined;
  if (args["sweep"] !== undefined) {
    if (tool !== "cad_build")
      return { reason: "sweep is for cad_build.", correctable: true };
    if (runs)
      return {
        reason:
          "sweep moves parts of one build; leave positions out, or check the move with positions alone.",
        correctable: true,
      };
    const checked = rigidSweepOf(args["sweep"]);
    if (!checked.ok) return { reason: checked.reason, correctable: true };
    sweep = checked.sweep;
  }
  const time = minutesOf(
    args["minutes"],
    tool === "cad_draw" ? "drawing" : "build",
  );
  if (!time.ok) return { reason: time.reason, correctable: true };
  let explode: ExplodeAsked | undefined;
  if (tool === "cad_build" && args["explode"] !== undefined) {
    if (runs)
      return {
        reason:
          "explode moves the parts of one position apart; leave out positions, or explode in a call of its own.",
        correctable: true,
      };
    const asked = explodeOf(args["explode"]);
    if (!asked.ok) return { reason: asked.reason, correctable: true };
    explode = asked.explode;
  }
  const cuts = sectionsOf(args["sections"], tool);
  if (!cuts.ok) return { reason: cuts.reason, correctable: true };
  let required: Prepared["requirements"];
  let unreadable: Prepared["unreadableRequirements"];
  if (tool === "cad_build" && !ofScene) {
    const found = await requirementsFor(
      root,
      args["requirements"],
      script.file?.relative,
    );
    // A file that cannot be read as requirements is said in the answer of a
    // build that goes ahead, so it never blocks one.
    if (!found.ok && found.file === undefined)
      return { reason: found.reason, correctable: true };
    if (!found.ok && found.file !== undefined)
      unreadable = { file: found.file, reason: found.reason };
    if (found.ok && found.file && found.requirements)
      required = { file: found.file, list: found.requirements };
  }
  let drawing: DrawingSpec | undefined;
  if (tool === "cad_draw") {
    const checked = drawingOf(args);
    if (!checked.ok) return { reason: checked.reason, correctable: true };
    drawing = checked.spec;
  }
  const asked = args[form.field] ?? [];
  if (!Array.isArray(asked) || asked.length > form.most)
    return {
      reason: `${form.field} lists at most ${form.most} files to write.`,
      correctable: true,
    };
  if (tool === "cad_draw" && asked.length === 0)
    return {
      reason: "outputs names at least one file to write the drawing to.",
      correctable: true,
    };
  const exports: Export[] = [];
  for (const [index, item] of asked.entries()) {
    const spec = (item ?? {}) as Record<string, unknown>;
    const path = spec["path"];
    if (typeof path !== "string" || !path.trim())
      return {
        reason: `${form.field}[${index}] needs a path: a workspace path, or a whole path outside the workspace.`,
        correctable: true,
      };
    const kind = form.kinds[extname(path).toLowerCase()];
    if (!kind)
      return {
        reason: `${path} must end in ${form.endings}.`,
        correctable: true,
      };
    if (
      kind === "helpers" &&
      basename(path.replaceAll("\\", "/")).toLowerCase() !== helpersFile
    )
      return {
        reason: `${path}: a .py export is the helpers module, named ${helpersFile} beside the script that imports it.`,
        correctable: true,
      };
    if (
      kind === "helpers" &&
      ["parts", "detail", "exploded", "materials"].some(
        (key) => spec[key] !== undefined,
      )
    )
      return {
        reason: `${path} holds show and the helpers, no part: give it only its path.`,
        correctable: true,
      };
    const view = spec["view"];
    if (view !== undefined && (kind !== "dxf" || typeof view !== "string"))
      return {
        reason: `${form.field}[${index}].view names the view a .dxf holds alone, at full size.`,
        correctable: true,
      };
    if (
      drawing &&
      typeof view === "string" &&
      !viewNames(drawing).includes(view)
    )
      return {
        reason: `${form.field}[${index}] is of the ${view} view, which the drawing does not have; it has ${viewNames(drawing).join(", ")}.`,
        correctable: true,
      };
    if (kind === "motion" && (runs?.length ?? 0) < 2 && !explode)
      return {
        reason: `${path} would hold where each part is at each position: give positions, two or more, or explode for the parts going together one at a time.`,
        correctable: true,
      };
    const exploded = spec["exploded"];
    if (
      exploded !== undefined &&
      (typeof exploded !== "boolean" || tool !== "cad_build")
    )
      return {
        reason: `${form.field}[${index}].exploded is true to write the parts as explode moves them apart.`,
        correctable: true,
      };
    if (exploded === true && !explode)
      return {
        reason: `${form.field}[${index}].exploded writes the parts as explode moves them apart: give explode too.`,
        correctable: true,
      };
    if (exploded === true && kind === "motion")
      return {
        reason: `${path}, with explode, holds the parts going together one at a time, from as built; leave out exploded.`,
        correctable: true,
      };
    const detail = spec["detail"];
    if (detail !== undefined && (detail !== "close-up" || kind !== "glb"))
      return {
        reason: `${form.field}[${index}].detail "close-up" meshes a .glb finer; .stl and .3mf are always meshed for printing.`,
        correctable: true,
      };
    const materials = spec["materials"];
    if (materials !== undefined && kind !== "bom")
      return {
        reason: `${form.field}[${index}].materials gives a parts list's materials; only a .csv is one.`,
        correctable: true,
      };
    const unmade = materialsProblem(materials);
    if (unmade)
      return {
        reason: `${form.field}[${index}]: ${unmade}`,
        correctable: true,
      };
    const parts = spec["parts"];
    if (tool === "cad_draw" && parts !== undefined)
      return {
        reason: `${form.field}[${index}] is the whole drawing; name the parts it shows in the drawing's own parts.`,
        correctable: true,
      };
    if (
      parts !== undefined &&
      !(
        Array.isArray(parts) &&
        parts.length > 0 &&
        parts.every((name) => typeof name === "string" && name.trim())
      )
    )
      return {
        reason: `${form.field}[${index}].parts names at least one shown part.`,
        correctable: true,
      };
    const placed = await placeOf(root, path, protect);
    if ("reason" in placed) return placed;
    // Windows names files without regard to case.
    const name = placed.relative.toLowerCase().replaceAll("\\", "/");
    const within = (outer: string, inner: string) =>
      inner.startsWith(`${outer}/`);
    const clash = exports.find((other) => {
      const theirs = other.relative.toLowerCase().replaceAll("\\", "/");
      return theirs === name || within(theirs, name) || within(name, theirs);
    });
    if (clash && clash.relative.toLowerCase() !== placed.relative.toLowerCase())
      return {
        reason: `${placed.relative} and ${clash.relative} cannot both be written: one names the other as a folder.`,
        correctable: true,
      };
    if (clash)
      return {
        reason: `${placed.relative} is named twice in ${form.field}.`,
        correctable: true,
      };
    if ((await stat(placed.absolute).catch(() => undefined))?.isDirectory())
      return {
        reason: `${placed.relative} is a folder. Name a file to write.`,
        correctable: true,
      };
    exports.push({
      relative: placed.relative,
      absolute: placed.absolute,
      ...(placed.outside ? { outside: true as const } : {}),
      exists: placed.exists,
      ...(placed.exists
        ? { digest: (await contentDigest(placed.absolute)) ?? "unreadable" }
        : {}),
      kind,
      ...(parts ? { parts: parts as string[] } : {}),
      ...(typeof view === "string" ? { view } : {}),
      ...(detail === "close-up" ? { detail } : {}),
      ...(exploded === true ? { exploded: true as const } : {}),
      ...(materials !== undefined
        ? { materials: materials as Record<string, string> }
        : {}),
    });
  }
  return {
    code: script.code,
    ...(script.file ? { file: script.file } : {}),
    ...(sources ? { sources } : {}),
    arguments: runs?.[0] ?? (given as string[] | undefined) ?? [],
    ...(runs ? { positions: runs } : {}),
    ...(steps !== undefined ? { steps: steps as number } : {}),
    ...(sweep ? { sweep } : {}),
    ...(cuts.sections ? { sections: cuts.sections } : {}),
    ...(explode ? { explode } : {}),
    ...(required ? { requirements: required } : {}),
    ...(unreadable ? { unreadableRequirements: unreadable } : {}),
    exports,
    tool,
    ...(drawing ? { drawing } : {}),
    ...(scene ? { scene } : {}),
    ...(time.minutes !== undefined ? { minutes: time.minutes } : {}),
  };
}

/**
 * Where a file the call writes really goes, links followed: in the
 * workspace, named by a workspace path, or outside it, named by a whole path
 * the person approves; or why it cannot go there. A relative path that
 * climbs out of the workspace is refused, as nothing the model can correct.
 */
async function placeOf(
  root: string,
  path: string,
  protect: readonly string[],
): Promise<
  | {
      readonly relative: string;
      readonly absolute: string;
      readonly exists: boolean;
      readonly outside?: true;
    }
  | Refusal
> {
  if (!isAbsolute(path)) {
    const inside = await placeForWriting(root, path);
    return inside.kind === "writable"
      ? inside
      : placementRefusal(path, inside.kind);
  }
  const place = await placeOutside(root, path, { protect });
  if (place.kind !== "writable") return placementRefusal(path, place.kind);
  if (place.inside) return place;
  return {
    relative: place.absolute,
    absolute: place.absolute,
    exists: place.exists,
    outside: true,
  };
}

/** What an approval is bound to: the code it showed and every file it said it writes. */
export function identityOf(prepared: Prepared): string {
  return JSON.stringify({
    name: prepared.tool,
    code: fingerprint(prepared.code),
    drawing: prepared.drawing ?? null,
    scene: prepared.scene ?? null,
    file: prepared.file?.relative ?? null,
    sources: prepared.sources ?? null,
    arguments: prepared.arguments,
    positions: prepared.positions ?? null,
    steps: prepared.steps ?? null,
    sweep: prepared.sweep ?? null,
    sections: prepared.sections ?? null,
    explode: prepared.explode ?? null,
    minutes: prepared.minutes ?? null,
    exports: prepared.exports.map((one) => [
      one.relative,
      one.exists,
      one.digest ?? null,
      one.own ?? false,
      one.parts ?? null,
      one.view ?? null,
      one.exploded ?? false,
      one.materials ?? null,
    ]),
  });
}
