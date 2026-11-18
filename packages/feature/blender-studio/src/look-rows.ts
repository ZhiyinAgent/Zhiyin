/**
 * How the inputs that shape a picture's light and look read in an approval:
 * which objects a light lights, cards and the rays that see objects, fog,
 * caustics, outlines, Cycles's sampling, a render's post, EEVEE's options,
 * toon shading and what a motion does past its keys.
 */

import {
  isNumber,
  list,
  names,
  record,
  row,
  text,
  type Args,
  type Row,
} from "./approval-words.js";
import { statedNumbers, statedWords } from "./stated-numbers.js";

const given = (value: unknown) => Array.isArray(value);

/** Whom one light lights and lets cast its shadows, as parts of its row. */
export function linkingWords(light: Args): string[] {
  const said = (value: unknown, some: string, none: string) =>
    given(value) ? (names(value) ? `${some} ${names(value)}` : none) : "";
  return [
    said(light["lights_only"], "lights only", "lights everything"),
    said(
      light["lights_except"],
      "never lights",
      "leaves nothing out of its light",
    ),
    said(light["shadows_only"], "shadows only from", "shadows from everything"),
    said(
      light["shadows_except"],
      "no shadows from",
      "leaves nothing out of its shadows",
    ),
  ].filter(Boolean);
}

const cardKinds: Readonly<Record<string, string>> = {
  reflection: "a glowing card seen only in reflections",
  bounce: "a white card that only bounces light",
  flag: "a black card that only blocks light",
};

const rays = [
  ["camera", "the camera"],
  ["bounced", "bounced light"],
  ["reflections", "reflections"],
  ["refraction", "refraction"],
  ["shadows", "shadows"],
  ["fog", "fog"],
] as const;

