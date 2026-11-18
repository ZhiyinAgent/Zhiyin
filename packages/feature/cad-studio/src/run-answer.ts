/**
 * What a build's run left in its output folder, read as untrusted: the
 * script runs in the same Python as the harness and can write anything
 * there, so the answer is data to check, and a file is taken only by the
 * name Zhiyin gave it, only as a plain file of the folder's own.
 */

import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  BuildAnswer,
  DrawingReport,
  MeasuredPart,
  Overlap,
} from "./wording.js";
import { explodedIn } from "./exploded-answer.js";
import { requirementsIn } from "./requirements-answer.js";
import { isNumber, isPoint, isRecord, isText } from "./json-values.js";

/** The largest answer read, the largest picture, and the largest preview of the parts. */
const largestAnswer = 4 * 1024 * 1024;
export const largestPicture = 32 * 1024 * 1024;
export const largestPreview = 64 * 1024 * 1024;

/**
 * A file the run wrote at `name` in `folder`, if it is a plain file there:
 * not a link to somewhere else, not a second name of another file, and no
 * larger than `largest`.
 */
export async function plainFile(
  folder: string,
  name: string,
  largest: number,
): Promise<{ readonly path: string; readonly bytes: number } | undefined> {
  const path = resolve(folder, name);
  const status = await lstat(path).catch(() => undefined);
  if (
    !status?.isFile() ||
    status.isSymbolicLink() ||
    status.nlink !== 1 ||
    status.size > largest
  )
    return undefined;
  // The folder's own place, wherever a link above it leads: the file must be in it.
  const [real, place] = await Promise.all([
    realpath(path).catch(() => undefined),
    realpath(folder).catch(() => undefined),
  ]);
  if (!place || real?.toLowerCase() !== resolve(place, name).toLowerCase())
    return undefined;
  return { path, bytes: status.size };
}

function isPart(value: unknown): value is MeasuredPart {
  if (!isRecord(value)) return false;
  const { faces, holes } = value;
  return (
    isText(value["name"]) &&
    typeof value["valid"] === "boolean" &&
    isNumber(value["solids"]) &&
    isPoint(value["size"]) &&
    isPoint(value["min"]) &&
    isPoint(value["max"]) &&
    isNumber(value["volume"]) &&
    isNumber(value["area"]) &&
    (value["shared"] === undefined || isNumber(value["shared"])) &&
    (value["centre"] === null || isPoint(value["centre"])) &&
    isRecord(faces) &&
    Object.values(faces).every(isNumber) &&
    (value["edges"] === undefined ||
      (isRecord(value["edges"]) &&
        ["sharp", "rounded", "chamfered"].every((kind) =>
          isNumber((value["edges"] as Record<string, unknown>)[kind]),
        ))) &&
    Array.isArray(holes) &&
    holes.every(
      (hole) =>
        isRecord(hole) && isNumber(hole["diameter"]) && isNumber(hole["count"]),
    ) &&
    areFaults(value["faults"]) &&
    (value["surfaces"] === undefined ||
      (isRecord(value["surfaces"]) &&
        Object.values(value["surfaces"]).every(isNumber)))
  );
}

