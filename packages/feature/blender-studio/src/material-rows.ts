/**
 * A material call as a person reads it: the material named, its values, its
 * finish and marks, light inside, tint, height, texture set and the faces or
 * surfaces it goes on.
 */

import {
  isNumber,
  length,
  list,
  names,
  numbers,
  point,
  record,
  row,
  text,
  trimmed,
  type Args,
  type Row,
} from "./approval-words.js";
import { toonRows } from "./look-rows.js";

/** Where each mark beyond wear and grime goes, as its approval row says it. */
const markPlaces: Readonly<Record<string, readonly [string, string]>> = {
  rust: ["Rust", "on edges and corners, running down"],
  drips: ["Drip streaks", "running down from edges"],
  dust: ["Dust", "on faces looking up"],
  scratches: ["Scratches", "along its longest side"],
  fingerprints: ["Fingerprints", "on open faces"],
};

function markRows(material: Args): Row[] {
  const rows = Object.entries(markPlaces).flatMap(([key, [name, where]]) => {
    const amount = material[key];
    return isNumber(amount) && amount > 0
      ? [{ name, value: `${trimmed(amount)} ${where}` }]
      : [];
  });
  const brushing = material["brushing"];
  if (brushing && typeof brushing === "object" && !Array.isArray(brushing)) {
    const { pattern, axis } = brushing as Args;
    const how = typeof pattern === "string" ? pattern : "linear";
    rows.push({
      name: "Brushing",
      value: typeof axis === "string" ? `${how}, about its ${axis} axis` : how,
    });
  }
  return rows;
}

