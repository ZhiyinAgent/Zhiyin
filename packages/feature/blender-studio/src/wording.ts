/**
 * Each call as a person reads it, in approvals and in an action's details: a
 * few named rows in plain words, with sizes in millimetres or metres, rather
 * than the tool's own inputs and their schema.
 */

import { newShapeStep, shapeStepExtras } from "./shape-wording.js";
import { statedNumbers } from "./stated-numbers.js";
import {
  aimWords,
  boneKeyWords,
  driveRows,
  keyedName,
  poseRows,
} from "./motion-rig-rows.js";
import {
  extendRows,
  lightShapingRows,
  linkingWords,
  pictureLookRows,
  renderLookRows,
  samplingRows,
} from "./look-rows.js";

import {
  isNumber,
  length,
  list,
  names,
  numbers,
  pixels,
  point,
  record,
  row,
  size,
  text,
  trimmed,
  type Args,
  type Row,
} from "./approval-words.js";

export type { Row } from "./approval-words.js";

const restingOn = (value: unknown, tilted?: unknown) => {
  const on = Array.isArray(value) ? names(value) : text(value);
  if (!on) return undefined;
  const where =
    on === "floor" ? "the floor" : on === "below" ? "whatever is below it" : on;
  return `set down on ${where}${tilted ? ", tilted to follow its surface" : ""}`;
};

/** A turn round a point or an object, as a person reads it. */
const turnAbout = (value: unknown) => {
  const turn = record(value);
  if (!isNumber(turn["angle"])) return undefined;
  const axis =
    text(turn["axis"]) ??
    (numbers(turn["axis"]) ? `[${list(turn["axis"]).join(", ")}]` : "z");
  const through = text(turn["object"]) ?? point(turn["point"]) ?? "?";
  return `turn ${turn["angle"]}° round ${axis} through ${through}`;
};

/** A push against another object's side, or a point laid on another's, as a person reads it. */
const movedAgainst = (against: unknown, to: unknown) => {
  const side = record(against);
  if (text(side["object"]))
    return `push against ${text(side["object"])}'s ${text(side["side"]) ?? "?"} side${isNumber(side["gap"]) && side["gap"] > 0 ? `, ${length(side["gap"])} apart` : ""}`;
  const onto = record(to);
  if (text(onto["object"]))
    return `move its ${text(onto["by"]) ?? "bottom-centre"} onto ${text(onto["object"])}'s ${text(onto["point"]) ?? "?"}`;
  return undefined;
};

/** Where a set of objects is set out, as a person reads it. */
function setOut(value: unknown): string | undefined {
  const spread = record(value);
  const along = record(spread["along"]);
  const line = list(along["line"]);
  const circle = record(along["circle"]);
  const path = along["line"]
    ? `a line from ${point(line[0]) ?? "?"} to ${point(line[1]) ?? "?"}`
    : along["circle"]
      ? `a circle ${isNumber(circle["radius"]) ? length(circle["radius"] * 2) : "?"} across round ${point(circle["centre"]) ?? "(0, 0, 0 mm)"}`
      : text(along["curve"])
        ? `the curve ${text(along["curve"])}`
        : along["points"]
          ? `${list(along["points"]).length} points`
          : "?";
  const count = isNumber(spread["count"]) ? `${spread["count"]} ` : "";
  const others = names(spread["with"]);
  return `set out ${count}along ${path}${others ? ` with ${others}` : ""}${spread["linked"] ? ", sharing one mesh" : ""}`;
}

export function openRows(file: string, exists: boolean): Row[] {
  return [
    { name: "Scene file", value: exists ? file : `${file}, new and empty` },
  ];
}

export function describeRows(args: Args): Row[] {
  return [{ name: "Objects", value: names(args["objects"]) || "All" }];
}