function drawingIn(value: unknown): DrawingReport | undefined {
  if (!isRecord(value)) return undefined;
  const { views, dimensions, seconds } = value;
  if (
    !isText(value["sheet"]) ||
    !isText(value["orientation"]) ||
    !isText(value["scale"]) ||
    !isText(value["projection"]) ||
    !Array.isArray(views) ||
    views.length === 0 ||
    !views.every(
      (one) =>
        isRecord(one) &&
        isText(one["name"]) &&
        isText(one["kind"]) &&
        isText(one["scale"]),
    ) ||
    !Array.isArray(dimensions) ||
    !dimensions.every(
      (one) => isRecord(one) && isText(one["view"]) && isText(one["text"]),
    ) ||
    !isRecord(seconds) ||
    !isNumber(seconds["total"])
  )
    return undefined;
  return {
    sheet: value["sheet"],
    orientation: value["orientation"],
    scale: value["scale"],
    projection: value["projection"],
    views: views.map((one) => ({
      name: one["name"],
      kind: one["kind"],
      scale: one["scale"],
      ...(Array.isArray(one["size"]) &&
      one["size"].length === 2 &&
      one["size"].every(isNumber)
        ? {
            size: [one["size"][0] as number, one["size"][1] as number] as const,
          }
        : {}),
      ...(one["hiddenCrowded"] === true ? { hiddenCrowded: true } : {}),
    })),
    dimensions: dimensions.map((one) => ({
      view: one["view"],
      text: one["text"],
      ...(one["crowded"] === true ? { crowded: true } : {}),
      ...(one["beside"] === true ? { beside: true } : {}),
      ...(one["outside"] === true ? { outside: true } : {}),
      ...movedEnds(one["moved"]),
      ...(isText(one["said"]) && one["said"].trim()
        ? { said: one["said"].trim() }
        : {}),
    })),
    seconds: { total: seconds["total"] },
    picture: Boolean(value["picture"]),
    ...(value["scaleAsked"] === true ? { scaleAsked: true } : {}),
    ...(Array.isArray(value["titleCut"]) &&
    value["titleCut"].length &&
    value["titleCut"].every(isText)
      ? { titleCut: value["titleCut"] }
      : {}),
    ...patternsIn(value["patterns"]),
    ...explodedIn(value["exploded"]),
    ...(Array.isArray(value["notes"]) &&
    value["notes"].length &&
    value["notes"].every(isText)
      ? { notes: value["notes"] }
      : {}),
    ...linesIn("skipped", value["skipped"]),
    // Each output by its place among those asked: written, or why not.
    outputs: Array.isArray(value["outputs"])
      ? value["outputs"].map((one) =>
          isRecord(one) && isText(one["failed"]) && one["failed"].trim()
            ? { failed: one["failed"].trim() }
            : {},
        )
      : [],
    ...(value["leftOut"] === true ? { leftOut: true } : {}),
    ...linesIn("partsList", value["partsList"]),
  };
}

/** Lines the harness worded, as a parts list's rows; anything else is left out. */
function linesIn<Key extends string>(key: Key, value: unknown) {
  return Array.isArray(value) && value.length && value.every(isText)
    ? ({ [key]: value as string[] } as { [K in Key]: string[] })
    : {};
}

/** A drawing's answer: the report of the sheet made, or why it was not, and whether that was for want of time. */
export type DrawingAnswer =
  | { readonly failed: string; readonly outOfTime?: boolean }
  | { readonly drawing: DrawingReport };

