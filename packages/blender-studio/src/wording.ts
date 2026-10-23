/**
 * Each call as a person reads it, in approvals and in an action's details: a
 * few named rows in plain words, with sizes in millimetres or metres, rather
 * than the tool's own inputs and their schema.
 */

import type { ToolArgument } from "@zhiyin/contract";

type Args = Readonly<Record<string, unknown>>;
export type Row = Pick<ToolArgument, "name" | "value" | "readable">;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const numbers = (value: unknown): readonly number[] | undefined =>
  Array.isArray(value) && value.length > 0 && value.every(isNumber)
    ? value
    : undefined;
const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : undefined;
const record = (value: unknown): Args =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Args)
    : {};
const list = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];
const names = (value: unknown) =>
  list(value)
    .map((item) => text(item))
    .filter(Boolean)
    .join(", ");
const trimmed = (value: number) => String(Number(value.toPrecision(4)));
const row = (name: string, value: string | undefined): Row[] =>
  value ? [{ name, value }] : [];

function length(metres: number): string {
  return Math.abs(metres) < 1
    ? `${trimmed(metres * 1000)} mm`
    : `${trimmed(metres)} m`;
}

function size(value: unknown): string | undefined {
  const found = numbers(value);
  if (!found) return undefined;
  const small = Math.max(...found.map(Math.abs)) < 1;
  return `${found.map((v) => trimmed(small ? v * 1000 : v)).join(" × ")} ${small ? "mm" : "m"}`;
}

function point(value: unknown): string | undefined {
  const found = numbers(value);
  if (!found) return undefined;
  const small = Math.max(...found.map(Math.abs)) < 1;
  return `(${found.map((v) => trimmed(small ? v * 1000 : v)).join(", ")} ${small ? "mm" : "m"})`;
}

const pixels = (value: unknown) => {
  const found = numbers(value);
  return found ? `${found.join(" × ")} pixels` : undefined;
};

const restingOn = (value: unknown) => {
  const on = text(value);
  return on ? `set down on ${on === "floor" ? "the floor" : on}` : undefined;
};

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
    if (kind === "tube" && isNumber(spec["radius"]))
      parts.push(
        `${length(spec["radius"] * 2)} thick through ${list(spec["points"]).length} points${spec["corners"] === "sharp" ? " with sharp corners" : ""}`,
      );
    if (kind === "revolve")
      parts.push(`turned from ${list(spec["profile"]).length} profile points`);
    if (text(spec["path"])) parts.push(`from ${text(spec["path"])}`);
    const at = point(spec["location"]);
    if (at) parts.push(`at ${at}`);
    parts.push(restingOn(spec["rest_on"]));
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
    changes.push(restingOn(edit["rest_on"]));
    if (edit["duplicate"]) {
      const copies = record(edit["duplicate"]);
      changes.push(
        `copy ${isNumber(copies["count"]) ? copies["count"] : 1} time(s), ${point(copies["offset"]) ?? "?"} apart`,
      );
    }
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
            : `a ${shape} ${size(cutter["size"]) ?? ""}`.trim();
        return `${operation === "difference" ? "Cut" : operation === "union" ? "Add" : "Keep only the overlap with"} ${hole}${at ? ` at ${at}` : ""}`;
      }
      return `${operation === "difference" ? "Cut away" : operation === "union" ? "Join with" : "Keep only the overlap with"} ${text(step["with"]) ?? "?"}`;
    }
    case "bevel":
      return `Round the edges by ${isNumber(step["width"]) ? length(step["width"]) : "?"}${isNumber(step["segments"]) ? `, ${step["segments"]} segments` : ""}`;
    case "array":
      return `Repeat ${isNumber(step["count"]) ? step["count"] : "?"} times, ${point(step["offset"]) ?? "?"} apart`;
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
      return String(step["kind"]);
  }
}

export function shapeRows(args: Args): Row[] {
  const steps = list(args["operations"]).map((item) => shapeStep(record(item)));
  if (args["apply"]) steps.push("Bake every step into the mesh");
  return [{ name: text(args["object"]) ?? "Unnamed", value: steps.join("\n") }];
}