export function addRows(args: Args): Row[] {
  return list(args["objects"]).map((item) => {
    const spec = record(item);
    const kind = text(spec["kind"]) ?? "object";
    const parts: (string | undefined)[] = [kind, size(spec["size"])];
    if (kind === "text" && text(spec["text"]))
      parts.push(`“${text(spec["text"])}”`);
    if (kind === "text" && isNumber(spec["wrap_radius"]))
      parts.push(`bent round a ${length(spec["wrap_radius"])} radius`);
    if (kind === "torus" && isNumber(spec["diameter"]))
      parts.push(`${length(spec["diameter"])} across`);
    if (kind === "outline" && isNumber(spec["height"]))
      parts.push(
        `${list(spec["points"]).length} corners, ${length(spec["height"])} high${list(spec["holes"]).length ? `, ${list(spec["holes"]).length} hole(s)` : ""}`,
      );
    if (kind === "tube" && list(spec["section"]).length)
      parts.push(
        `a ${list(spec["section"]).length}-cornered section along ${list(spec["points"]).length} points`,
      );
    if (kind === "tube" && numbers(spec["taper"]))
      parts.push(
        `tapering from ${list(spec["taper"]).join(" to ")} of its width`,
      );
    if (kind === "tube" && spec["caps"] === false) parts.push("ends open");
    for (const [key, said] of [
      ["segments", "segments"],
      ["rings", "rings"],
      ["rows", "rows"],
      ["subdivisions", "subdivisions"],
    ] as const)
      if (kind !== "tube" && isNumber(spec[key]))
        parts.push(`${spec[key]} ${said}`);
    if (text(spec["fill"])) parts.push(`filled: ${text(spec["fill"])}`);
    if (kind === "tube" && isNumber(spec["radius"]))
      parts.push(
        `${length(spec["radius"] * 2)} thick through ${list(spec["points"]).length} points${spec["corners"] === "sharp" ? " with sharp corners" : ""}`,
      );
    if (kind === "revolve")
      parts.push(`turned from ${list(spec["profile"]).length} profile points`);
    if (text(spec["path"])) parts.push(`from ${text(spec["path"])}`);
    if (kind === "instance") parts.push(`of ${text(spec["of"]) ?? "?"}`);
    if (spec["flying"] === true) parts.push("flying");
    const at = point(spec["location"]);
    if (at) parts.push(`at ${at}`);
    parts.push(
      restingOn(
        spec["rest_on"] ?? spec["rest_across"],
        spec["align_to_surface"],
      ),
    );
    if (text(spec["parent"])) parts.push(`moves with ${text(spec["parent"])}`);
    const bevel = record(spec["bevel"]);
    if (isNumber(bevel["width"]))
      parts.push(`edges rounded by ${length(bevel["width"])}`);
    if (spec["smooth"]) parts.push("smooth shading");
    return {
      name: text(spec["name"]) ?? "Unnamed",
      value: parts.filter(Boolean).join(", "),
    };
  });
}

export function editRows(args: Args): Row[] {
  return list(args["edits"]).map((item) => {
    const edit = record(item);
    const name = text(edit["object"]) ?? "Unnamed";
    if (edit["delete"]) return { name, value: "delete" };
    const changes: (string | undefined)[] = [];
    if (text(edit["shapes_from"]))
      changes.push(`new shapes from ${text(edit["shapes_from"])}`);
    if (edit["location"]) changes.push(`move to ${point(edit["location"])}`);
    if (edit["move_by"]) changes.push(`move by ${point(edit["move_by"])}`);
    if (numbers(edit["rotation"]))
      changes.push(`turn to (${list(edit["rotation"]).join("°, ")}°)`);
    if (edit["size"]) changes.push(`resize to ${size(edit["size"])}`);
    if (numbers(edit["scale"]))
      changes.push(
        `scale to (${list(edit["scale"]).join(", ")}) of its built size`,
      );
    if (text(edit["rename"])) changes.push(`rename to ${text(edit["rename"])}`);
    if (text(edit["parent"])) changes.push(`move with ${text(edit["parent"])}`);
    if (edit["detach"]) changes.push("stop moving with its parent");
    if (typeof edit["hidden"] === "boolean")
      changes.push(edit["hidden"] ? "hide" : "show");
    changes.push(turnAbout(edit["turn_about"]));
    changes.push(
      restingOn(
        edit["rest_on"] ?? edit["rest_across"],
        edit["align_to_surface"],
      ),
    );
    changes.push(movedAgainst(edit["against"], edit["to"]));
    if (typeof edit["flying"] === "boolean")
      changes.push(edit["flying"] ? "mark as flying" : "no longer flying");
    if (edit["duplicate"]) {
      const copies = record(edit["duplicate"]);
      const around = record(copies["around"]);
      const times = `copy ${isNumber(copies["count"]) ? copies["count"] : 1} time(s)`;
      const placing = copies["around"]
        ? `round ${text(around["axis"]) ?? "z"} through ${text(around["object"]) ?? point(around["point"]) ?? "?"}`
        : `${point(copies["offset"]) ?? "?"} apart`;
      changes.push(
        `${times}, ${placing}${copies["linked"] ? ", sharing one mesh" : ""}`,
      );
    }
    if (edit["distribute"]) changes.push(setOut(edit["distribute"]));
    return { name, value: changes.filter(Boolean).join(", ") || "no change" };
  });
}