export function materialRows(args: Args): Row[] {
  const material = record(args["material"]);
  const texture = record(material["texture"]);
  const normal = record(material["normal_map"]);
  const emission = record(material["emission"]);
  const tint = record(material["tint"]);
  const finish = text(material["finish"]);
  /** Light scattered inside a material, as an approval reads it. */
  function subsurface(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    const given = record(value);
    const reach = numbers(given["radius_mm"]);
    return [
      text(given["preset"]) ?? "its own",
      isNumber(given["weight"]) ? `weight ${given["weight"]}` : undefined,
      reach ? `reaching ${reach.join(", ")} mm` : undefined,
      isNumber(given["scale"]) ? `scaled ${given["scale"]} times` : undefined,
      text(given["method"]),
    ]
      .filter(Boolean)
      .join(", ");
  }

  const mapKinds = [
    "color",
    "roughness",
    "metallic",
    "normal",
    "height",
    "ao",
    "opacity",
    "orm",
  ] as const;

  /** A texture set, as an approval reads it: its folder or its pictures, and its size. */
  function textureSet(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    const maps = record(value);
    const named = mapKinds
      .filter((kind) => text(maps[kind]))
      .map((kind) => `${kind} ${text(maps[kind])}`);
    const from = [
      ...(text(maps["folder"])
        ? [`the pictures in ${text(maps["folder"])}`]
        : []),
      ...named,
    ].join(", ");
    return `${from || "nothing named"}${isNumber(maps["size"]) ? `, ${length(maps["size"])} a repeat` : ""}${text(maps["convention"]) ? `, normal map ${maps["convention"] === "directx" ? "DirectX" : "OpenGL"}` : ""}`;
  }

  /** Relief, as an approval reads it: from what, how deep and how drawn. */
  function height(value: unknown, maps: unknown): string | undefined {
    if (value === undefined) return undefined;
    const given = record(value);
    const pattern = record(given["pattern"]);
    const from =
      text(given["path"]) ??
      (text(pattern["kind"])
        ? `${text(pattern["kind"])}${isNumber(pattern["size"]) ? ` ${length(pattern["size"])} across` : ""}`
        : (text(record(maps)["height"]) ??
          (maps !== undefined ? "the texture set's height map" : undefined)));
    const method = text(given["method"]) ?? "bump";
    return `${from ?? "nothing"}${isNumber(given["depth"]) ? `, up to ${length(given["depth"])}` : ""}, by ${method === "displace" ? "moving the surface" : method === "both" ? "moving the surface and bump" : "bump"}`;
  }

  /** The faces of a mesh a material goes on, as an approval reads them. */
  function faces(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    const given = record(value);
    const facing = numbers(given["facing"]);
    const box = list(given["inside"]);
    return (
      [
        facing
          ? `facing (${facing.map(trimmed).join(", ")}) within ${isNumber(given["within"]) ? given["within"] : 15}°`
          : undefined,
        box.length === 2
          ? `inside ${point(box[0])} to ${point(box[1])}`
          : undefined,
        text(given["attribute"]) && `marked ${text(given["attribute"])}`,
        text(given["slot"]) && `now showing ${text(given["slot"])}`,
      ]
        .filter(Boolean)
        .join(" and ") || "none named"
    );
  }

  const projections: Record<string, string> = {
    uv: "along the shape's layout",
    box: "on every side",
    cylinder: "wrapped round",
    sphere: "wrapped as a sphere",
    front: "from the front",
  };
  // A material named by nothing is named after the first object. Named with
  // nothing else, one already in the scene goes on as it is; only a new one
  // takes the default look. Set, it changes wherever it is used, by the
  // values given alone: the rest it keeps, so only those given are shown.
  const first = text(list(args["objects"])[0]);
  const name =
    text(material["name"]) ?? (first ? `${first} material` : undefined);
  if (Object.keys(material).join() === "name")
    return [
      ...row("Objects", names(args["objects"])),
      ...row("Surfaces", text(args["surface"])),
      ...row(
        "Material",
        name && `${name}, as it is, or new in plain grey if there is none`,
      ),
      ...toonRows(args),
    ];
  return [
    ...row("Objects", names(args["objects"])),
    ...row("Surfaces", text(args["surface"])),
    ...row(
      "Material",
      name &&
        `${name}, as below wherever it is used; the rest kept, or the defaults if new`,
    ),
    // A finish has its own colour, roughness, metal and coat when none is given.
    ...row(
      "Colour",
      text(material["color"]) ?? (finish ? `${finish}'s own` : undefined),
    ),
    ...row(
      "Roughness",
      isNumber(material["roughness"])
        ? `${material["roughness"]}`
        : finish
          ? `${finish}'s own`
          : undefined,
    ),
    ...row("Finish", finish),
    ...row(
      "Wear",
      isNumber(material["wear"]) && material["wear"] > 0
        ? `${material["wear"]} on edges and corners`
        : undefined,
    ),
    ...row(
      "Grime",
      isNumber(material["grime"]) && material["grime"] > 0
        ? `${material["grime"]} in recesses and corners`
        : undefined,
    ),
    ...markRows(material),
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
        ? `${text(emission["color"]) ?? (text(texture["path"]) ? "its picture" : "#ffffff")}${isNumber(emission["kelvin"]) ? ` at ${emission["kelvin"]} K` : ""} at ${isNumber(emission["strength"]) ? emission["strength"] : 1}${emission["lights_scene"] === false ? ", not sampled as a light" : ""}`
        : undefined,
    ),
    ...row(
      "Picture",
      text(texture["path"])
        ? `${text(texture["path"])}, ${projections[text(texture["projection"]) ?? "uv"] ?? text(texture["projection"])}`
        : undefined,
    ),
    ...row(
      "Surface detail",
      text(normal["path"]) &&
        `${text(normal["path"])}${text(normal["convention"]) ? `, ${normal["convention"] === "directx" ? "DirectX" : "OpenGL"}` : ""}`,
    ),
    ...row("Coat tint", text(material["coat_tint"])),
    ...row(
      "Coat ior",
      isNumber(material["coat_ior"]) ? `${material["coat_ior"]}` : undefined,
    ),
    ...row("Specular tint", text(material["specular_tint"])),
    ...row(
      "Diffuse roughness",
      isNumber(material["diffuse_roughness"])
        ? `${material["diffuse_roughness"]}`
        : undefined,
    ),
    ...row(
      "Reflections",
      material["distribution"] === "ggx"
        ? "GGX"
        : material["distribution"] === "multiscatter-ggx"
          ? "multiscatter GGX"
          : undefined,
    ),
    ...row("Light inside", subsurface(material["subsurface"])),
    ...row(
      "Tint",
      text(tint["color"]) && isNumber(tint["depth"])
        ? `${text(tint["color"])} seen through ${length(tint["depth"])}`
        : undefined,
    ),
    ...row("Texture set", textureSet(material["maps"])),
    ...row("Height", height(material["height"], material["maps"])),
    ...row("Faces", faces(args["faces"])),
    ...toonRows(args),
  ];
}