/** Which rays see something and which do not, as an approval reads it. */
function raysWords(value: unknown): string {
  const seen = record(value);
  const by = rays.filter(([key]) => seen[key] === true).map(([, w]) => w);
  const not = rays.filter(([key]) => seen[key] === false).map(([, w]) => w);
  return [
    by.length ? `seen by ${by.join(", ")}` : "",
    not.length ? `not by ${not.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** Cards, the rays that see objects, fog and caustics. */
export function lightShapingRows(args: Args): Row[] {
  const fog = record(args["fog"]);
  const caustics = record(args["caustics"]);
  const switches = [
    caustics["reflective"] === true
      ? "reflective on"
      : caustics["reflective"] === false
        ? "reflective off"
        : "",
    caustics["refractive"] === true
      ? "refractive on"
      : caustics["refractive"] === false
        ? "refractive off"
        : "",
    isNumber(caustics["filter_glossy"])
      ? `glossy filter ${caustics["filter_glossy"]}`
      : "",
    names(caustics["casters"]) && `cast by ${names(caustics["casters"])}`,
    names(caustics["receivers"]) && `onto ${names(caustics["receivers"])}`,
    names(caustics["lights"]) && `from ${names(caustics["lights"])}`,
    caustics["path_guiding"] === true
      ? "path guiding on"
      : caustics["path_guiding"] === false
        ? "path guiding off"
        : "",
  ].filter(Boolean);
  return [
    ...list(args["cards"]).map((item) => {
      const card = record(item);
      return {
        name: `Card ${text(card["name"]) ?? "?"}`,
        value:
          [
            cardKinds[text(card["kind"]) ?? ""],
            text(card["color"]),
            isNumber(card["strength"]) ? `strength ${card["strength"]}` : "",
            card["seen_by"] === undefined ? "" : raysWords(card["seen_by"]),
          ]
            .filter(Boolean)
            .join(", ") || "as it is, with what is given",
      };
    }),
    ...list(args["seen_by"]).map((item) => {
      const seen = record(item);
      return {
        name: `Seen by: ${names(seen["objects"]) || "?"}`,
        value: raysWords(seen) || "as it is",
      };
    }),
    ...row(
      "Fog",
      args["fog"] === undefined
        ? undefined
        : isNumber(fog["density"]) && fog["density"] === 0
          ? "removed"
          : [
              isNumber(fog["density"])
                ? `density ${fog["density"]} a metre`
                : "",
              isNumber(fog["anisotropy"])
                ? `anisotropy ${fog["anisotropy"]}`
                : "",
              text(fog["color"]),
              isNumber(fog["height_falloff"]) && fog["height_falloff"] > 0
                ? `halving every ${fog["height_falloff"]} m up`
                : "",
              names(fog["objects"])
                ? `in ${names(fog["objects"])}`
                : fog["world"] === true
                  ? "everywhere, endless"
                  : "in a box round the scene",
            ]
              .filter(Boolean)
              .join(", "),
    ),
    ...row(
      "Caustics",
      args["caustics"] === undefined
        ? undefined
        : switches.join(", ") || "as they are",
    ),
  ];
}

const stepNames: Readonly<Record<string, string>> = {
  bloom: "Bloom",
  glow: "Fog Glow",
  streaks: "Streaks",
  ghosts: "Ghosts",
  star: "Simple Star",
  sun_beams: "Sun Beams",
  lens_distortion: "Lens Distortion",
  sharpen: "Sharpen",
  color_balance: "Color Balance",
  painterly: "Kuwahara",
  vignette: "Vignette",
  film_grain: "Film Grain",
  sensor_noise: "Sensor Noise",
  chromatic_aberration: "Chromatic Aberration",
  sepia: "Sepia",
  split_toning: "Split Toning",
  unsharp_mask: "Unsharp Mask",
  tune_image: "Tune Image",
};

const outlineMethods: Readonly<Record<string, string>> = {
  freestyle: "Freestyle lines",
  line_art: "Line Art",
  hull: "an inverted hull",
};

/** Outlines. */
export function pictureLookRows(args: Args): Row[] {
  const outlines = record(args["outlines"]);
  const method = text(outlines["method"]);
  return [
    ...row(
      "Outlines",
      args["outlines"] === undefined
        ? undefined
        : method === "none"
          ? "removed"
          : [
              outlineMethods[method ?? ""] ?? method ?? "?",
              `${isNumber(outlines["thickness"]) ? outlines["thickness"] : statedNumbers.camera.thickness} px`,
              text(outlines["color"]) ?? statedWords.camera.outline_colour,
              names(outlines["objects"])
                ? `on ${names(outlines["objects"])}`
                : "",
            ]
              .filter(Boolean)
              .join(", "),
    ),
  ];
}

/** A render's post and EEVEE's options. */
export function renderLookRows(args: Args): Row[] {
  const eevee = record(args["eevee"]);
  const shadows = record(eevee["shadows"]);
  const rays = record(eevee["raytracing"]);
  const volumes = record(eevee["volumes"]);
  const eeveeParts = [
    eevee["final"] === true
      ? "the picture to hand over"
      : eevee["final"] === false
        ? "a draft"
        : "",
    isNumber(shadows["rays"]) ? `${shadows["rays"]} shadow rays` : "",
    isNumber(shadows["steps"]) ? `${shadows["steps"]} shadow steps` : "",
    isNumber(shadows["resolution"])
      ? `shadows at ${Math.round(shadows["resolution"] * 100)}%`
      : "",
    text(rays["method"]) === "off"
      ? "no ray tracing"
      : text(rays["method"])
        ? `ray tracing by ${text(rays["method"])}`
        : "",
    isNumber(rays["resolution"])
      ? `rays at 1/${rays["resolution"]} resolution`
      : "",
    isNumber(volumes["tile"]) ? `volume tiles of ${volumes["tile"]} px` : "",
    isNumber(volumes["samples"]) ? `${volumes["samples"]} volume samples` : "",
    volumes["shadows"] === true ? "volume shadows" : "",
    eevee["probes"] === true ? "light probes baked" : "",
  ].filter(Boolean);
  return [
    ...row(
      "Post",
      args["post"] === undefined
        ? undefined
        : list(args["post"])
            .map((item) => {
              const step = record(item);
              const name = stepNames[text(step["step"]) ?? ""] ?? "?";
              const amount = isNumber(step["amount"])
                ? step["amount"]
                : statedNumbers.render.post_amount;
              return amount === 1
                ? name
                : `${name} at ${Math.round(amount * 100)}%`;
            })
            .join(", ") || "none",
    ),
    ...row(
      "EEVEE",
      args["eevee"] === undefined
        ? undefined
        : eeveeParts.join(", ") || "as the scene has it",
    ),
  ];
}

/** Toon shading on a material. */
export function toonRows(args: Args): Row[] {
  if (args["toon"] === undefined) return [];
  const toon = record(args["toon"]);
  const rim = record(toon["rim"]);
  const bands = isNumber(toon["bands"])
    ? toon["bands"]
    : statedNumbers.material.bands;
  return row(
    "Toon",
    [
      `${bands} ${bands === 1 ? "band" : "bands"}`,
      text(toon["shadow_color"])
        ? `shadows ${text(toon["shadow_color"])}`
        : isNumber(toon["shadow"])
          ? `shadows at ${Math.round(toon["shadow"] * 100)}%`
          : "",
      toon["rim"] !== undefined
        ? `a ${text(rim["color"]) ?? "#ffffff"} rim`
        : "",
      toon["faceted"] === true ? "each face flat" : "",
    ]
      .filter(Boolean)
      .join(", "),
  );
}

/** Cycles's sampling. */
export function samplingRows(args: Args): Row[] {
  if (args["sampling"] === undefined) return [];
  const sampling = record(args["sampling"]);
  const parts = [
    isNumber(sampling["noise_threshold"])
      ? sampling["noise_threshold"] === 0
        ? "every pixel fully sampled"
        : `stopping at noise ${sampling["noise_threshold"]}`
      : "",
    isNumber(sampling["min_samples"])
      ? `at least ${sampling["min_samples"]} samples`
      : "",
    isNumber(sampling["time_limit"]) && sampling["time_limit"] > 0
      ? `at most ${sampling["time_limit"]} s`
      : "",
    isNumber(sampling["seed"]) ? `seed ${sampling["seed"]}` : "",
    text(sampling["pattern"])?.replace(/_/g, " ") ?? "",
    text(sampling["denoise"]) === "off"
      ? "not denoised"
      : text(sampling["denoise"])
        ? `denoised ${text(sampling["denoise"])}`
        : "",
    ...(["direct", "indirect"] as const).map((kind) => {
      const value = record(sampling["clamp"])[kind];
      return isNumber(value)
        ? value === 0
          ? `${kind} light unclamped`
          : `${kind} light clamped at ${value}`
        : "";
    }),
  ].filter(Boolean);
  return row("Sampling", parts.join(", ") || "as the scene has it");
}

const extendWords: Readonly<Record<string, string>> = {
  hold: "holds its first and last poses",
  continue: "carries on at its end speeds",
  repeat: "repeats its keys round",
  repeat_on: "repeats its keys, each round on from the last",
  back_and_forth: "plays its keys back and forth",
};

/** What each object's motion does past its keys. */
export function extendRows(args: Args): Row[] {
  return list(args["extend"]).map((item) => {
    const spec = record(item);
    return {
      name: `${text(spec["object"]) ?? "?"} past its keys`,
      value: extendWords[text(spec["mode"]) ?? ""] ?? "?",
    };
  });
}
