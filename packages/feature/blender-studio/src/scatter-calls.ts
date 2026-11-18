/**
 * Scattering objects over a surface, a change to the scene, and how a
 * scatter reads for approval.
 */

import { isNumber, length, names, text } from "./approval-words.js";
import { record, sceneChange, type Args } from "./prepared-call.js";
import { inWords, type Row } from "./wording.js";

const pair = (value: unknown) =>
  Array.isArray(value) && value.length === 2 && value.every(isNumber)
    ? (value as [number, number])
    : undefined;

/** Where copies may stand, as a person reads it. */
function whereWords(value: unknown): string | undefined {
  const where = record(value);
  const said: string[] = [];
  const material = text(where["material"]);
  if (material) said.push(`on material ${material}`);
  const group = text(where["vertex_group"]);
  if (group) said.push(`in vertex group ${group}`);
  const slope = pair(where["slope"]);
  if (slope) said.push(`sloping ${slope[0]}° to ${slope[1]}°`);
  const height = pair(where["height"]);
  if (height)
    said.push(`from ${length(height[0])} to ${length(height[1])} high`);
  for (const [key, words] of [
    ["away_from", "at least"],
    ["near", "within"],
  ] as const) {
    const rule = record(where[key]);
    const objects = names(rule["objects"]);
    if (objects && isNumber(rule["distance"]))
      said.push(
        `${words} ${length(rule["distance"])} ${key === "near" ? "of" : "from"} ${objects}`,
      );
  }
  return said.length ? said.join("; ") : undefined;
}

/** How each copy is set on the surface, as a person reads it. */
function setWords(args: Args): string {
  const jitter = record(args["jitter"]);
  const turn = isNumber(jitter["turn"]) ? jitter["turn"] : 360;
  const scale = pair(jitter["scale"]);
  const seed = isNumber(jitter["seed"]) ? jitter["seed"] : 0;
  const sink = pair(args["sink"]);
  const offset = isNumber(args["offset"]) ? args["offset"] : 0;
  return [
    args["align"] === "surface" ? "turned to the surface" : "upright",
    ...(offset
      ? [`${offset > 0 ? "raised" : "lowered"} ${length(Math.abs(offset))}`]
      : []),
    ...(sink
      ? [`sunk ${length(sink[0])} to ${length(sink[1])} into the surface`]
      : []),
    ...(turn ? [`up to ${turn}° at random`] : []),
    ...(scale && (scale[0] !== 1 || scale[1] !== 1)
      ? [`scaled ${scale[0]} to ${scale[1]}`]
      : []),
    `seed ${seed}`,
  ].join(", ");
}

function scatterRows(args: Args): Row[] {
  const items = names(args["items"]);
  const instances = args["as"] === "instances";
  const how = isNumber(args["count"])
    ? `${args["count"]} ${instances ? "instances" : "linked copies"} of ${items}`
    : `${isNumber(args["density"]) ? args["density"] : "?"} per m² as ${instances ? "instances" : "linked copies"} of ${items}`;
  const where = whereWords(args["where"]);
  const clear = names(args["keep_clear"]);
  const weights = Object.entries(record(args["weights"]))
    .filter(([, weight]) => isNumber(weight))
    .map(([name, weight]) => `${name} ${String(weight)}`);
  const spacing = isNumber(args["spacing"]) ? args["spacing"] : 0;
  return [
    { name: "Scatter", value: how },
    ...(weights.length
      ? [
          {
            name: "Weights",
            value: `${weights.join(", ")}, any other item 1`,
          },
        ]
      : []),
    { name: "Over", value: text(args["onto"]) ?? "?" },
    ...(where ? [{ name: "Where", value: where }] : []),
    ...(clear ? [{ name: "Kept clear of", value: clear }] : []),
    {
      name: "Spacing",
      value: spacing
        ? `footprints at least ${length(spacing)} apart`
        : "footprints not touching",
    },
    { name: "Set", value: setWords(args) },
  ];
}

export const prepareScatter = sceneChange("scatter", (args) => ({
  args: { ...args },
  action: "Scatter objects over a surface in a 3D scene",
  rows: inWords(scatterRows(args)),
}));