function shapeStep(step: Args): string {
  switch (step["kind"]) {
    case "boolean": {
      const operation = text(step["operation"]) ?? "difference";
      const cutter = record(step["cutter"]);
      const at = point(cutter["location"]);
      if (step["cutter"]) {
        const shape = text(cutter["shape"]) ?? "cylinder";
        const hole =
          shape === "cylinder" &&
          isNumber(cutter["diameter"]) &&
          isNumber(cutter["depth"])
            ? `a ${length(cutter["diameter"])} round hole, ${length(cutter["depth"])} deep`
            : shape === "text"
              ? `the letters “${text(cutter["text"]) ?? "?"}”${isNumber(cutter["depth"]) ? `, ${length(cutter["depth"])} deep` : ""}`
              : shape === "outline"
                ? `an outline of ${list(cutter["points"]).length} points${isNumber(cutter["depth"]) ? `, ${length(cutter["depth"])} deep` : ""}`
                : `a ${shape.replaceAll("_", " ")} ${size(cutter["size"]) ?? ""}`.trim();
        return `${operation === "difference" ? "Cut" : operation === "union" ? "Add" : "Keep only the overlap with"} ${hole}${at ? ` at ${at}` : ""}`;
      }
      return `${operation === "difference" ? "Cut away" : operation === "union" ? "Join with" : "Keep only the overlap with"} ${text(step["with"]) ?? (text(step["collection"]) ? `every object of ${text(step["collection"])}` : "?")}`;
    }
    case "bevel":
      return `Round the edges by ${isNumber(step["width"]) ? length(step["width"]) : "?"}${isNumber(step["segments"]) ? `, ${step["segments"]} segments` : ""}`;
    case "array": {
      const apart =
        point(step["offset"]) ??
        (numbers(step["relative"])
          ? `(${list(step["relative"]).join(", ")}) of its size`
          : undefined);
      const times = isNumber(step["count"])
        ? `${step["count"]} times`
        : "to fit";
      return `Repeat ${times}${apart ? `, ${apart} apart` : ""}${text(step["offset_object"]) ? `, as ${text(step["offset_object"])} is from it` : ""}`;
    }
    case "mirror":
      return `Mirror across ${list(step["axes"]).join(", ") || "x"}${text(step["across"]) ? ` around ${text(step["across"])}` : ""}`;
    case "solidify":
      return `Give it walls ${isNumber(step["thickness"]) ? length(step["thickness"]) : "?"} thick`;
    case "subdivision":
      return `Subdivide ${isNumber(step["levels"]) ? step["levels"] : 2} times`;
    case "smooth":
      return "Smooth its shading";
    case "remove":
      return `Remove the step ${text(step["modifier"]) ?? "?"}`;
    default:
      return newShapeStep(step);
  }
}

export function shapeRows(args: Args): Row[] {
  const steps = list(args["operations"]).map((item) => {
    const step = record(item);
    return `${shapeStep(step)}${shapeStepExtras(step)}`;
  });
  if (args["apply"]) steps.push("Bake every step into the mesh");
  return [{ name: text(args["object"]) ?? "Unnamed", value: steps.join("\n") }];
}