/** The answer the harness wrote, if what is there is one of the kind asked for: anything else is no answer. */
export async function answerIn(
  folder: string,
  kind: "build",
): Promise<BuildAnswer | undefined>;
export async function answerIn(
  folder: string,
  kind: "drawing",
): Promise<DrawingAnswer | undefined>;
export async function answerIn(
  folder: string,
  kind: "build" | "drawing",
): Promise<BuildAnswer | DrawingAnswer | undefined> {
  const file = await plainFile(folder, "answer.json", largestAnswer);
  if (!file) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file.path, "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (isText(value["failed"]))
    return {
      failed: value["failed"],
      ...(kind === "drawing" && value["outOfTime"] === true
        ? { outOfTime: true }
        : {}),
    };
  if (kind === "drawing") {
    const drawing = drawingIn(value["drawing"]);
    return drawing ? { drawing } : undefined;
  }
  const { parts, overlaps, exports, seconds } = value;
  if (
    !Array.isArray(parts) ||
    !parts.every(isPart) ||
    // A script that showed no part made nothing to export or draw.
    (parts.length === 0 &&
      (!Array.isArray(exports) ||
        exports.length > 0 ||
        value["picture"] ||
        value["preview"])) ||
    !areOverlaps(overlaps) ||
    !(
      value["positions"] === undefined ||
      (Array.isArray(value["positions"]) &&
        value["positions"].every(
          (one) =>
            isRecord(one) &&
            Array.isArray(one["arguments"]) &&
            one["arguments"].every(isText) &&
            areOverlaps(one["overlaps"]),
        ))
    ) ||
    !Array.isArray(exports) ||
    !exports.every(
      (one) =>
        isRecord(one) &&
        Array.isArray(one["parts"]) &&
        one["parts"].every(isText),
    ) ||
    !isRecord(seconds) ||
    !isNumber(seconds["total"])
  )
    return undefined;
  return {
    parts,
    overlaps: overlaps as Overlap[],
    ...(Array.isArray(value["positions"])
      ? {
          positions: value["positions"] as {
            arguments: string[];
            overlaps: Overlap[];
          }[],
        }
      : {}),
    ...looseIn(value["loose"]),
    exports: exports.map((one) => ({
      parts: (one as { parts: string[] }).parts,
      ...(isText(one["failed"]) && one["failed"].trim()
        ? { failed: one["failed"].trim() }
        : {}),
      ...meshIn(one["mesh"]),
      ...motionIn(one["motion"]),
      ...objectsIn(one["objects"]),
      ...linesIn("bom", one["bom"]),
    })),
    seconds: {
      total: seconds["total"],
      ...(isNumber(seconds["position"])
        ? { position: seconds["position"] }
        : {}),
    },
    ...(Array.isArray(value["unchecked"]) &&
    value["unchecked"].length &&
    value["unchecked"].every((one) => Array.isArray(one) && one.every(isText))
      ? { unchecked: value["unchecked"] as string[][] }
      : {}),
    ...(Array.isArray(value["mechanism"]) &&
    value["mechanism"].length &&
    value["mechanism"].every(isText)
      ? { mechanism: value["mechanism"] as string[] }
      : {}),
    ...(Array.isArray(value["helped"]) &&
    value["helped"].length &&
    value["helped"].every(isText)
      ? { helped: value["helped"] as string[] }
      : {}),
    picture: Boolean(value["picture"]),
    ...(isNumber(value["sections"]) && value["sections"] > 0
      ? { sections: value["sections"] }
      : {}),
    ...(Array.isArray(value["sectionNotes"]) &&
    value["sectionNotes"].length &&
    value["sectionNotes"].every(isText)
      ? { sectionNotes: value["sectionNotes"] as string[] }
      : {}),
    ...(isText(value["pictureFailed"]) && value["pictureFailed"].trim()
      ? { pictureFailed: value["pictureFailed"].trim() }
      : {}),
    ...(Array.isArray(value["undrawn"]) &&
    value["undrawn"].length &&
    value["undrawn"].every(
      (one) => isRecord(one) && isText(one["name"]) && isText(one["why"]),
    )
      ? {
          undrawn: (value["undrawn"] as { name: string; why: string }[]).map(
            ({ name, why }) => ({ name, why }),
          ),
        }
      : {}),
    preview: value["preview"] === previewFile,
    ...patternsIn(value["patterns"]),
    ...explodedIn(value["exploded"]),
    ...requirementsIn(value["requirements"]),
    ...(Array.isArray(value["skipped"]) &&
    value["skipped"].length &&
    value["skipped"].every(isText)
      ? { skipped: value["skipped"] as string[] }
      : {}),
    ...(Array.isArray(value["empty"]) &&
    value["empty"].length &&
    value["empty"].every(isText)
      ? { empty: value["empty"] as string[] }
      : {}),
    ...(Array.isArray(value["making"]) &&
    value["making"].length &&
    value["making"].every(isText)
      ? { making: value["making"] as string[] }
      : {}),
    ...(Array.isArray(value["makingUnchecked"]) &&
    value["makingUnchecked"].length &&
    value["makingUnchecked"].every(isText)
      ? { makingUnchecked: value["makingUnchecked"] as string[] }
      : {}),
  };
}

/** How many solids each part of several in a file for printing is, and how many separate objects they print as; anything else is left out. */
function objectsIn(value: unknown) {
  if (
    !isRecord(value) ||
    !Object.keys(value).length ||
    !Object.values(value).every(
      (one) =>
        isRecord(one) && isNumber(one["solids"]) && isNumber(one["objects"]),
    )
  )
    return {};
  return {
    objects: Object.fromEntries(
      Object.entries(
        value as Record<string, { solids: number; objects: number }>,
      ).map(([name, { solids, objects }]) => [name, { solids, objects }]),
    ),
  };
}

/** What each name written as a pattern named, as the harness says it; anything else is left out. */
function patternsIn(value: unknown) {
  return Array.isArray(value) && value.length && value.every(isText)
    ? { patterns: value as string[] }
    : {};
}

