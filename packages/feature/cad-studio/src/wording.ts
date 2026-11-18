/**
 * A build's answer in words, from the numbers the harness measured. Sizes are
 * millimetres, said as a machinist reads them.
 */

import { argumentWords } from "./call-rows.js";
import { type Exploded, explodedText } from "./exploded-answer.js";
import { dimensionSaid, writtenListText } from "./parts-list-words.js";
import type { Checked } from "./requirements-answer.js";
import { listed } from "./shown-names.js";
import { helpersFileWords } from "./script-helpers.js";

type Point = readonly [number, number, number];

/** A part's outside edges by kind, as the harness counts them. */
type Edges = {
  readonly sharp: number;
  readonly rounded: number;
  readonly chamfered: number;
};

/** What the harness measured of one part. */
export type MeasuredPart = {
  readonly name: string;
  readonly valid: boolean;
  readonly solids: number;
  readonly size: Point;
  readonly min: Point;
  readonly max: Point;
  /** The material it holds: where its own solids overlap, counted once. */
  readonly volume: number;
  /** How much its own solids share, when they overlap. */
  readonly shared?: number;
  readonly area: number;
  readonly centre: Point | null;
  readonly faces: Readonly<Record<string, number>>;
  /** Its outside edges: how many are sharp, how many rounds and how many chamfers it has. */
  readonly edges?: Edges;
  readonly holes: readonly {
    readonly diameter: number;
    readonly count: number;
  }[];
  /** Where a part that is not valid goes wrong, and whether the kernel's repair mends it. */
  readonly faults?: {
    readonly places: readonly {
      readonly kind: string;
      readonly what: string;
      readonly at: Point;
      readonly size: Point;
    }[];
    readonly fixed: boolean;
  };
  /** The groups of its faces the script named, each with how many faces. */
  readonly surfaces?: Readonly<Record<string, number>>;
};

/** Two parts that share volume, how much, the box it lies in, and how deep one goes into the other. */
export type Overlap = {
  readonly first: string;
  readonly second: string;
  readonly volume: number;
  readonly min?: Point;
  readonly max?: Point;
  readonly depth?: number;
};

/** The deepest an overlap goes and still reads as a press fit, in mm. */
const pressFit = 0.1;

/**
 * What the harness answers: the parts, or why the script failed. Each export
 * says the parts it holds; its file is the one Zhiyin named.
 */