/** A lens shift as [across, up], each a share of the picture's longer side. */
function shift(value: unknown): string | undefined {
  const found = numbers(value);
  if (found?.length !== 2) return undefined;
  const [across, up] = found as [number, number];
  return across === 0 && up === 0
    ? "none"
    : `${trimmed(across)} across, ${trimmed(up)} up`;
}

export function cameraRows(args: Args): Row[] {
  const frame = record(args["frame"]);
  const dof = record(args["depth_of_field"]);
  const margin = isNumber(frame["margin"]) ? frame["margin"] : 0.1;
  return [
    ...row(
      "Framing",
      args["frame"]
        ? `${names(frame["objects"]) || "everything"} from the ${text(frame["direction"]) ?? "three-quarter"}${isNumber(frame["around"]) ? `, ${frame["around"]}° round` : ""}${isNumber(frame["elevation"]) ? `, ${frame["elevation"]}° above level` : ""}, ${Math.round(margin * 100)}% margin`
        : undefined,
    ),
    ...row(
      "Projection",
      typeof args["orthographic"] === "boolean"
        ? args["orthographic"]
          ? "orthographic: no perspective"
          : "perspective"
        : undefined,
    ),
    ...row("Position", point(args["location"])),
    ...row(
      "Aim at",
      point(args["look_at"]) ??
        (text(args["look_at_object"])
          ? `the middle of ${text(args["look_at_object"])}`
          : undefined),
    ),
    ...row("Lens", isNumber(args["lens"]) ? `${args["lens"]} mm` : undefined),
    ...row("Lens shift", shift(args["shift"])),
    ...row(
      "Background blur",
      args["depth_of_field"]
        ? dof["off"]
          ? "off"
          : `f/${isNumber(dof["aperture"]) ? dof["aperture"] : 2.8}, focused ${text(dof["focus_object"]) ? `on ${text(dof["focus_object"])}` : isNumber(dof["focus_distance"]) ? `${length(dof["focus_distance"])} away` : "?"}`
        : undefined,
    ),
    ...row("Picture size", pixels(args["resolution"])),
    ...row("Exposure", stops(args["exposure"])),
    ...row(
      "Tone",
      text(args["tone"])
        ? `${text(args["tone"])}${tones[text(args["tone"]) ?? ""] ?? ""}`
        : undefined,
    ),
    ...pictureLookRows(args),
  ];
}

const tones: Record<string, string> = {
  agx: ": bright light kept from clipping",
  neutral: ": colours as given",
  standard: ": colours as given, clipped above white",
};

function stops(value: unknown): string | undefined {
  if (!isNumber(value)) return undefined;
  if (value === 0) return "unchanged";
  const amount = `${Math.abs(value)} stop${Math.abs(value) === 1 ? "" : "s"}`;
  return `${amount} ${value > 0 ? "brighter" : "darker"}`;
}

