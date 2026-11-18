/**
 * Compares two pictures for the model: a render against its reference, a
 * page against its mockup, a rebuilt document against its scan, a screen
 * before and after a change. It answers how alike they are, where they
 * differ and with which colours there, whether one is the other moved or
 * zoomed, and shows them on one sheet.
 *
 * Each picture or PDF page is drawn to pixels by the source the app hands in,
 * in a contained process (ADR 0019); everything after that is plain code on
 * those pixels. A read like any other: inside the folder it runs without
 * asking, outside it is named as leaving it, and containment is settled again
 * after links are resolved.
 */

import { open, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import type {
  ToolArgument,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { fileKind, pdfDocument } from "@zhiyin/file-kinds";
import { withSchemaProblems } from "@zhiyin/tool-input";
import { detailsOf, facts } from "../shared/action-detail.js";
import {
  keptAddress,
  type ConversationItems,
} from "../shared/conversation-items.js";
import { bringingDownloads, effectsOf } from "../shared/effects.js";
import { imageSize } from "./image-size.js";
import {
  comparedHere,
  type Averages,
  type PixelComparer,
  type Pixels,
  type Rect,
} from "@zhiyin/picture-comparison";
import type {
  OpenedPixels,
  PixelFormat,
  PixelSource,
} from "./picture-pixels.js";
import {
  describeCommand,
  errorCode,
  isAbortError,
  normalizePath,
  realLocation,
  scopeOf,
  toForwardSlashes,
} from "../shared/workspace-path.js";
import type { ToolDefinition } from "../tool-definition.js";

/** As large as a PDF the tools read. */
const maximumMegabytes = 50;
const maximumBytes = maximumMegabytes * 1024 * 1024;
/** The compared pictures' long side, and each panel's on the sheet. */
const comparedSide = 640;
/** The longest side a picture or a page is drawn at for comparing. */
const largestDrawn = 4000;
/** The narrowest part compared, as a share of the picture on each side. */
const smallestArea = 0.001;
/** The shortest long side two pictures are compared at, however small. */
const smallestCompared = 32;
/**
 * Each picture is drawn this many times as wide as it is compared at, where
 * it has the pixels, and averaged down: a drawing made straight at a small
 * size keeps only some of its pixels, and its edges would differ from those
 * of a picture that small to begin with.
 */
const oversampled = 3;
const sampleBytes = 128 * 1024;
const office = /\.(docx?|xlsx?|pptx?)$/i;

const comparePicturesSpec: ToolSpec = {
  access: "read",
  name: "compare_pictures",
  description: `Compare two pictures, or PDF pages: a render against its reference, a page against its mockup, a rebuilt document against its scan, a screen before and after a change. Shows them side by side, one over the other, and where they differ, on one sheet, and answers their similarity (SSIM of lightness, which follows shapes and light but not hue: 1 is the same picture), their average colour difference (OKLab distance: 0 is the same, 0.05 is visibly different), the share that differs visibly, each area that differs with both pictures' colours there, how the average light changed (in stops, as a camera's exposure is set), how far and towards which hue the average colour moved, and how saturated the second's colours are against the first's, and whether the second's content is the first's moved or zoomed, as a camera framed differently makes it: moved up to 15% of its size, and zoomed from 0.8 to 1.25 times. Pictures of another shape are stretched to the first's, or cut to it with \`fit\`. \`area\` compares a part of both, drawn larger. Each is a workspace-relative path, an absolute path elsewhere, which the person is asked about first, or an attachment:// id. Each can be at most ${maximumMegabytes} MB.`,
  inputSchema: {
    type: "object",
    properties: {
      first: {
        type: "string",
        description:
          "The picture compared against, such as the reference: a PNG, JPEG, WebP, GIF, BMP or PDF.",
      },
      second: {
        type: "string",
        description: "The picture compared with it, such as your render.",
      },
      firstPage: {
        type: "integer",
        minimum: 1,
        description: "The page of the first, when it is a PDF; 1 by default.",
      },
      secondPage: {
        type: "integer",
        minimum: 1,
        description: "The page of the second, when it is a PDF; 1 by default.",
      },
      fit: {
        type: "string",
        enum: ["stretch", "crop"],
        description:
          'When the two are not the same shape: "stretch" draws the second to the first\'s shape, and is the default; "crop" cuts the second to it, keeping its middle.',
      },
      area: {
        type: "object",
        description:
          "Compares only this part of both, as shares of the first picture from its top left, from 0 to 1: drawn larger, for a closer look.",
        properties: {
          left: { type: "number", minimum: 0, maximum: 1 },
          top: { type: "number", minimum: 0, maximum: 1 },
          width: { type: "number", exclusiveMinimum: 0, maximum: 1 },
          height: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        },
        required: ["left", "top", "width", "height"],
        additionalProperties: false,
      },
    },
    required: ["first", "second"],
    additionalProperties: false,
  },
};

type Area = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

type CompareArguments = {
  readonly first: string;
  readonly second: string;
  readonly firstPage: number;
  readonly secondPage: number;
  readonly fit: "stretch" | "crop";
  readonly area?: Area;
};

type Refusal = Extract<ToolCallInspection, { ok: false }>;
type Failure = Extract<ToolInvocationResult, { ok: false }>;

/** A call the model can mend, refused before it runs (ADR 0009). */
const correctable = (reason: string): Refusal => ({
  ok: false,
  reason,
  correctable: true,
});

/** What comparing found wrong with a picture, answered as the result. */
const failed = (reason: string): Failure => ({ ok: false, reason });

/** The inputs the schema names; each check below says what is wrong with one. */
const argumentNames = Object.keys(
  comparePicturesSpec.inputSchema["properties"] as object,
);

function pathOf(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return keptAddress(value) ? value.trim() : normalizePath(value);
}

/** The input, or its refusal followed by how it departs from the schema. */
function readArguments(args: unknown): CompareArguments | Refusal {
  const input = argumentsIn(args);
  return "reason" in input
    ? {
        ...input,
        reason: withSchemaProblems(
          input.reason,
          args,
          comparePicturesSpec.inputSchema,
        ),
      }
    : input;
}

function argumentsIn(args: unknown): CompareArguments | Refusal {
  if (!args || typeof args !== "object" || Array.isArray(args))
    return correctable(
      "Name the two pictures to compare, as first and second.",
    );
  const source = args as Record<string, unknown>;
  const unknown = Object.keys(source).filter(
    (key) => !argumentNames.includes(key),
  );
  if (unknown.length)
    return correctable(
      `compare_pictures takes ${argumentNames.join(", ")}; not ${unknown.join(", ")}.`,
    );
  const first = pathOf(source["first"]);
  const second = pathOf(source["second"]);
  if (!first || !second)
    return correctable(
      "Name the two pictures to compare, as first and second.",
    );
  const page = (name: "firstPage" | "secondPage") => {
    const value = source[name];
    if (value === undefined) return 1;
    return typeof value === "number" && Number.isInteger(value) && value >= 1
      ? value
      : undefined;
  };
  const firstPage = page("firstPage");
  const secondPage = page("secondPage");
  if (firstPage === undefined || secondPage === undefined)
    return correctable("A page is a whole number from 1.");
  const fit = source["fit"] ?? "stretch";
  if (fit !== "stretch" && fit !== "crop")
    return correctable('fit is "stretch" or "crop".');
  const area = areaOf(source["area"]);
  if (area === "invalid")
    return correctable(
      "area is left, top, width and height, each a share of the first picture from 0 to 1; it must lie inside the picture, and be at least 0.001 wide and high there.",
    );
  return {
    first,
    second,
    firstPage,
    secondPage,
    fit,
    ...(area ? { area } : {}),
  };
}

function areaOf(value: unknown): Area | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "invalid";
  const source = value as Record<string, unknown>;
  const names = ["left", "top", "width", "height"];
  if (Object.keys(source).some((key) => !names.includes(key))) return "invalid";
  const [left, top, width, height] = names.map((name) => source[name]);
  const share = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  if (!share(left) || !share(top) || !share(width) || !share(height))
    return "invalid";
  // A hair past the edge is rounding; more is a part that is not there.
  if (left + width > 1.0005 || top + height > 1.0005) return "invalid";
  const within = {
    left,
    top,
    width: Math.min(width, 1 - left),
    height: Math.min(height, 1 - top),
  };
  // What is left inside the picture must be a part of it to compare.
  if (within.width < smallestArea || within.height < smallestArea)
    return "invalid";
  return within;
}

/** Where a path points, as the inspection names it. */
function located(root: string, path: string) {
  if (keptAddress(path)) return { name: path, scope: "workspace" as const };
  const absolute = resolve(root, path);
  const scope = scopeOf(root, absolute);
  return {
    name: toForwardSlashes(
      scope === "outside" ? absolute : relative(root, absolute),
    ),
    scope,
  };
}

/** A share of a picture as a percentage, to a tenth. */
const share = (value: number) => `${Math.round(value * 1000) / 10}%`;

/** What a comparison asks, in words, as its approval shows it. */
function askedInWords(
  input: CompareArguments,
  names: { readonly first: string; readonly second: string },
): ToolArgument[] {
  const picture = (path: string, page: number) =>
    page === 1 ? path : `${path}, page ${page}`;
  const words = (name: string, value: string): ToolArgument => ({
    name,
    value,
    readable: true,
  });
  const { area } = input;
  return [
    words("First picture", picture(names.first, input.firstPage)),
    words("Second picture", picture(names.second, input.secondPage)),
    ...(area
      ? [
          words(
            "Area",
            `from ${share(area.left)} to ${share(area.left + area.width)} across and ${share(area.top)} to ${share(area.top + area.height)} down the first picture`,
          ),
        ]
      : []),
    ...(input.fit === "crop"
      ? [
          words(
            "Of another shape",
            "the second cut to the first's shape, keeping its middle",
          ),
        ]
      : []),
  ];
}

/**
 * A picture Windows marks as downloaded from the internet brings outside
 * content; one the person attached is Zhiyin's own record of it.
 */
async function inspectComparePictures(
  root: string,
  args: unknown,
): Promise<ToolCallInspection> {
  const input = readArguments(args);
  if ("reason" in input) return input;
  const files = [input.first, input.second]
    .filter((path) => !keptAddress(path))
    .map((path) => resolve(root, path));
  const first = located(root, input.first);
  const second = located(root, input.second);
  const outsiders = [first, second].filter(
    ({ scope }) => scope === "outside",
  ).length;
  const outside = outsiders > 0;
  const reads = outside ? "elsewhere" : files.length ? "workspace" : "app";
  const action =
    outsiders === 2
      ? "Compare two pictures outside the workspace"
      : outside
        ? "Compare two pictures, one outside the workspace"
        : "Compare two pictures";
  return bringingDownloads(
    {
      ok: true,
      action,
      target: `${first.name} and ${second.name}`,
      invocation: {
        name: action,
        arguments: askedInWords(input, {
          first: first.name,
          second: second.name,
        }),
      },
      command: describeCommand(comparePicturesSpec.name, input),
      effects: effectsOf({ reads }),
      ...(outside
        ? {
            detail:
              outsiders === 2
                ? "Pictures compared from outside the folder you selected become part of this conversation."
                : "A picture compared from outside the folder you selected becomes part of this conversation.",
          }
        : {}),
    },
    files,
  );
}

type CompareContext = {
  readonly acceptsImages: boolean;
  /** Where pictures become pixels; with none, nothing is drawn. */
  readonly pixels: PixelSource | undefined;
  /** Where their pixels are compared; in this thread when none is given. */
  readonly comparer?: PixelComparer;
  readonly conversationId?: string;
  readonly items?: ConversationItems;
};

/** A picture's bytes and kind, and what to call it. */
type Loaded = {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly format: PixelFormat;
  /**
   * A picture's own size, from its header: it may be drawn smaller than
   * that, and its pixels are named in its own.
   */
  readonly natural?: { readonly width: number; readonly height: number };
};

async function load(
  root: string,
  path: string,
  scope: "workspace" | "outside",
  name: string,
  signal: AbortSignal | undefined,
  context: CompareContext,
): Promise<Loaded | Failure> {
  const kept = keptAddress(path);
  if (kept?.kind === "attachment") {
    if (!context.conversationId || !context.items?.readPicture)
      return failed(`${path} is not available here.`);
    const stored = await context.items.readPicture(
      context.conversationId,
      kept.id,
    );
    if (stored.status !== "ready") return failed(stored.reason);
    const bytes = Buffer.from(stored.data, "base64");
    const natural = imageSize(bytes);
    return {
      name: path,
      bytes: new Uint8Array(bytes),
      format: "picture",
      ...(natural ? { natural } : {}),
    };
  }
  if (kept)
    return failed(
      `${path} is text this conversation kept, not a picture, so it cannot be compared.`,
    );
  if (office.test(extname(path)))
    return failed(
      `${name} is an Office document, not a picture or a PDF, so it cannot be compared. Save it as a PDF first.`,
    );
  try {
    const real = await realLocation(root, path);
    // A link can lead out of the workspace after the call was approved as a
    // read inside it.
    if (scope === "workspace" && real.scope !== "workspace")
      return { ok: false, reason: `${name} leads outside the workspace.` };
    const file = await stat(real.path);
    if (!file.isFile()) return failed(`${name} is not a file.`);
    if (file.size > maximumBytes)
      return failed(
        `${name} is over ${maximumMegabytes} MB, too large to compare. Make a smaller copy with a command or a script, such as the one page or a scaled-down picture, and compare that.`,
      );
    const handle = await open(real.path, "r");
    let sample: Buffer;
    try {
      sample = Buffer.alloc(Math.min(sampleBytes, file.size));
      await handle.read(sample, 0, sample.length, 0);
    } finally {
      await handle.close();
    }
    const kind = fileKind(sample);
    const format: PixelFormat | undefined =
      kind.kind === "binary" && kind.named === pdfDocument
        ? "pdf"
        : kind.kind === "binary" && kind.mediaType
          ? "picture"
          : undefined;
    if (!format)
      return failed(
        kind.kind === "text"
          ? `${name} is a text file, not a picture or a PDF, so it cannot be compared.`
          : `${name} is not a picture or a PDF${kind.named ? ` — it is ${kind.named}` : ""}, so it cannot be compared.`,
      );
    const bytes = await readFile(real.path, signal ? { signal } : {});
    // Read from the whole file: a photo's header can run past the sample.
    const natural = format === "picture" ? imageSize(bytes) : undefined;
    return {
      name,
      bytes: new Uint8Array(bytes),
      format,
      ...(natural ? { natural } : {}),
    };
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      return failed(
        scope === "outside"
          ? `${name} was not found.`
          : `${path} was not found in this workspace.`,
      );
    if (isAbortError(error))
      return { ok: false, reason: "The comparison was cancelled." };
    return failed(`${name} could not be read.`);
  }
}

/** A frame's shape in words, by a common ratio where it is close to one. */
function shapeOf(width: number, height: number): string {
  const ratio = width / height;
  const common: [number, number][] = [
    [1, 1],
    [5, 4],
    [4, 3],
    [3, 2],
    [16, 10],
    [16, 9],
    [2, 1],
    [21, 9],
    [3, 1],
  ];
  for (const [p, q] of common) {
    if (Math.abs(ratio / (p / q) - 1) < 0.015) return `${p}:${q}`;
    if (Math.abs(ratio / (q / p) - 1) < 0.015) return `${q}:${p}`;
  }
  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
}

/** Average OKLab chroma below which a picture reads as grey. */
const nearlyGrey = 0.015;
/**
 * An OKLab move of the average colour too small to give a hue for: a tenth
 * of the distance taken as visibly different.
 */
const tooSmallToTurn = 0.005;

const percent = (share: number) =>
  share === 0
    ? "0%"
    : share < 0.001
      ? "under 0.1%"
      : share < 0.01
        ? `${(share * 100).toFixed(1)}%`
        : `${Math.round(share * 100)}%`;

const hex = ([r, g, b]: readonly [number, number, number]) =>
  `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;

/**
 * The hue a colour moves towards, by its direction in OKLab's colour plane,
 * in degrees from +a: each hue's sector runs to half way to its neighbours'.
 */
const hues: readonly { readonly from: number; readonly name: string }[] = [
  { from: -2, name: "red" },
  { from: 70, name: "yellow" },
  { from: 126, name: "green" },
  { from: 168, name: "cyan" },
  { from: 230, name: "blue" },
  { from: 296, name: "magenta" },
];

function hueOf(da: number, db: number): string {
  // From -2 to 358, so red's sector, which spans +a, is one run.
  const angle =
    (((((Math.atan2(db, da) * 180) / Math.PI + 2) % 360) + 360) % 360) - 2;
  return ([...hues].reverse().find(({ from }) => angle >= from) ?? hues[0]!)
    .name;
}

/**
 * The two pictures' average light, colour and saturation, a sentence each,
 * and whether any of them changed as far as they are said.
 */
function averagesSaid(averages: Averages): {
  readonly said: readonly string[];
  readonly changed: boolean;
} {
  const { lightness, lightRatio, colourMove, chroma } = averages;
  const both = `average lightness ${Math.round(lightness.first)} and ${Math.round(lightness.second)} of 100`;
  // Light is said in stops, as a camera's exposure is set; against nearly
  // black, a share of light says nothing.
  const stops =
    lightRatio === undefined
      ? undefined
      : Math.round(Math.log2(lightRatio) * 10) / 10;
  const way = stops !== undefined && stops < 0 ? "less" : "more";
  const light =
    stops === undefined
      ? `One of the two is nearly black, so no share of light is given: ${both}.`
      : stops === 0
        ? `The two have the same light on average: ${both}.`
        : `The second has ${Math.round(Math.abs(lightRatio! - 1) * 100)}% ${way} light than the first on average, ${Math.abs(stops)} ${Math.abs(stops) === 1 ? "stop" : "stops"} ${way}: ${both}.`;
  const moved = Math.hypot(colourMove.a, colourMove.b);
  const colour =
    moved < tooSmallToTurn
      ? `The average colour is the same in both, moved ${moved.toFixed(3)} in OKLab.`
      : `The second's average colour moved ${moved.toFixed(3)} in OKLab, towards ${hueOf(colourMove.a, colourMove.b)}.`;
  const ratio =
    chroma.first < nearlyGrey
      ? undefined
      : Math.round((chroma.second / chroma.first) * 100) / 100;
  const saturation =
    ratio === undefined
      ? `The first has almost no colour to compare saturation by: average chroma ${chroma.first.toFixed(3)} in the first and ${chroma.second.toFixed(3)} in the second, in OKLab.`
      : ratio === 1
        ? "The two are as saturated as each other on average."
        : `The second's colours are ${ratio.toFixed(2)} times as saturated as the first's on average.`;
  return {
    said: [light, colour, saturation],
    changed:
      stops !== 0 ||
      moved >= tooSmallToTurn ||
      (ratio === undefined ? chroma.second >= nearlyGrey : ratio !== 1),
  };
}

