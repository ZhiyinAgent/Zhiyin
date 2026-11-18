/**
 * Putting decals on objects, a change to the scene. The picture a decal or
 * strip shows and the font its text is drawn in are workspace files, checked
 * and sent to Blender by their absolute paths; the approval names each file
 * the call reads.
 */

import { font, kinds, readable, type Refusal } from "./paths.js";
import { sceneChange, type Args } from "./prepared-call.js";
import {
  isNumber,
  length,
  point,
  record,
  text,
  trimmed,
  type Row,
} from "./approval-words.js";

function vector(value: unknown): string | undefined {
  if (!Array.isArray(value) || !value.every(isNumber)) return undefined;
  return `(${value.map(trimmed).join(", ")})`;
}

const row = (name: string, value: string | undefined): Row[] =>
  value ? [{ name, value, readable: true }] : [];

function lineWords(along: Args): string | undefined {
  if (isNumber(along["sharp_angle"]))
    return `its edges sharper than ${trimmed(along["sharp_angle"])}°`;
  if (text(along["surface_group"]))
    return `round its “${text(along["surface_group"])}” surfaces`;
  if (along["seams"] === true) return "its seams";
  if (text(along["curve"])) return `the curve ${text(along["curve"])}`;
  if (isNumber(along["height"]))
    return `round it at a height of ${length(along["height"])}`;
  return undefined;
}

function stripWords(args: Args): string {
  const pattern = text(args["pattern"]) ?? "dash";
  if (pattern === "groove" || pattern === "shape")
    return [
      isNumber(args["width"]) ? `${length(args["width"])} wide` : undefined,
      pattern === "groove"
        ? "a groove"
        : `${text(args["shape"]) ?? "a shape"} repeated`,
      isNumber(args["pitch"]) ? `every ${length(args["pitch"])}` : undefined,
      isNumber(args["relief"]) ? reliefWords(args["relief"]) : undefined,
      "by shading alone",
    ]
      .filter(Boolean)
      .join(", ");
  const parts = [
    isNumber(args["width"]) ? `${length(args["width"])} wide` : undefined,
    pattern === "solid" ? "a plain band" : `${pattern} pattern`,
    isNumber(args["pitch"]) ? `every ${length(args["pitch"])}` : undefined,
    isNumber(args["raised"])
      ? `raised ${length(args["raised"])}`
      : "printed flat",
  ];
  return parts.filter(Boolean).join(", ");
}

function reliefWords(relief: number): string {
  return relief < 0
    ? `pressed ${length(-relief)} in`
    : `standing ${length(relief)}`;
}

/** What a normal decal draws, and how a wrap label is made. */
function kindRows(args: Args): Row[] {
  if (args["kind"] === "normal")
    return [
      ...row("Kind", "relief by shading alone, projected onto the surface"),
      ...row(
        "Draws",
        [
          text(args["shape"]) ??
            (text(args["picture"])
              ? "the picture's brightness as height"
              : undefined),
          isNumber(args["count"])
            ? `${trimmed(args["count"])} of its parts`
            : undefined,
          isNumber(args["relief"]) ? reliefWords(args["relief"]) : undefined,
        ]
          .filter(Boolean)
          .join(", ") || undefined,
      ),
    ];
  const clear = args["label"] === "clear";
  return [
    ...row(
      "Kind",
      `a label wrapped round its ${text(args["axis"]) ?? "z"} axis`,
    ),
    ...row(
      "Label",
      [
        clear ? "clear film" : "paper",
        clear
          ? args["white_ink"] === false
            ? "ink without white under it"
            : "ink over white"
          : undefined,
        isNumber(args["roughness"])
          ? `roughness ${trimmed(args["roughness"])}`
          : undefined,
        text(args["color"]) ? `ink ${text(args["color"])}` : undefined,
      ]
        .filter(Boolean)
        .join(", "),
    ),
  ];
}

function placeWords(args: Args): string | undefined {
  const at = point(args["at"]);
  if (!at) return undefined;
  if (args["kind"] === "wrap") return `its middle on the surface outside ${at}`;
  const direction = vector(args["direction"]);
  const turned = isNumber(args["rotation"])
    ? `, turned ${trimmed(args["rotation"])}°`
    : "";
  return direction
    ? `cast along ${direction} through ${at}${turned}`
    : `on the surface nearest ${at}${turned}`;
}

function changesWords(args: Args): string {
  const given = (key: string, words: string) =>
    isNumber(args[key]) ? `${words} ${trimmed(args[key])}` : undefined;
  const values: Record<string, string | undefined> = {
    color: text(args["color"]) ? `colour ${text(args["color"])}` : "colour",
    roughness: given("roughness", "roughness"),
    metal: given("metal", "metal"),
    coat: given("coat", "coat"),
    normal: isNumber(args["relief"])
      ? `relief ${length(args["relief"])}`
      : "relief",
  };
  const affects = Array.isArray(args["affects"])
    ? args["affects"].filter((item): item is string => typeof item === "string")
    : Object.keys(values).filter(
        (key) =>
          key === "color" ||
          (key === "normal" ? isNumber(args["relief"]) : isNumber(args[key])),
      );
  return affects.map((key) => values[key] ?? key).join(", ");
}

/** The call as a person reads it. */
function decalRows(args: Args): Row[] {
  const strip = args["kind"] === "strip";
  const picture = text(args["picture"]);
  const writing = text(args["text"]);
  return [
    ...row("On", text(args["object"])),
    ...row("Name", text(args["name"])),
    ...row("Reads", picture),
    ...row(
      "Text",
      writing
        ? `“${writing}”${text(args["font"]) ? ` in ${text(args["font"])}` : ""}`
        : undefined,
    ),
    ...(args["kind"] === "normal" || args["kind"] === "wrap"
      ? [
          ...kindRows(args),
          ...row("Where", placeWords(args)),
          ...row(
            "Size",
            isNumber(args["size"]) ? `${length(args["size"])} wide` : undefined,
          ),
        ]
      : strip
        ? [
            ...row("Along", lineWords(record(args["along"]))),
            ...row("Strip", stripWords(args)),
          ]
        : [
            ...row(
              "Kind",
              args["kind"] === "mesh"
                ? args["conform"] === false
                  ? "a flat card of its own"
                  : "a card of its own, bent to the surface"
                : "projected onto the surface",
            ),
            ...row("Where", placeWords(args)),
            ...row(
              "Size",
              isNumber(args["size"])
                ? `${length(args["size"])} wide`
                : undefined,
            ),
            ...row("Changes", changesWords(args)),
          ]),
    ...row(
      "Off the surface",
      isNumber(args["offset"]) ? length(args["offset"]) : undefined,
    ),
  ];
}

export const prepareDecal = sceneChange(
  "decal",
  async (args, { root }): Promise<Refusal | ReturnType<typeof changed>> => {
    const checked: Record<string, unknown> = { ...args };
    if (args["picture"] !== undefined) {
      const found = await readable(
        root,
        args["picture"],
        kinds.picture,
        "A picture",
      );
      if (!("absolute" in found)) return found;
      checked["picture"] = found.absolute;
    }
    if (args["font"] !== undefined) {
      const found = await font(root, args["font"]);
      if (!("absolute" in found)) return found;
      checked["font"] = found.absolute;
    }
    return changed(checked, args);
  },
);

function changed(checked: Args, args: Args) {
  return {
    args: checked,
    action: "Add decals to objects in a 3D scene",
    rows: decalRows(args),
  };
}