export function lightingRows(args: Args): Row[] {
  const presets: Record<string, string> = {
    studio: "Studio lights (key, fill and rim) in a photographed studio",
    product: "Studio lights in a seamless white backdrop",
    daylight: "Daylight from the sky and the sun",
    none: "Remove the preset lights",
  };
  const preset = text(args["preset"]);
  const background = record(args["background"]);
  const sky = record(background["sky"]);
  const surroundings =
    text(background["hdri"]) ??
    (text(background["environment"])
      ? `Blender's own ${text(background["environment"])}`
      : undefined);
  return [
    ...row("Earlier lights", args["replace"] ? "removed" : undefined),
    ...row("Preset", preset ? (presets[preset] ?? preset) : undefined),
    ...row(
      "Surroundings",
      surroundings
        ? `${surroundings}${isNumber(background["rotation"]) ? `, turned ${background["rotation"]}°` : ""}${text(background["color"]) ? `, seen behind the scene as plain ${text(background["color"])}` : ""}`
        : background["sky"]
          ? `a sky with the sun ${isNumber(sky["sun_elevation"]) ? `${sky["sun_elevation"]}° high` : "up"}`
          : text(background["color"]),
    ),
    ...list(args["lights"]).map((item) => {
      const light = record(item);
      const kind = text(light["kind"]) ?? "area";
      const aim =
        point(light["look_at"]) ??
        (text(light["look_at_object"])
          ? `the middle of ${text(light["look_at_object"])}`
          : undefined);
      return {
        name:
          text(light["name"]) ??
          `${kind[0]!.toUpperCase()}${kind.slice(1)} light`,
        value: [
          kind,
          isNumber(light["power"]) ? `${light["power"]} W` : undefined,
          isNumber(light["strength"])
            ? `strength ${light["strength"]}`
            : undefined,
          point(light["location"])
            ? `at ${point(light["location"])}`
            : undefined,
          aim ? `aimed at ${aim}` : undefined,
          text(light["color"]),
          isNumber(light["kelvin"])
            ? light["kelvin"] === 0
              ? "no colour temperature"
              : `${light["kelvin"]} K`
            : undefined,
          isNumber(light["exposure"])
            ? `exposure ${light["exposure"]}`
            : undefined,
          text(light["shape"]),
          numbers(light["size"])
            ? `${numbers(light["size"])!.join(" × ")} m`
            : undefined,
          isNumber(light["angle"])
            ? `${light["angle"]}° across the sky`
            : undefined,
          ...linkingWords(light),
        ]
          .filter(Boolean)
          .join(", "),
      };
    }),
    ...row(
      "Backdrop in reflections",
      isNumber(args["backdrop_reflections"])
        ? `${Math.round(args["backdrop_reflections"] * 100)}% as bright`
        : undefined,
    ),
    ...lightShapingRows(args),
  ];
}

export function renderRows(args: Args, output: string): Row[] {
  const plan = text(args["view"]) === "plan";
  // A plan is drawn with EEVEE; one that names another engine is refused
  // before it is described.
  const eevee = plan || text(args["engine"]) === "eevee";
  return [
    ...row("View", plan ? "the plan from above" : undefined),
    ...row(
      "Cut at",
      plan && isNumber(args["cut"]) ? `${args["cut"]} m` : undefined,
    ),
    { name: "Engine", value: eevee ? "EEVEE" : "Cycles" },
    {
      name: "Size",
      value: pixels(args["resolution"]) ?? "the scene's picture size",
    },
    {
      name: "Samples",
      value: isNumber(args["samples"])
        ? `${args["samples"]}`
        : `${eevee ? statedNumbers.render.eevee_samples : statedNumbers.render.cycles_samples}, the default`,
    },
    ...row(
      "Background",
      args["background"] === "white"
        ? "exact white, with the product's shadow"
        : args["background"] === "transparent"
          ? "transparent"
          : undefined,
    ),
    ...row("Camera", text(args["camera"])),
    ...row(
      "At",
      isNumber(args["time"])
        ? `${trimmed(args["time"])} s into the animation`
        : undefined,
    ),
    ...row("Left out", names(args["without"]) || undefined),
    ...row("Only", names(args["only"]) || undefined),
    ...row("Framed", framedWords(args["frame"])),
    ...samplingRows(args),
    ...renderLookRows(args),
    { name: "Saved as", value: output },
  ];
}

/** What a picture framed for itself fits, and from which side. */
function framedWords(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const frame = record(value);
  const on = names(frame["objects"]) || "what it shows";
  return `${on}, from the ${text(frame["direction"]) ?? "three-quarter"}`;
}

export function exportRows(args: Args, output: string): Row[] {
  return [
    {
      name: "Objects",
      value: names(args["objects"]) || "Every visible object",
    },
    {
      name: "Saved as",
      value: `${output}${output.toLowerCase().endsWith(".stl") ? ", in millimetres" : ""}`,
    },
    ...(args["bake"] === true
      ? [
          {
            name: "Bake",
            value: `Looks the file cannot hold, into ${isNumber(args["bake_size"]) ? trimmed(args["bake_size"]) : "1024"} px pictures it carries`,
          },
        ]
      : []),
  ];
}