/**
 * A page drawn at least `width` wide, but never past `largestDrawn` on its
 * long side, or nothing when it cannot be drawn. A small part of a large
 * page then compares at less than its full detail, and no page's pixels
 * grow past what the core takes in.
 */
async function drawn(
  opened: Extract<OpenedPixels, { ok: true }>,
  page: number,
  width: number,
): Promise<Pixels | "stopped" | "unstartable" | undefined> {
  const size = opened.pages[page - 1]!;
  const widest =
    (largestDrawn * size.width) / Math.max(size.width, size.height);
  return opened.draw(page, Math.max(1, Math.ceil(Math.min(width, widest))));
}

async function runComparePictures(
  root: string,
  args: unknown,
  signal: AbortSignal | undefined,
  context: CompareContext,
): Promise<ToolInvocationResult> {
  const input = readArguments(args);
  if ("reason" in input) return failed(input.reason);
  const firstAt = located(root, input.first);
  const secondAt = located(root, input.second);
  const loaded = await Promise.all([
    load(root, input.first, firstAt.scope, firstAt.name, signal, context),
    load(root, input.second, secondAt.scope, secondAt.name, signal, context),
  ]);
  for (const one of loaded) if ("reason" in one) return one;
  const [first, second] = loaded as [Loaded, Loaded];

  const source = context.pixels;
  if (!source)
    return failed(
      "No contained process could draw the pictures, so they were not compared.",
    );
  const unopened = (
    opened: Extract<OpenedPixels, { ok: false }>,
    picture: Loaded,
  ) =>
    failed(
      opened.failure === "unstartable"
        ? "No contained process could draw the pictures, so they were not compared."
        : opened.failure === "stopped"
          ? `${picture.name} could not be drawn: drawing it took too long, or its process stopped, so the pictures were not compared.`
          : `${picture.name} could not be drawn: it may be damaged, or protected by a password.`,
    );
  // One at a time, so a picture that cannot be drawn costs no second drawing.
  if (signal?.aborted) return failed("The comparison was cancelled.");
  const a = await source.open(first.bytes, first.format);
  if (!a.ok) return unopened(a, first);
  if (signal?.aborted) {
    a.close();
    return failed("The comparison was cancelled.");
  }
  const b = await source.open(second.bytes, second.format);
  if (!b.ok) {
    a.close();
    return unopened(b, second);
  }
  try {
    const pageOf = (opened: typeof a, picture: Loaded, page: number) => {
      const size = opened.pages[page - 1];
      if (size) return size;
      return failed(
        picture.format === "pdf"
          ? `${picture.name} has ${opened.pages.length} page${opened.pages.length === 1 ? "" : "s"}, so it has no page ${page}.`
          : `${picture.name} is a picture, with no page ${page}.`,
      );
    };
    const sizeA = pageOf(a, first, input.firstPage);
    if ("reason" in sizeA) return sizeA;
    const sizeB = pageOf(b, second, input.secondPage);
    if ("reason" in sizeB) return sizeB;
    const ownA = ownSize(first, sizeA);
    const ownB = ownSize(second, sizeB);

    const area = input.area ?? { left: 0, top: 0, width: 1, height: 1 };
    // The part of the second laid over the first's whole frame.
    const shapeA = sizeA.width / sizeA.height;
    const shapeB = sizeB.width / sizeB.height;
    const sameShape = Math.abs(shapeA / shapeB - 1) <= 0.01;
    const frameB =
      sameShape || input.fit === "stretch"
        ? { x: 0, y: 0, width: sizeB.width, height: sizeB.height }
        : shapeB > shapeA
          ? {
              x: (sizeB.width - sizeB.height * shapeA) / 2,
              y: 0,
              width: sizeB.height * shapeA,
              height: sizeB.height,
            }
          : {
              x: 0,
              y: (sizeB.height - sizeB.width / shapeA) / 2,
              width: sizeB.width,
              height: sizeB.width / shapeA,
            };
    const partA = {
      width: sizeA.width * area.width,
      height: sizeA.height * area.height,
    };
    const partB = {
      width: frameB.width * area.width,
      height: frameB.height * area.height,
    };
    // Compared at the detail the coarser of the two parts has: drawing the
    // other larger would show differences that are only its own blur.
    const detail = (part: typeof partA, picture: Loaded, size: typeof sizeA) =>
      Math.max(part.width, part.height) *
      Math.min(
        picture.format === "pdf" ? 2 : 1,
        largestDrawn / Math.max(size.width, size.height),
      );
    const longest = Math.max(
      smallestCompared,
      Math.min(
        comparedSide,
        detail(partA, first, sizeA),
        detail(partB, second, sizeB),
      ),
    );
    const partShape = partA.width / partA.height;
    const width = Math.max(
      1,
      Math.round(partShape >= 1 ? longest : longest * partShape),
    );
    const height = Math.max(
      1,
      Math.round(partShape >= 1 ? longest / partShape : longest),
    );

    // One at a time, so a first that cannot be drawn, or a comparison
    // stopped while it is, costs no second drawing.
    const undrawn = (
      pixels: "stopped" | "unstartable" | undefined,
      picture: Loaded,
    ): Failure =>
      pixels === "unstartable"
        ? failed(
            "No contained process could draw the pictures, so they were not compared.",
          )
        : pixels === "stopped"
          ? failed(
              `${picture.name} could not be drawn: drawing it took too long, or its process stopped, so the pictures were not compared.`,
            )
          : failed(
              `${picture.name} could not be drawn, so the pictures were not compared.`,
            );
    if (signal?.aborted) return failed("The comparison was cancelled.");
    const pixelsA = await drawn(
      a,
      input.firstPage,
      (oversampled * width) / area.width,
    );
    if (signal?.aborted) return failed("The comparison was cancelled.");
    if (typeof pixelsA !== "object") return undrawn(pixelsA, first);
    const pixelsB = await drawn(
      b,
      input.secondPage,
      (oversampled * width * sizeB.width) / partB.width,
    );
    if (signal?.aborted) return failed("The comparison was cancelled.");
    if (typeof pixelsB !== "object") return undrawn(pixelsB, second);
    const scaleA = pixelsA.width / sizeA.width;
    const scaleB = pixelsB.width / sizeB.width;
    const rectA: Rect = {
      x: area.left * sizeA.width * scaleA,
      y: area.top * sizeA.height * scaleA,
      width: partA.width * scaleA,
      height: partA.height * scaleA,
    };
    const rectB: Rect = {
      x: (frameB.x + area.left * frameB.width) * scaleB,
      y: (frameB.y + area.top * frameB.height) * scaleB,
      width: partB.width * scaleB,
      height: partB.height * scaleB,
    };
    const found = await (context.comparer ?? comparedHere).compare(
      { pixels: pixelsA, rect: rectA },
      { pixels: pixelsB, rect: rectB },
      { width, height },
      signal,
    );
    if (found === "cancelled" || signal?.aborted)
      return failed("The comparison was cancelled.");
    if (found === "failed")
      return failed(
        "The pictures were drawn, but comparing them failed, so there is no answer.",
      );

    const describedSize = (
      picture: Loaded,
      page: number,
      opened: typeof a,
      own: typeof ownA,
    ) =>
      picture.format === "pdf"
        ? `${picture.name}, page ${page} of ${opened.pages.length}, ${own.width} × ${own.height} at 96 pixels per inch`
        : `${picture.name}, ${own.width} × ${own.height}`;
    const ownPixels =
      first.format === "pdf"
        ? `of the first page's ${ownA.width} × ${ownA.height}`
        : `of the first picture's ${ownA.width} × ${ownA.height}`;
    // Shares are of what was compared: the whole picture, or the area.
    const whole = input.area ? "the area" : "the picture";
    const areas = found.areas.map((one, index) => {
      // From the compared pixels to shares of the first picture's whole frame.
      const left = area.left + (one.box.x / width) * area.width;
      const top = area.top + (one.box.y / height) * area.height;
      const boxWidth = (one.box.width / width) * area.width;
      const boxHeight = (one.box.height / height) * area.height;
      const px = (share: number, side: number) => Math.round(share * side);
      // In the shares `area` takes, so a box can be looked at closer as it is:
      // rounded, it still ends inside the picture.
      const shareOf = (value: number) => Math.round(value * 1000) / 1000;
      const boxLeft = shareOf(left);
      const boxTop = shareOf(top);
      return {
        area: index + 1,
        box: {
          left: boxLeft,
          top: boxTop,
          width: Math.min(shareOf(boxWidth), shareOf(1 - boxLeft)),
          height: Math.min(shareOf(boxHeight), shareOf(1 - boxTop)),
        },
        where: `x ${px(left, ownA.width)}–${px(left + boxWidth, ownA.width)}, y ${px(top, ownA.height)}–${px(top + boxHeight, ownA.height)} ${ownPixels}`,
        share: `${percent(one.share)} of ${whole}`,
        first: hex(one.first),
        second: hex(one.second),
      };
    });
    // The averages are measures, not a verdict on which edit was made: the
    // sheet shows that to a model that can see it.
    const overall = averagesSaid(found.averages);
    const alignment = found.alignment
      ? alignmentOf(found.alignment, input.area !== undefined)
      : undefined;
    const differs =
      found.changed === 0
        ? // A change made evenly across the picture can show side by side
          // though no one part differs past what shows on its own.
          overall.changed
          ? "No one part differs visibly; the change is across the whole picture."
          : "Nothing differs visibly."
        : found.strongest
          ? `${percent(found.changed)} of ${whole} differs visibly; the areas named are where it differs most.`
          : `${percent(found.changed)} of ${whole} differs visibly${areas.length ? `, in ${areas.length}${found.moreAreas ? " named" : ""} area${areas.length === 1 ? "" : "s"}` : ", in spots too small to name"}.`;
    const fitted = sameShape
      ? undefined
      : `The second is ${shapeOf(sizeB.width, sizeB.height)} and the first ${shapeOf(sizeA.width, sizeA.height)}, so the second was ${input.fit === "crop" ? "cut to the first's shape, keeping its middle" : "stretched to the first's shape"}.`;
    const similarity = Math.round(found.similarity * 1000) / 1000;
    const firstSaid = describedSize(first, input.firstPage, a, ownA);
    const secondSaid = describedSize(second, input.secondPage, b, ownB);

    return {
      ok: true,
      value: {
        first: firstSaid,
        second: secondSaid,
        compared: `${width} × ${height} pixels${input.area ? `, the part x ${percent(area.left)}–${percent(area.left + area.width)}, y ${percent(area.top)}–${percent(area.top + area.height)} of each` : ""}`,
        ...(fitted ? { fitted } : {}),
        similarity,
        averageDifference: Math.round(found.averageDistance * 1000) / 1000,
        differs,
        ...(areas.length ? { areas } : {}),
        ...(found.moreAreas
          ? {
              moreAreas: `${found.moreAreas} smaller area${found.moreAreas === 1 ? "" : "s"} differ${found.moreAreas === 1 ? "s" : ""} too.`,
            }
          : {}),
        overall: overall.said,
        ...(alignment ? { alignment } : {}),
        ...(context.acceptsImages
          ? {
              picture:
                "The picture shows the first top left and the second top right; bottom left, the two at half strength each, where a shift shows as a double edge; bottom right, where they differ, in red over a pale copy of the first. The areas are boxed and numbered as listed.",
            }
          : {}),
      },
      images: [
        {
          mediaType: "image/png",
          data: Buffer.from(found.sheet).toString("base64"),
        },
      ],
      ...detailsOf(
        facts(
          ["First", firstSaid],
          ["Second", secondSaid],
          ["Similarity", similarity.toFixed(3)],
          ["Differs", differs],
          ...(fitted ? ([["Fitted", fitted]] as const) : []),
        ),
      ),
    };
  } finally {
    a.close();
    b.close();
  }
}