export type BuildAnswer =
  | { readonly failed: string }
  | {
      readonly parts: readonly MeasuredPart[];
      readonly overlaps: readonly Overlap[];
      /** The overlaps at each position a build was checked at, the first its own. */
      readonly positions?: readonly {
        readonly arguments: readonly string[];
        readonly overlaps: readonly Overlap[];
      }[];
      /** What nothing holds: parts of an assembly alone, and pieces of a part, how many of how many. */
      readonly loose?: {
        /** The time for finding them ran out, so none is named. */
        readonly unchecked?: boolean;
        /** When it ran out: the parts not yet found held, each piece and by another part; every other part was. */
        readonly left?: readonly string[];
        readonly parts: readonly string[];
        readonly pieces: readonly {
          readonly part: string;
          readonly loose: number;
          readonly of: number;
          /** Its part is meant to print, so only a piece of it that touches holds another of it. */
          readonly printed?: boolean;
        }[];
      };
      readonly exports: readonly {
        readonly parts: readonly string[];
        /** Why the file could not be written, in words after its name. */
        readonly failed?: string;
        /** A mesh's use, and how far its facets lie from the surface at most, in mm. */
        readonly mesh?: Mesh;
        readonly motion?: Written["motion"];
        /** For a file for printing, each part of several solids it holds, with how many separate objects they print as. */
        readonly objects?: Written["objects"];
        /** For a parts list, its rows and what it could not tell, a line each. */
        readonly bom?: Written["bom"];
      }[];
      /** The whole run, and the longest one position took. */
      readonly seconds: { readonly total: number; readonly position?: number };
      /** The positions the build's time ran out before, each by its arguments. */
      readonly unchecked?: readonly (readonly string[])[];
      /** How the mechanism moves, a line each: how near its moving parts come over a sweep, and how its gears mesh. */
      readonly mechanism?: readonly string[];
      /** What the helpers the script called did, in words. */
      readonly helped?: readonly string[];
      /** Whether the harness drew the views. */
      readonly picture: boolean;
      /** Why the views could not be drawn at all. */
      readonly pictureFailed?: string;
      /** How many sections the picture holds below the views. */
      readonly sections?: number;
      /** Why each section asked for that is not drawn is not. */
      readonly sectionNotes?: readonly string[];
      /** The parts left out of the views drawn, each with why, said after its name. */
      readonly undrawn?: readonly {
        readonly name: string;
        readonly why: string;
      }[];
      /** Whether the harness wrote a mesh of the parts for the person's view. */
      readonly preview: boolean;
      /** What each name written as a pattern named, a line each. */
      readonly patterns?: readonly string[];
      /** The joins and cuts the script made that add or take nothing, and the solids it lost from a builder, each where it is, in words. */
      readonly empty?: readonly string[];
      /** The script's cuts skipped as they would break the part they cut, each where it is and why. */
      readonly skipped?: readonly string[];
      /** What the checks for the way each part is made found past their limits, a line each. */
      readonly making?: readonly string[];
      /** The parts not checked for the way they are made, for want of time. */
      readonly makingUnchecked?: readonly string[];
      /** How the parts were moved apart, for the picture, the preview and the exports marked exploded. */
      readonly exploded?: Exploded;
      /** The requirements checked on the parts, each with what was measured and its margin. */
      readonly requirements?: readonly Checked[];
    };

/** What the harness answers for a drawing it made: the sheet as drawn, every dimension as written on it. */
export type DrawingReport = {
  readonly sheet: string;
  readonly orientation: string;
  readonly scale: string;
  readonly projection: string;
  readonly views: readonly {
    readonly name: string;
    readonly kind: string;
    readonly scale: string;
    /** What it spans of the model, across and up, in mm. */
    readonly size?: readonly [number, number];
    /** Its hidden edges lie so close somewhere that they read as a mass. */
    readonly hiddenCrowded?: boolean;
  }[];
  readonly dimensions: readonly {
    readonly view: string;
    readonly text: string;
    /** Drawn where it meets other lines or text, the sheet having no clear room for it. */
    readonly crowded?: boolean;
    /** Its extension lines run just beside other edges of its view, where they can read as theirs. */
    readonly beside?: boolean;
    /** Its lettering or lines reach past the frame, the sheet having no room for it inside. */
    readonly outside?: boolean;
    /** What was read of it beyond its text, as a hole's depth and thread. */
    readonly said?: string;
    /** Its ends found away from the points given: which, where, and how far, in mm. */
    readonly moved?: readonly {
      readonly end: string;
      readonly at: string;
      readonly away: string;
    }[];
  }[];
  readonly seconds: { readonly total: number };
  /** Whether the harness wrote the sheet's picture. */
  readonly picture: boolean;
  /** Whether the scale was the one asked for, not the largest that fits. */
  readonly scaleAsked?: boolean;
  /** The title block's fields cut short with an ellipsis, too long for their cells however small. */
  readonly titleCut?: readonly string[];
  /** What each name written as a pattern named, a line each. */
  readonly patterns?: readonly string[];
  /** What the drawing left out, and why: views not done in time, parts a section could not cut. */
  readonly notes?: readonly string[];
  /** The script's cuts skipped as they would break the part they cut, each where it is and why. */
  readonly skipped?: readonly string[];
  /** Each output, by its place among those asked: why it was not written, or nothing when it was. */
  readonly outputs: readonly { readonly failed?: string }[];
  /** Views were left out for want of time. */
  readonly leftOut?: boolean;
  /** How the parts were moved apart before they were drawn. */
  readonly exploded?: Exploded;
  /** The parts list on the sheet: its rows, what it could not tell and the items with no balloon, a line each. */
  readonly partsList?: readonly string[];
};