const seconds = (value: unknown) =>
  isNumber(value) ? `${trimmed(value)} s` : undefined;

const easingWords: Readonly<Record<string, string>> = {
  linear: "at an even speed",
  ease_in: "eased in",
  ease_out: "eased out",
  ease_in_out: "eased in and out",
  constant: "jumping there",
  bounce: "with a bounce",
  elastic: "with a spring",
  overshoot: "overshooting",
};

const degrees = (value: unknown) => {
  const found = numbers(value);
  return found ? `turned (${found.map(trimmed).join("°, ")}°)` : undefined;
};

/** What one key sets, in words. */
function keyWords(spec: Args): string {
  const property = record(spec["property"]);
  const parts = [
    point(spec["location"]) && `at ${point(spec["location"])}`,
    degrees(spec["rotation"]),
    size(spec["size"]),
    numbers(spec["scale"]) &&
      `scaled (${numbers(spec["scale"])!.map(trimmed).join(", ")})`,
    spec["hidden"] === true
      ? "hidden"
      : spec["hidden"] === false
        ? "shown"
        : undefined,
    isNumber(spec["lens"]) ? `lens ${trimmed(spec["lens"])} mm` : undefined,
    isNumber(spec["power"]) ? `power ${trimmed(spec["power"])}` : undefined,
    text(spec["color"]) && `colour ${text(spec["color"])}`,
    isNumber(spec["glow"]) ? `glow ${trimmed(spec["glow"])}` : undefined,
    text(property["path"]) &&
      `${text(property["path"])} ${(numbers(property["values"]) ?? []).map(trimmed).join(", ")}`,
    ...boneKeyWords(spec),
    easingWords[text(spec["easing"]) ?? ""],
  ];
  return parts.filter(Boolean).join(", ");
}

export function animateRows(args: Args): Row[] {
  const timeline = [
    isNumber(args["duration"]) ? `${trimmed(args["duration"])} s long` : "",
    isNumber(args["fps"]) ? `${args["fps"]} frames a second` : "",
    args["loop"] === true
      ? "ending a frame before its last key, as a loop"
      : "",
  ].filter(Boolean);
  return [
    ...row("Timeline", timeline.join(", ") || undefined),
    ...row("Cleared", names(args["clear"]) || undefined),
    ...poseRows(args),
    ...list(args["keys"]).map((item) => {
      const spec = record(item);
      return {
        name: `${keyedName(spec)} at ${seconds(spec["at"]) ?? "?"}`,
        value: keyWords(spec) || "nothing",
      };
    }),
    ...list(args["paths"]).map((item) => {
      const spec = record(item);
      const parts = [
        text(spec["curve"])
          ? `along the curve ${text(spec["curve"])}`
          : `along a path through ${list(spec["points"]).length} points`,
        `from ${seconds(spec["from"]) ?? "?"} to ${seconds(spec["to"]) ?? "?"}`,
        spec["closed"] === true ? "back to the first" : "",
        text(spec["facing"])
          ? `facing along its ${text(spec["facing"])} axis`
          : "",
        isNumber(spec["bank"]) && spec["bank"] !== 0
          ? `leaning up to ${trimmed(spec["bank"])}° into its turns`
          : "",
        names(spec["train"])
          ? `followed by ${names(spec["train"])}, ${isNumber(spec["spacing"]) ? trimmed(spec["spacing"]) : "?"} m apart`
          : "",
        easingWords[text(spec["easing"]) ?? ""] ?? "",
      ];
      return {
        name: text(spec["object"]) ?? "?",
        value: parts.filter(Boolean).join(", "),
      };
    }),
    ...list(args["aim"]).map((item) => {
      const spec = record(item);
      return {
        name: `${text(spec["object"]) ?? "?"} aims at`,
        value: aimWords(spec),
      };
    }),
    ...list(args["follow"]).map((item) => {
      const spec = record(item);
      return {
        name: `${text(spec["object"]) ?? "?"}'s ${valueWords(spec)}`,
        value: followWords(spec),
      };
    }),
    ...driveRows(args),
    ...list(args["belts"]).map((item) => {
      const spec = record(item);
      const follows = record(spec["follows"]);
      return {
        name: `${text(spec["object"]) ?? "?"} runs`,
        value: [
          `round ${list(spec["pulleys"]).length} pulleys`,
          isNumber(spec["speed"])
            ? `at ${trimmed(spec["speed"])} m/s`
            : `with ${text(follows["object"]) ?? "?"}'s turn`,
        ].join(", "),
      };
    }),
    ...cadMotionRows(record(args["cad_motion"]), args["cad_motion"]),
    ...extendRows(args),
  ];
}