/**
 * A picture's own size as it is shown, from its header: as stored, or turned
 * a quarter where its camera marked it so and it is drawn turned. A header
 * of neither shape, or none, as for a PDF page, leaves the size it is drawn
 * at.
 */
function ownSize(
  picture: Loaded,
  drawnAt: { readonly width: number; readonly height: number },
) {
  const own = picture.natural;
  if (!own) return drawnAt;
  const shaped = (width: number, height: number) =>
    Math.abs(width / height / (drawnAt.width / drawnAt.height) - 1) <= 0.02;
  if (shaped(own.width, own.height)) return own;
  if (shaped(own.height, own.width))
    return { width: own.height, height: own.width };
  return drawnAt;
}

/** How the second's content sits against the first's, in words. */
function alignmentOf(
  found: {
    readonly right: number;
    readonly down: number;
    readonly scale: number;
    readonly similarityAligned: number;
  },
  ofArea: boolean,
) {
  const across = Math.round(found.right * 100);
  const along = Math.round(found.down * 100);
  const larger = Math.round((found.scale - 1) * 100);
  const of = ofArea ? "the area's" : "the";
  const moves = [
    across
      ? `${Math.abs(across)}% of ${of} width ${across > 0 ? "further right" : "further left"}`
      : "",
    along
      ? `${Math.abs(along)}% of ${of} height ${along > 0 ? "lower" : "higher"}`
      : "",
  ].filter(Boolean);
  const parts = [
    moves.length ? `sits ${moves.join(" and ")} than the first's` : "",
    larger
      ? `looks ${Math.abs(larger)}% ${larger > 0 ? "larger" : "smaller"}`
      : "",
  ].filter(Boolean);
  // A move that rounds to nothing in whole percent is not one to say.
  if (!parts.length) return undefined;
  const aligned = Math.round(found.similarityAligned * 1000) / 1000;
  return {
    right: across,
    down: along,
    larger,
    similarityAligned: aligned,
    says: `The second's content ${parts.join(", and ")}. Moved back, the two have a similarity of ${aligned.toFixed(3)} where they overlap.`,
  };
}