/**
 * A length in millimetres: whole where it is, to a thousandth at most. Halves
 * round away from zero, so a mirrored part reads the same on both sides.
 */
function mm(value: number): string {
  const rounded =
    (Math.sign(value) * Math.round(Math.abs(value) * 1000)) / 1000;
  return `${Object.is(rounded, -0) ? 0 : rounded}`;
}

/** A number with its thousands apart, or to three figures when it is small. */
function grouped(value: number): string {
  if (Math.abs(value) < 10 && value !== 0)
    return `${Number(value.toPrecision(3))}`;
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A volume in mm³ as cm³: to three figures, and whole from a thousand. */
function cubicCentimetres(volume: number): string {
  const value = volume / 1000;
  return value >= 1000 ? grouped(value) : `${Number(value.toPrecision(3))}`;
}

const point = (p: Point) => `(${p.map(mm).join(", ")})`;
/** A size to a tenth of a millimetre, as a view's is checked by eye. */
const tenths = (value: number) => `${Number(value.toFixed(1))}`;

const faceWords: Record<string, string> = {
  plane: "flat",
  cylinder: "cylindrical",
  cone: "conical",
  sphere: "spherical",
  torus: "toroidal",
  freeform: "freeform",
};

const bytes = (count: number) =>
  count < 1024 * 1024
    ? `${Math.max(1, Math.round(count / 1024))} KB`
    : `${(count / 1024 / 1024).toFixed(1)} MB`;

/** What a part is, apart from where: its solids, size, volume, surface, faces, holes and named surfaces. */
function partWords(part: MeasuredPart) {
  const solid = part.valid
    ? part.solids > 1
      ? `${part.solids} separate solids, each valid${part.shared ? `, that share ${grouped(part.shared)} mm³ between them` : ""}`
      : "a valid solid"
    : "not a valid solid: its faces do not close, or cross themselves, so a file of it may not open elsewhere";
  const volume = `Volume ${grouped(part.volume)} mm³${part.volume >= 1000 ? ` (${cubicCentimetres(part.volume)} cm³)` : ""}`;
  const faces = Object.entries(part.faces)
    .sort(([, a], [, b]) => b - a)
    .map(([kind, count]) => `${count} ${faceWords[kind] ?? kind}`);
  const total = Object.values(part.faces).reduce((sum, n) => sum + n, 0);
  const edges = part.edges
    ? ` Outside edges: ${part.edges.sharp} sharp, ${part.edges.rounded} rounded, ${part.edges.chamfered} chamfered.`
    : "";
  const holes = part.holes.length
    ? ` Round holes: ${part.holes.map(({ diameter, count }) => `${count} of ${mm(diameter)} mm`).join(", ")}.`
    : "";
  const surfaces = part.surfaces
    ? ` Surfaces named: ${Object.entries(part.surfaces)
        .map(
          ([group, count]) =>
            `${group} (${count} ${count === 1 ? "face" : "faces"})`,
        )
        .join(", ")}.`
    : "";
  return {
    solid,
    size: `${part.size.map(mm).join(" × ")} mm`,
    volume: `${volume}, surface ${grouped(part.area)} mm²`,
    faces: `${total} faces: ${faces.join(", ")}.${edges}${holes}${surfaces}`,
  };
}

function partLine(part: MeasuredPart): string {
  const words = partWords(part);
  const centre = part.centre ? `, centre of mass at ${point(part.centre)}` : "";
  return `${part.name}: ${words.solid}, ${words.size}, from ${point(part.min)} to ${point(part.max)}. ${words.volume}${centre}. ${words.faces}${faultsText(part)}`;
}

/** Parts alike in all but where they are, in one line, with where each is. */
function alikeLine(parts: readonly MeasuredPart[]): string {
  const words = partWords(parts[0]!);
  const where = parts.every((one) => one.centre)
    ? `Centres of mass at ${listed(parts.map((one) => point(one.centre!)))}.`
    : `From ${listed(parts.map((one) => `${point(one.min)} to ${point(one.max)}`))}.`;
  return `${listed(parts.map((one) => one.name))}, each: ${words.solid}, ${words.size}. ${words.volume}. ${words.faces} ${where}`;
}

const sixFigures = (value: number) => Number(value.toPrecision(6));

/** What parts alike share: all the answer says of a part but its name and where it is. */
const alike = (part: MeasuredPart) =>
  JSON.stringify([
    part.valid,
    part.solids,
    part.shared === undefined ? null : sixFigures(part.shared),
    part.size.map((side) => Math.round(side * 1000)),
    sixFigures(part.volume),
    sixFigures(part.area),
    Object.entries(part.faces).sort(),
    part.edges ?? null,
    part.holes.map((hole) => [Math.round(hole.diameter * 1000), hole.count]),
    part.surfaces ?? null,
  ]);

/**
 * The lines for the parts of a build: each part in full, parts alike in
 * all but where they are in one line, and those as the last build of the
 * same script, `script`, measured them named in one line at the end. A
 * part with a fault is said in full, alone, however often it was built.
 */
function partLines(
  parts: readonly MeasuredPart[],
  unchanged: readonly string[] = [],
  script = "",
): string[] {
  const faulty = (one: MeasuredPart) => !one.valid || Boolean(one.faults);
  const same = new Set(unchanged);
  const kept = parts.filter((one) => same.has(one.name) && !faulty(one));
  const groups = new Map<string, MeasuredPart[]>();
  for (const one of parts) {
    if (kept.includes(one)) continue;
    const key = faulty(one) ? `alone ${one.name}` : alike(one);
    groups.set(key, [...(groups.get(key) ?? []), one]);
  }
  const lines = [...groups.values()].map((group) =>
    group.length === 1 ? partLine(group[0]!) : alikeLine(group),
  );
  if (kept.length)
    lines.push(
      `${listed(kept.map((one) => one.name))} ${kept.length === 1 ? "is" : "are"} as the last build of ${script} measured ${kept.length === 1 ? "it" : "them"}.`,
    );
  return lines;
}

/** Where a part that is not valid goes wrong, so the step that made it can be found. */
function faultsText(part: MeasuredPart): string {
  if (!part.faults) return "";
  const places = part.faults.places.map(
    (one) =>
      `a ${one.kind} at ${point(one.at)}, ${one.size.map(mm).join(" × ")} mm across: ${one.what}`,
  );
  const where = places.length
    ? ` Where it goes wrong: ${places.join("; ")}. The step of the script that made ${places.length === 1 ? "it" : "them"} is the one to change: a cut or a join whose faces only graze, or a feature that meets a face exactly at its edge, is the usual cause; overlap such features clearly, or keep them apart.`
    : "";
  const mend = part.faults.fixed
    ? " The kernel's repair makes it valid: part = part.fix() before showing it; check it is still the shape meant."
    : "";
  return `${where}${mend}`;
}

/** What a mesh was made for, and how far its facets lie from the surface at most, in mm. */
type Mesh = {
  readonly for: "printing" | "viewing" | "close-ups";
  readonly within: number;
  /** For a file for printing: how many triangles it holds, and how many of their edges no other triangle shares. */
  readonly triangles?: number;
  readonly open?: number;
};

/** An export written to the workspace. */
export type Written = {
  readonly relative: string;
  readonly bytes: number;
  readonly parts: readonly string[];
  readonly mesh?: Mesh;
  /** For a motion file: how many parts move, over how many positions, how many stay put, and which change shape, with why. */
  readonly motion?: {
    readonly moving: number;
    readonly still: number;
    readonly positions: number;
    readonly unfitted: Readonly<Record<string, string>>;
    /** An assembly sequence: every part moved apart, then each going in in turn. */
    readonly sequence?: boolean;
  };
  /** Each part of several solids a file for printing holds, with how many separate objects they print as. */
  readonly objects?: Readonly<
    Record<string, { readonly solids: number; readonly objects: number }>
  >;
  /** For a parts list, the harness's lines: its rows and what it could not tell. */
  readonly bom?: readonly string[];
  /** The helpers module, written for a script beside it, holding no part. */
  readonly helpers?: true;
};

/** A written mesh's use and fineness, after its size. */
const meshWords = (mesh?: Mesh) =>
  mesh
    ? `, meshed for ${mesh.for}, no facet more than ${Number(mesh.within.toPrecision(2))} mm from the surface${closedWords(mesh)}`
    : "";

/** A mesh for printing: its triangles, and whether it closes, as a slicer needs. */
const closedWords = (mesh: Mesh) =>
  mesh.triangles === undefined || mesh.open === undefined
    ? ""
    : `, ${grouped(mesh.triangles)} triangles, ${mesh.open ? `${grouped(mesh.open)} ${mesh.open === 1 ? "edge" : "edges"} open, which a slicer may refuse or close wrongly` : "closed"}`;

/** How many separate objects each part of several solids in a file for printing prints as. */
const objectsWords = (file: Written) =>
  Object.entries(file.objects ?? {})
    .map(
      ([name, { solids, objects }]) =>
        ` ${name} is ${solids} solids; they print as ${objects} separate objects.`,
    )
    .join("");

/** A motion file written: what it holds, for blender_animate, and what it left out. */
function motionWords(
  relative: string,
  size: number,
  motion: NonNullable<Written["motion"]>,
): string {
  const unfitted = Object.entries(motion.unfitted);
  if (motion.sequence)
    return `Wrote ${relative} (${bytes(size)}): the assembly sequence, from every part moved apart to all in, one part going in at each of its ${motion.positions - 1} steps, straight along the way it came out; blender_animate's cad_motion keys by it the parts brought in as built. ${motion.still} ${motion.still === 1 ? "part stays" : "parts stay"} put.`;
  return [
    `Wrote ${relative} (${bytes(size)}): where ${motion.moving} ${motion.moving === 1 ? "part is" : "parts are"} at each of ${motion.positions} positions, for blender_animate's cad_motion; ${motion.still} ${motion.still === 1 ? "part stays" : "parts stay"} put.`,
    ...(unfitted.length
      ? [
          `Left out, as no move, turn and stretch takes ${unfitted.length === 1 ? "it" : "them"} from the first position to another: ${unfitted.map(([name, why]) => `${name} (${why})`).join("; ")}.`,
        ]
      : []),
  ].join(" ");
}

/** The script's cuts skipped, each where it is and why, under one heading. */
const skippedLines = (skipped: readonly string[]) =>
  skipped.length
    ? [
        `Cuts skipped, as each would break the part it cuts; change each in the script:\n${skipped.map((one) => `- ${one}`).join("\n")}`,
      ]
    : [];

/** The answer to a build that ran: its parts, the files written, and those that could not be. */
export function builtText(
  answer: Exclude<BuildAnswer, { failed: string }>,
  written: readonly Written[],
  notWritten: readonly string[],
  printed: string,
  drawn: boolean,
  /**
   * What changed since the last build of the same script, the files earlier
   * builds of it wrote whose parts have changed since, and the parts as that
   * build measured them, with the script as the answer names it.
   */
  since: {
    readonly changes?: readonly string[];
    readonly stale?: readonly string[];
    readonly unchanged?: readonly string[];
    readonly script?: string;
  } = {},
): string {
  const helped = [
    ...(answer.helped?.length
      ? [
          `What the helpers did:\n${answer.helped.map((one) => `- ${one}`).join("\n")}`,
        ]
      : []),
    ...skippedLines(answer.skipped ?? []),
  ];
  // A skipped cut changed what the script builds, so the first line says it.
  const skipped = answer.skipped?.length ?? 0;
  const one = skipped === 1;
  if (!answer.parts.length)
    return [
      `The script ran in ${answer.seconds.total.toFixed(1)} s and showed no part, so nothing was measured or drawn.${skipped ? ` ${one ? "1 of the script's cuts was skipped, as it" : `${skipped} of the script's cuts were skipped, as each`} would break the part it cuts.` : ""}`,
      ...helped,
      ...(printed.trim()
        ? [`What the script printed:\n${printed.trim()}`]
        : []),
    ].join("\n");
  const lines = [
    `Built ${answer.parts.length === 1 ? "1 part" : `${answer.parts.length} parts`} in ${answer.seconds.total.toFixed(1)} s${skipped ? `, with ${one ? "1 of the script's cuts skipped, as it" : `${skipped} of the script's cuts skipped, as each`} would break the part it cuts: the parts below are not what the script writes until ${one ? "that cut changes" : "those cuts change"}` : ""}.`,
    ...partLines(answer.parts, since.unchanged, since.script),
    ...(since.changes ?? []),
    ...(answer.empty ?? []),
    ...helped,
  ];
  if (answer.exploded) lines.push(...explodedText(answer.exploded));
  if (answer.parts.length > 1 && answer.positions)
    lines.push(positionsText(answer.positions));
  else if (answer.parts.length > 1)
    lines.push(
      answer.overlaps.length
        ? overlapsText(answer.overlaps)
        : "No two parts overlap.",
    );
  // Said whatever the parts: a sweep of a one-part build says what it lacks.
  lines.push(...(answer.mechanism ?? []));
  const floating = [
    ...(answer.loose?.parts ?? []),
    ...(answer.loose?.pieces ?? []).map(
      (one) => `${one.loose} of the ${one.of} pieces of ${one.part}`,
    ),
  ];
  if (floating.length)
    lines.push(
      `Held by nothing: ${listed(floating)}. Each piece of an assembly sits on, in or against another, or turns or slides in it with a clearance of a millimetre or less; one further than that from everything floats where it was put.${answer.loose?.pieces.some((one) => one.printed) ? " A piece of a part meant to print is held by another piece of it only where they touch." : ""}`,
    );
  lines.push(...(answer.making ?? []));
  if (answer.makingUnchecked?.length)
    lines.push(
      `Not checked in full for the way ${answer.makingUnchecked.length === 1 ? "it is" : "they are"} made, for want of time: ${listed(answer.makingUnchecked)}. Build ${answer.makingUnchecked.length === 1 ? "it" : "them"} alone, or with more minutes, to check.`,
    );
  if (answer.loose?.unchecked)
    lines.push(
      answer.loose.left?.length
        ? `Whether every piece of ${listed(answer.loose.left)} is held by another was not found, for want of time: so many curved pieces lie near others that measuring them all would take most of the build. Every other part is held. Check those parts alone, or fewer at once, to find what floats.`
        : "Whether each piece is held by another was not found, for want of time: so many curved pieces lie near others that measuring them all would take most of the build. Check a part alone, or fewer at once, to find what floats.",
    );
  if (answer.unchecked?.length)
    lines.push(
      `Not checked, for want of time${answer.seconds.position ? `, each position taking about ${Number(answer.seconds.position.toPrecision(2))} s` : ""}: at ${listed(answer.unchecked.map((one) => (one.length ? argumentWords(one) : "no arguments")))}. Check them in another call.`,
    );
  for (const file of written)
    lines.push(
      file.bom
        ? writtenListText(file.relative, bytes(file.bytes), file.bom)
        : file.motion
          ? motionWords(file.relative, file.bytes, file.motion)
          : file.helpers
            ? `Wrote ${file.relative} (${bytes(file.bytes)}): ${helpersFileWords}.`
            : `Wrote ${file.relative} (${bytes(file.bytes)})${meshWords(file.mesh)}: ${listed(file.parts)}.${objectsWords(file)}`,
    );
  lines.push(...(since.stale ?? []));
  lines.push(...notWritten);
  if (printed.trim()) lines.push(`What the script printed:\n${printed.trim()}`);
  lines.push(...(answer.sectionNotes ?? []));
  if (!drawn)
    lines.push(
      answer.pictureFailed
        ? `The views could not be drawn this time: ${answer.pictureFailed.replace(/\.$/, "")}. The measurements above stand.`
        : "The views could not be drawn this time; the measurements above stand.",
    );
  else {
    lines.push(
      "Below, the parts seen from -Y (the front), from +Z (the top), from +X (the right) and at an angle, each part named where it shows and there is room; edges behind are dashed.",
    );
    if (answer.sections)
      lines.push(
        `Below them, ${answer.sections === 1 ? "the section" : `the ${answer.sections} sections`} asked for, numbered in order: each part's cut faces filled in its colour and hatched, the edges beyond the cut drawn.`,
      );
    if (answer.undrawn?.length)
      lines.push(
        `Not in the views: ${answer.undrawn.map(({ name, why }) => `${name}, which ${why.replace(/\.$/, "")}`).join("; ")}.`,
      );
  }
  return lines.join("\n");
}

const viewWords: Record<string, string> = {
  named: "view",
  section: "section",
  detail: "detail",
  auxiliary: "auxiliary view",
};

function overlapsText(overlaps: readonly Overlap[]): string {
  const fits = overlaps.filter(
    (one) => one.depth !== undefined && one.depth <= pressFit,
  );
  if (fits.length < 2) return overlapText(overlaps);
  const deepest = Math.max(...fits.map((one) => one.depth!));
  return [
    ...(fits.length < overlaps.length
      ? [overlapText(overlaps.filter((one) => !fits.includes(one)))]
      : []),
    `${listed(fits.map((one) => `${one.first} and ${one.second} (${grouped(one.volume)} mm³)`))} overlap by as little as a press fit, at most ${mm(deepest)} mm thick, which is meant only where one part is pressed into the other.`,
  ].join(" ");
}

function overlapText(overlaps: readonly Overlap[]): string {
  return overlaps
    .map((overlap) => {
      const deep =
        overlap.depth === undefined
          ? ""
          : `, what they share ${mm(overlap.depth)} mm thick`;
      const meaning =
        overlap.depth === undefined
          ? "parts that should only touch share that volume"
          : overlap.depth <= pressFit
            ? "as little as a press fit, which is meant only where one part is pressed into the other"
            : "far deeper than a press fit, which goes in by hundredths of a millimetre, so one part runs into the other";
      return `${overlap.first} and ${overlap.second} overlap by ${grouped(overlap.volume)} mm³${deep}${overlap.min && overlap.max ? `, from ${point(overlap.min)} to ${point(overlap.max)}` : ""}: ${meaning}.`;
    })
    .join(" ");
}

/** The overlaps at each position a build was checked at, by its arguments. */
function positionsText(
  positions: NonNullable<Extract<BuildAnswer, { parts: unknown }>["positions"]>,
): string {
  const at = (one: (typeof positions)[number]) =>
    one.arguments.length ? argumentWords(one.arguments) : "no arguments";
  const clashing = positions.filter((one) => one.overlaps.length);
  const clear = positions.filter((one) => !one.overlaps.length);
  const checked = `Checked for overlaps at ${positions.length} ${positions.length === 1 ? "position" : "positions"}`;
  if (!clashing.length) return `${checked}: no two parts overlap at any.`;
  return [
    `${checked}.`,
    ...clashing.map((one) => `At ${at(one)}: ${overlapsText(one.overlaps)}`),
    ...(clear.length
      ? [`No two parts overlap at ${listed(clear.map(at))}.`]
      : []),
  ].join(" ");
}

/** The answer to a drawing that was made: the sheet, its views and dimensions, and the files written. */
export function drawnText(
  report: DrawingReport,
  written: readonly Written[],
  notWritten: readonly string[],
  printed: string,
  drawn: boolean,
  /** What to do for want of time, when views were left out for it. */
  moreTime?: string,
): string {
  const named = (view: DrawingReport["views"][number]) =>
    view.kind === "named"
      ? `${view.name} view`
      : `${viewWords[view.kind] ?? view.kind} ${view.name}`;
  const views = report.views.map(
    (view) =>
      `${named(view)}${view.scale === report.scale ? "" : ` at ${view.scale}`}`,
  );
  const skipped = report.skipped ?? [];
  const one = skipped.length === 1;
  const lines = [
    `Drew ${report.sheet} ${report.orientation} at ${report.scale}, ${report.projection}-angle projection, in ${report.seconds.total.toFixed(1)} s: ${listed(views)}.${skipped.length ? ` ${one ? "1 of the script's cuts was skipped, as it" : `${skipped.length} of the script's cuts were skipped, as each`} would break the part it cuts: the parts drawn are not what the script writes until ${one ? "that cut changes" : "those cuts change"}.` : ""}`,
    ...skippedLines(skipped),
  ];
  if (report.exploded) lines.push(...explodedText(report.exploded));
  const sized = report.views.filter((view) => view.size);
  if (sized.length)
    lines.push(
      `Each view's size on the model, across by up: ${sized.map((view) => `${named(view)} ${tenths(view.size![0])} × ${tenths(view.size![1])} mm`).join(", ")}.`,
    );
  for (const view of report.views.filter((one) => one.hiddenCrowded))
    lines.push(
      `Hidden edges crowd the ${named(view)} so closely that they read as a mass: give it hidden: false to leave them out.`,
    );
  const byView = new Map<string, string[]>();
  for (const one of report.dimensions)
    byView.set(one.view, [...(byView.get(one.view) ?? []), one.text]);
  lines.push(
    byView.size
      ? [...byView]
          .map(([view, texts]) => `Dimensions on ${view}: ${texts.join(", ")}.`)
          .join("\n")
      : "No dimensions asked for.",
  );
  const moved = report.dimensions.flatMap((one) =>
    (one.moved ?? []).map(
      (end) =>
        `${one.text} on ${one.view}, its ${end.end} at ${end.at}, ${end.away} mm from the point given`,
    ),
  );
  lines.push(...dimensionSaid(report.dimensions));
  if (moved.length)
    lines.push(
      `Measured from the nearest corner, end or centre, away from the point given: ${moved.join("; ")}.`,
    );
  const outside = report.dimensions.filter((one) => one.outside);
  if (outside.length)
    lines.push(
      `Drawn past the frame, the sheet having no room for ${outside.length === 1 ? "it" : "them"} inside: ${outside.map((one) => `${one.text} on ${one.view}`).join(", ")}. ${report.scaleAsked ? "A smaller scale or a larger sheet gives them room." : "A larger sheet, or fewer dimensions on a view, gives them room."}`,
    );
  const crowded = report.dimensions.filter(
    (one) => one.crowded && !one.outside,
  );
  if (crowded.length)
    lines.push(
      `Drawn where it meets other lines or text, for want of room: ${crowded.map((one) => `${one.text} on ${one.view}`).join(", ")}. ${report.scaleAsked ? "A smaller scale or a larger sheet gives them room." : "A larger sheet, or fewer dimensions on a view, gives them room."}`,
    );
  const beside = report.dimensions.filter((one) => one.beside);
  if (beside.length)
    lines.push(
      `Its extension lines run just beside other edges, where they can read as those edges: ${beside.map((one) => `${one.text} on ${one.view}`).join(", ")}. Measure it where the lines run clear: in another view, between other points, or on a drawing of the part alone.`,
    );
  if (report.titleCut?.length)
    lines.push(
      `Cut short to fit the title block, with an ellipsis: ${report.titleCut.join(", ")}. Shorter text is written whole.`,
    );
  lines.push(...(report.partsList ?? []));
  lines.push(...(report.notes ?? []));
  if (moreTime) lines.push(moreTime);
  for (const file of written)
    lines.push(`Wrote ${file.relative} (${bytes(file.bytes)}).`);
  if (written[0])
    lines.push(
      `The request is kept: cad_draw with again "${written[0].relative}" draws this drawing again, changed only where other inputs are given.`,
    );
  lines.push(...notWritten);
  if (printed.trim()) lines.push(`What the script printed:\n${printed.trim()}`);
  lines.push(
    drawn
      ? "Below, the sheet as drawn."
      : "The sheet's picture could not be read this time; the files above stand.",
  );
  return lines.join("\n");
}