/** The CAD motion an animation keys parts from: its file, its times, and whether it cycles. */
function cadMotionRows(motion: Args, given: unknown): Row[] {
  if (given === undefined) return [];
  return [
    {
      name: "CAD motion",
      value: [
        text(motion["file"]) ?? "?",
        `from ${seconds(motion["from"]) ?? "0 s"} to ${seconds(motion["to"]) ?? "?"}`,
        motion["cycle"] === true ? "as a cycle" : "",
      ]
        .filter(Boolean)
        .join(", "),
    },
  ];
}

/** One of an object's own values, as a follow names it: "turn around x". */
function valueWords(spec: Args): string {
  const value = text(spec["value"]) ?? "?";
  return `${value} ${value === "turn" ? "around" : "along"} ${text(spec["axis"]) ?? "?"}`;
}

/** What a part follows, and how: "follows Crank's turn around x, times 3". */
function followWords(spec: Args): string {
  const from = record(spec["from"]);
  const how = text(spec["formula"])
    ? `, by ${text(spec["formula"])}`
    : [
        isNumber(spec["ratio"]) && spec["ratio"] !== 1
          ? `, times ${trimmed(spec["ratio"])}`
          : "",
        isNumber(spec["offset"]) && spec["offset"] !== 0
          ? `, plus ${trimmed(spec["offset"])}`
          : "",
      ].join("");
  return `follows ${text(from["object"]) ?? "?"}'s ${valueWords(from)}${how}`;
}

/** The pairs of parts a motion check allows to touch: "Gear_A with Gear_B". */
function allowedWords(given: unknown): string | undefined {
  const pairs = list(given)
    .map((pair) => list(pair).map((name) => text(name) ?? "?"))
    .map((pair) => pair.join(" with "));
  return pairs.length ? pairs.join("; ") : undefined;
}

export function framesRows(args: Args): Row[] {
  const count = isNumber(args["count"]) ? args["count"] : 12;
  if (args["pictures"] === false)
    return [
      {
        name: "Checks",
        value: `every frame from ${seconds(args["time"]) ?? "0 s"} to ${seconds(args["end"]) ?? "the end of the timeline"}, in numbers, with no pictures`,
      },
      ...row("Places of", names(args["objects"]) || undefined),
      ...row("Touching by design", allowedWords(args["allowed"])),
      ...row(
        "As a loop",
        args["loop"] === true
          ? "checks that its end runs into its start"
          : undefined,
      ),
    ];
  const first = seconds(args["time"]) ?? "0 s";
  return [
    {
      name: "Frames",
      value:
        count === 1
          ? `1, at ${first}`
          : isNumber(args["every_ms"])
            ? `${count}, from ${first}, every ${trimmed(args["every_ms"])} ms`
            : `${count}, spread evenly from ${first} to ${seconds(args["end"]) ?? "the end of the timeline"}`,
    },
    {
      name: "Seen from",
      value:
        args["view"] === "overview"
          ? "the overview"
          : args["view"] === "objects"
            ? `close up on ${names(args["objects"]) || "the objects named"}`
            : "the scene camera",
    },
    ...row(
      "Drawn",
      args["engine"] === "solid" ? "as the solid view draws it" : undefined,
    ),
    ...row("Places of", names(args["objects"]) || undefined),
    ...row("Touching by design", allowedWords(args["allowed"])),
    ...row(
      "As a loop",
      args["loop"] === true
        ? "checks that its end runs into its start"
        : undefined,
    ),
  ];
}