/** What comparing pictures needs from the application. */
export type ComparePicturesNeeds = {
  /** Whether the model can be shown a picture, asked on every call. */
  readonly acceptsImages: (() => boolean) | undefined;
  readonly pixels: PixelSource | undefined;
  readonly comparer: PixelComparer | undefined;
  readonly items: ConversationItems | undefined;
};

/** The picture comparison, as the registry offers it. */
export function comparePicturesTool({
  acceptsImages,
  pixels,
  comparer,
  items,
}: ComparePicturesNeeds): ToolDefinition {
  return {
    spec: comparePicturesSpec,
    // Offered without a folder only to compare two attached pictures.
    requiresWorkspace: items ? (args) => !comparesAttachments(args) : true,
    inspect: async (args, _id, { root }) => inspectComparePictures(root, args),
    execute: (args, signal, conversationId, { root }) =>
      runComparePictures(root, args, signal, {
        acceptsImages: acceptsImages?.() ?? false,
        pixels,
        ...(comparer ? { comparer } : {}),
        ...(conversationId ? { conversationId } : {}),
        ...(items ? { items } : {}),
      }),
  };
}

function comparesAttachments(args: unknown): boolean {
  const call = args as
    { readonly first?: unknown; readonly second?: unknown } | undefined;
  return [call?.first, call?.second].every(
    (path) =>
      typeof path === "string" && keptAddress(path)?.kind === "attachment",
  );
}