export function materialRows(args: Args): Row[] {
  const material = record(args["material"]);
  const texture = record(material["texture"]);
  const normal = record(material["normal_map"]);
  const emission = record(material["emission"]);
  const projections: Record<string, string> = {
    uv: "along the shape's layout",
    box: "on every side",
    cylinder: "wrapped round",
    sphere: "wrapped as a sphere",
    front: "from the front",
  };
  // A material named by nothing is named after the first object. Named with
  // nothing else, one already in the scene goes on as it is; only a new one
  // takes the default look. Set, it changes wherever it is used.
  const first = text(list(args["objects"])[0]);
  const name =
    text(material["name"]) ?? (first ? `${first} material` : undefined);
  if (Object.keys(material).join() === "name")
    return [
      ...row("Objects", names(args["objects"])),
      ...row(
        "Material",
        name && `${name}, as it is, or new in plain grey if there is none`,
      ),
    ];
  return [
    ...row("Objects", names(args["objects"])),
    ...row("Material", name && `${name}, set as below wherever it is used`),
    ...row("Colour", text(material["color"]) ?? "#cccccc"),
    ...row(
      "Roughness",
      isNumber(material["roughness"]) ? `${material["roughness"]}` : "0.5",
    ),
    ...row(
      "Metallic",
      isNumber(material["metallic"]) && material["metallic"] > 0
        ? `${material["metallic"]}`
        : undefined,
    ),
    ...row(
      "Wood grain",
      isNumber(material["wood"]) && material["wood"] > 0
        ? `${material["wood"]}`
        : undefined,
    ),
    ...row(
      "Specular",
      isNumber(material["specular"]) ? `${material["specular"]}` : undefined,
    ),
    ...row(
      "Clear coat",
      isNumber(material["coat"]) && material["coat"] > 0
        ? `${material["coat"]}${isNumber(material["coat_roughness"]) ? `, roughness ${material["coat_roughness"]}` : ""}`
        : undefined,
    ),
    ...row(
      "Glass",
      isNumber(material["transmission"]) && material["transmission"] > 0
        ? `transmission ${material["transmission"]}${isNumber(material["ior"]) ? `, ior ${material["ior"]}` : ""}`
        : undefined,
    ),
    ...row(
      "Opacity",
      isNumber(material["alpha"]) && material["alpha"] < 1
        ? `${material["alpha"]}`
        : undefined,
    ),
    ...row(
      "Glow",
      material["emission"]
        ? `${text(emission["color"]) ?? (text(texture["path"]) ? "its picture" : "#ffffff")} at ${isNumber(emission["strength"]) ? emission["strength"] : 1}`
        : undefined,
    ),
    ...row(
      "Picture",
      text(texture["path"])
        ? `${text(texture["path"])}, ${projections[text(texture["projection"]) ?? "uv"] ?? text(texture["projection"])}`
        : undefined,
    ),
    ...row("Surface detail", text(normal["path"])),
  ];
}

/** A lens shift as [across, up], in picture widths. */
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
    studio: "Studio lights (key, fill and rim)",
    product: "Studio lights in a seamless white backdrop",
    daylight: "Daylight from the sky and the sun",
    none: "Remove the preset lights",
  };
  const preset = text(args["preset"]);
  const background = record(args["background"]);
  const sky = record(background["sky"]);
  return [
    ...row("Earlier lights", args["replace"] ? "removed" : undefined),
    ...row("Preset", preset ? (presets[preset] ?? preset) : undefined),
    ...row(
      "Surroundings",
      text(background["hdri"])
        ? `${text(background["hdri"])}${isNumber(background["rotation"]) ? `, turned ${background["rotation"]}°` : ""}`
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
        : `${eevee ? 64 : 128}, the default`,
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
    ...row("Left out", names(args["without"]) || undefined),
    { name: "Saved as", value: output },
  ];
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
  ];
}

/** Every row but a script's is words; a script is code, and is shown as code. */
export function scriptRows(code: string): Row[] {
  return [
    { name: "Script", value: code },
    {
      name: "Can also change",
      value:
        "any file in the workspace, and nothing else of yours; only the scene file is kept for going back",
      readable: true,
    },
    {
      name: "Can also reach",
      value: "nothing else of yours, and not the internet",
      readable: true,
    },
  ];
}

export const inWords = (rows: readonly Row[]): Row[] =>
  rows.map((item) => ({ ...item, readable: true }));