export function closeUpRows(args: Args): Row[] {
  return [
    {
      name: "Close up on",
      value:
        typeof args["main"] === "number"
          ? `the ${args["main"]} the scene is mostly about`
          : names(args["objects"]) || "the objects named",
    },
    ...row(
      "At",
      seconds(args["time"])
        ? `${seconds(args["time"])} of the animation`
        : undefined,
    ),
  ];
}

const lookShadings: Readonly<Record<string, string>> = {
  shaded: "shaded",
  wireframe: "as wires",
  faces: "by the way each face points",
  reflections: "by its reflections of a light in bands",
};

export function lookRows(args: Args): Row[] {
  return [
    {
      name: "Look at",
      value: `${names(args["objects"]) || "the whole scene"}, from the front, right, top and three-quarter`,
    },
    {
      name: "Drawn",
      value: lookShadings[text(args["shading"]) ?? "shaded"] ?? "shaded",
    },
    ...row(
      "At",
      seconds(args["time"])
        ? `${seconds(args["time"])} of the animation`
        : undefined,
    ),
  ];
}

export function videoRows(args: Args, output: string): Row[] {
  const cycles = args["engine"] === "cycles";
  return [
    {
      name: "Time",
      value: `${seconds(args["start"]) ?? "0 s"} to ${seconds(args["end"]) ?? "the end of the timeline"}`,
    },
    {
      name: "Camera",
      value:
        typeof args["camera"] === "string" && args["camera"]
          ? args["camera"]
          : "the scene's camera",
    },
    { name: "Engine", value: cycles ? "Cycles" : "EEVEE" },
    {
      name: "Size",
      // A video's sides are even, as Blender makes them.
      value:
        pixels(
          numbers(args["resolution"])?.map((side) => Math.floor(side / 2) * 2),
        ) ?? "the scene's picture size, made even",
    },
    {
      name: "Samples",
      value: isNumber(args["samples"])
        ? `${args["samples"]} a frame`
        : `${cycles ? statedNumbers.video.cycles_samples : statedNumbers.video.eevee_samples} a frame, the default`,
    },
    ...row(
      "Draft",
      isNumber(args["every"]) && args["every"] > 1
        ? `every ${args["every"]} frames, at its real speed`
        : undefined,
    ),
    ...row(
      "Slow motion",
      isNumber(args["slow_motion"]) && args["slow_motion"] > 1
        ? `${trimmed(args["slow_motion"])} times slower`
        : undefined,
    ),
    ...row(
      "Sampling",
      args["sampling"] !== undefined
        ? "Cycles's sampling as given, for this video alone"
        : undefined,
    ),
    { name: "Saved as", value: output },
  ];
}

/** Every row but a script's is words; a script is code, and is shown as code. */
export function scriptRows(
  code: string,
  outside: readonly string[] = [],
  forGood: readonly string[] = [],
): Row[] {
  return [
    { name: "Code", value: code, runs: true },
    {
      name: "Can also change",
      value: outside.length
        ? `any file in the workspace, which Zhiyin copies first to put back, and files in ${outside.map((folder) => `${folder}, outside the folder you selected`).join("; and ")}; nothing else of yours`
        : "any file in the workspace, which Zhiyin copies first to put back, and nothing else of yours",
      readable: true,
    },
    ...(forGood.length
      ? [
          {
            name: "Changes for good",
            value: `${forGood.join(", ")}, which Zhiyin could not copy first`,
            readable: true as const,
          },
        ]
      : []),
    {
      name: "Can also reach",
      value: "nothing else of yours, and not the internet",
      readable: true,
    },
  ];
}

export const inWords = (rows: readonly Row[]): Row[] =>
  rows.map((item) => ({ ...item, readable: true }));

export function settleRows(args: Args): Row[] {
  const seconds = isNumber(args["seconds"]) ? args["seconds"] : 3;
  return [
    ...row("Drop", names(args["objects"])),
    ...row("Onto", names(args["on"])),
    {
      name: "For",
      value: `${seconds} s of physics, then kept where they settle`,
    },
  ];
}