/** What a mesh written was meshed for, and how far its facets lie from the surface at most. */
function meshIn(value: unknown) {
  if (
    !isRecord(value) ||
    !["printing", "viewing", "close-ups"].includes(value["for"] as string) ||
    !isNumber(value["within"])
  )
    return {};
  return {
    mesh: {
      for: value["for"] as "printing" | "viewing" | "close-ups",
      within: value["within"],
      ...(isNumber(value["triangles"]) && isNumber(value["open"])
        ? { triangles: value["triangles"], open: value["open"] }
        : {}),
    },
  };
}

/** What a motion file written holds: parts that move, over how many positions, those that stay put, and those that change shape. */
function motionIn(value: unknown) {
  if (
    !isRecord(value) ||
    !isNumber(value["moving"]) ||
    !isNumber(value["still"]) ||
    !isNumber(value["positions"]) ||
    !isRecord(value["unfitted"]) ||
    !Object.values(value["unfitted"]).every(isText)
  )
    return {};
  return {
    motion: {
      moving: value["moving"],
      still: value["still"],
      positions: value["positions"],
      unfitted: value["unfitted"] as Record<string, string>,
      ...(value["sequence"] === true ? { sequence: true } : {}),
    },
  };
}

/** What nothing holds, as the harness writes it; anything else is left out. */
function looseIn(value: unknown) {
  if (
    !isRecord(value) ||
    !Array.isArray(value["parts"]) ||
    !value["parts"].every(isText) ||
    !Array.isArray(value["pieces"]) ||
    !value["pieces"].every(
      (one) =>
        isRecord(one) &&
        isText(one["part"]) &&
        isNumber(one["loose"]) &&
        isNumber(one["of"]),
    )
  )
    return {};
  return {
    loose: {
      ...(value["unchecked"] === true ? { unchecked: true } : {}),
      ...(value["unchecked"] === true &&
      Array.isArray(value["left"]) &&
      value["left"].length &&
      value["left"].every(isText)
        ? { left: value["left"] as string[] }
        : {}),
      parts: value["parts"] as string[],
      pieces: (
        value["pieces"] as {
          part: string;
          loose: number;
          of: number;
          printed?: unknown;
        }[]
      ).map(({ part, loose, of, printed }) => ({
        part,
        loose,
        of,
        ...(printed === true ? { printed: true } : {}),
      })),
    },
  };
}

/** The mesh of the parts a build writes for the person's view of them. */
export const previewFile = "preview.glb";

/** Whether a value is a list of overlaps as the harness writes them. */
const areOverlaps = (value: unknown): value is Overlap[] =>
  Array.isArray(value) &&
  value.every(
    (one) =>
      isRecord(one) &&
      isText(one["first"]) &&
      isText(one["second"]) &&
      isNumber(one["volume"]) &&
      (one["min"] === undefined || isPoint(one["min"])) &&
      (one["max"] === undefined || isPoint(one["max"])) &&
      (one["depth"] === undefined || isNumber(one["depth"])),
  );

/** Where a part that is not valid goes wrong, as the harness writes it. */
const areFaults = (value: unknown) =>
  value === undefined ||
  (isRecord(value) &&
    typeof value["fixed"] === "boolean" &&
    Array.isArray(value["places"]) &&
    value["places"].every(
      (one) =>
        isRecord(one) &&
        isText(one["kind"]) &&
        isText(one["what"]) &&
        isPoint(one["at"]) &&
        isPoint(one["size"]),
    ));

/** Whether a file's first bytes are a PNG's. */
export const isPng = (data: Buffer) =>
  data.length > 8 &&
  data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

/** The ends of a dimension found away from the points given, when the harness says any. */
function movedEnds(value: unknown): {
  moved?: { end: string; at: string; away: string }[];
} {
  if (!Array.isArray(value) || !value.length) return {};
  const moved = value.filter(
    (one): one is { end: string; at: string; away: string } =>
      isRecord(one) &&
      isText(one["end"]) &&
      isText(one["at"]) &&
      isText(one["away"]),
  );
  return moved.length ? { moved } : {};
}
