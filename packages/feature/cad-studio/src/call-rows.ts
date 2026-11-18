/**
 * A CAD call as its approval lays it out for the person: the script whole,
 * as it will run, and what the call asks of it in words, never the tool's
 * field names or its arguments as data.
 */

import type { ToolArgument } from "@zhiyin/contract";
import type { DrawingSpec } from "./drawing-request.js";
import type { ExplodeAsked } from "./explode-request.js";
import { partsListWords } from "./parts-list-words.js";
import { helpersFileWords } from "./script-helpers.js";

/** One file a call writes, as the approval names it. */
export type WrittenFile = {
  readonly relative: string;
  readonly kind: string;
  readonly parts?: readonly string[];
  readonly view?: string;
  readonly detail?: string;
  readonly exploded?: boolean;
  /** A parts list's materials, by part name or pattern. */
  readonly materials?: Readonly<Record<string, string>>;
};

const words = (name: string, value: string): ToolArgument => ({
  name,
  value,
  readable: true,
});

const point = (value: unknown) =>
  Array.isArray(value) ? `(${value.join(", ")})` : "";

const formats: Readonly<Record<string, string>> = {
  step: "STEP",
  stl: "STL",
  "3mf": "3MF",
  glb: "glTF binary",
  svg: "SVG",
  pdf: "PDF",
  dxf: "DXF",
  png: "PNG",
  motion: "motion",
  bom: "CSV",
  helpers: "Python",
};

/** What one written file holds, after its name. */
function holds(file: WrittenFile, drawing: boolean): string {
  const format = formats[file.kind] ?? file.kind;
  if (file.view)
    return `the ${file.view} view alone at full size, in ${format}`;
  if (file.kind === "png")
    return drawing
      ? `a picture of the drawing in ${format}`
      : `the views of ${file.parts?.length ? file.parts.join(", ") : "the parts shown"} in ${format}, as the answer shows them`;
  if (["svg", "pdf", "dxf"].includes(file.kind))
    return `the drawing in ${format}`;
  if (file.kind === "bom") return partsListWords(file.parts, file.materials);
  if (file.kind === "helpers") return helpersFileWords;
  if (file.kind === "motion")
    return `where ${file.parts?.length ? file.parts.join(", ") : "each part shown"} is at each position, for animating it in the 3D studio`;
  const what = `${file.parts?.length ? file.parts.join(", ") : "the parts shown"}${file.exploded ? ", moved apart" : ""}`;
  if (file.kind === "step")
    return `${file.parts?.length ? `${what}'s` : "the part's"} exact faces in ${format}`;
  const use =
    file.kind === "glb"
      ? file.detail === "close-up"
        ? "for close-ups"
        : "for viewing"
      : "for printing";
  return `a mesh of ${what} in ${format}, ${use}`;
}

/** A part of a phrase, left out when the call did not give its value. */
function given(before: string, value: unknown, after = ""): string {
  return typeof value === "string" || typeof value === "number"
    ? `${before} ${value}${after}`
    : "";
}

/** One view of a drawing, as asked. */
function viewWords(view: unknown): string {
  const spec = (view ?? {}) as Record<string, unknown>;
  if (typeof spec["section"] === "string") {
    const uncut = Array.isArray(spec["uncut"]) ? spec["uncut"] : [];
    return `section ${spec["section"]}${given(" looking", spec["looking"])} through ${point(spec["through"])}${
      uncut.length ? `, ${uncut.join(", ")} left whole` : ""
    }`;
  }
  if (typeof spec["detail"] === "string")
    return `detail ${spec["detail"]}${given(" of", spec["of"])} at ${point(spec["at"])}${given(",", spec["radius"], " mm round")}${
      typeof spec["scale"] === "number"
        ? `, at ${spec["scale"]} times the sheet's scale`
        : ""
    }`;
  if (typeof spec["auxiliary"] === "string")
    return `view ${spec["auxiliary"]} looking along ${point(spec["direction"])}`;
  return typeof spec["view"] === "string" ? spec["view"] : "";
}

/** How many dimensions each view has, in the order the views first appear. */
function dimensionWords(dimensions: unknown): string | undefined {
  if (!Array.isArray(dimensions) || !dimensions.length) return undefined;
  const counts = new Map<string, number>();
  for (const one of dimensions) {
    const view = String((one as Record<string, unknown>)["view"]);
    counts.set(view, (counts.get(view) ?? 0) + 1);
  }
  return [...counts].map(([view, count]) => `${count} on ${view}`).join(", ");
}

function drawingRows(drawing: DrawingSpec): ToolArgument[] {
  const rows: ToolArgument[] = [];
  const parts = drawing["parts"];
  if (Array.isArray(parts) && parts.length)
    rows.push(words("Parts", parts.join(", ")));
  const objects = drawing["objects"];
  if (drawing["scene"] === true)
    rows.push(
      words(
        "Objects",
        Array.isArray(objects) && objects.length
          ? objects.join(", ")
          : "every shape the scene shows",
      ),
    );
  const scale = drawing["scale"];
  rows.push(
    words(
      "Sheet",
      `${String(drawing["sheet"] ?? "A3")} ${String(drawing["orientation"] ?? "landscape")}, ${String(drawing["projection"] ?? "first")}-angle projection, ${
        typeof scale === "string"
          ? `at ${scale}`
          : "at the largest scale that fits"
      }`,
    ),
  );
  const views = drawing["views"];
  if (Array.isArray(views) && views.length)
    rows.push(words("Views", views.map(viewWords).join("; ")));
  const dimensions =
    drawing["dimensions"] === undefined && drawing["scene"] !== true
      ? "none asked for, so the overall sizes, and how far apart the axes of each two gears in mesh are"
      : dimensionWords(drawing["dimensions"]);
  if (dimensions) rows.push(words("Dimensions", dimensions));
  if (drawing["parts_list"] === true)
    rows.push(
      words(
        "Parts list",
        partsListWords(
          undefined,
          drawing["materials"] as Record<string, string> | undefined,
          typeof drawing["balloons"] === "string"
            ? { balloons: drawing["balloons"] }
            : {},
        ),
      ),
    );
  const title = drawing["title"];
  if (title && typeof title === "object") {
    const fields = Object.values(title as Record<string, unknown>).filter(
      (value) => typeof value === "string" && value.trim(),
    );
    if (fields.length) rows.push(words("Title block", fields.join(", ")));
  }
  return rows;
}

/**
 * The rows of a build or a drawing: its code, whole, or the 3D scene a
 * drawing is of; the file it comes from; its arguments; and what a drawing
 * shows. What it writes is its list of files.
 */
export function callRows(call: {
  readonly code: string;
  readonly file?: string;
  readonly arguments: readonly string[];
  readonly positions?: readonly (readonly string[])[];
  readonly explode?: ExplodeAsked;
  readonly drawing?: DrawingSpec;
  readonly scene?: string;
  /** How long it may run, when the model chose it. */
  readonly minutes?: number;
}): ToolArgument[] {
  return [
    call.scene
      ? words("3D scene", call.scene)
      : { name: "Code", value: call.code, runs: true },
    ...(call.file ? [words("Script", call.file)] : []),
    ...(call.arguments.length
      ? [words("Arguments", argumentWords(call.arguments))]
      : []),
    ...(call.positions
      ? [words("Positions", call.positions.map(argumentWords).join("; "))]
      : []),
    ...(call.explode ? [words("Moved apart", explodeWords(call.explode))] : []),
    ...(call.drawing ? drawingRows(call.drawing) : []),
    ...(call.minutes !== undefined
      ? [
          words(
            "Time",
            `runs for at most ${call.minutes} ${call.minutes === 1 ? "minute" : "minutes"}`,
          ),
        ]
      : []),
  ];
}

/** How an exploded view is asked for, in words. */
function explodeWords(asked: ExplodeAsked): string {
  const out = asked.parts?.length
    ? asked.parts.join(", ")
    : asked.stay?.length
      ? "every part but those kept in"
      : "every part but the largest";
  return [
    `${out} taken out one at a time, each along a way it is free to leave by`,
    ...(asked.stay?.length ? [`${asked.stay.join(", ")} kept in place`] : []),
    ...(asked.spread !== undefined
      ? [`each moved ${asked.spread} of its own size beyond what it passes`]
      : []),
  ].join("; ");
}

/** A run's arguments as one reads them: one with a space, a quote or nothing in it is quoted, so each reads apart. */
export function argumentWords(given: readonly string[]): string {
  return given
    .map((part) => (/^[^\s"]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
}

/** What one written file holds, as its line in the list of files a call writes. */
export function writtenWords(file: WrittenFile, drawing = false): string {
  const words = holds(file, drawing);
  return `${words[0]!.toUpperCase()}${words.slice(1)}.`;
}

/** The sentence that says which files a call writes outside the workspace, each by its whole real path. */
export function outsideWords(files: readonly WrittenFile[]): string {
  const [only] = files;
  if (files.length === 1 && only)
    return `The ${formats[only.kind] ?? only.kind.toUpperCase()} file ${only.relative} is written outside the folder you selected.`;
  const paths = files.map((file) => file.relative);
  return `The files ${paths.slice(0, -1).join(", ")} and ${paths.at(-1)} are written outside the folder you selected.`;
}
