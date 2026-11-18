/**
 * A shaping step as a person reads it in an approval: the kinds beyond
 * cutting, rounding, repeating, mirroring, thickening, subdividing and
 * smoothing, and what a step's further inputs add to those, in plain words
 * with sizes in millimetres or metres.
 */

import { isNumber, length, record, text, type Args } from "./approval-words.js";

const words = (value: unknown) => text(value)?.replaceAll("_", " ");
const joined = (parts: readonly (string | undefined | false)[]) =>
  parts.filter(Boolean).join(", ");

/** The steps of kinds the approval's older rows do not name. */
export function newShapeStep(step: Args): string {
  switch (step["kind"]) {
    case "remesh":
      return step["method"] === "quadriflow"
        ? `Remesh as quads by QuadriFlow${isNumber(step["faces"]) ? `, about ${step["faces"]} faces` : ""}${isNumber(step["edge_length"]) ? `, edges about ${length(step["edge_length"])}` : ""}`
        : `Remesh by voxels of ${isNumber(step["voxel_size"]) ? length(step["voxel_size"]) : "?"}`;
    case "weighted_normals":
      return `Weight its normals by ${words(step["weighting"]) ?? "face area"}`;
    case "triangulate":
      return "Triangulate it, keeping its shading";
    case "hard_surface":
      return `Hard-surface it: sharp edges, a ${isNumber(step["width"]) ? length(step["width"]) : "?"} bevel hardening its normals, weighted normals${step["triangulate"] ? ", triangles" : ""}`;
    case "displace":
      return `Displace it by ${step["texture"] === "image" ? (text(step["image"]) ?? "a picture") : (words(step["texture"]) ?? "clouds")}, ${isNumber(step["strength"]) ? length(step["strength"]) : "10 mm"} at full strength`;
    case "shrinkwrap":
      return `Wrap it onto ${text(step["target"]) ?? "?"} by ${words(step["wrap"]) ?? "nearest surface"}`;
    case "curve":
      return `Set its curve's geometry: ${
        joined([
          isNumber(step["depth"]) && `${length(step["depth"])} deep`,
          text(step["bevel_object"]) && `section ${text(step["bevel_object"])}`,
          text(step["profile_preset"]) &&
            `${text(step["profile_preset"])} profile`,
          isNumber(step["extrude"]) && `extruded ${length(step["extrude"])}`,
          text(step["taper_object"]) &&
            `tapered by ${text(step["taper_object"])}`,
          text(step["fill"]) && `filled ${text(step["fill"])}`,
          step["caps"] === true && "capped",
          step["caps"] === false && "ends open",
          text(step["twist"]) && `twist ${words(step["twist"])}`,
        ]) || "as given"
      }`;
    default:
      return String(step["kind"]);
  }
}

/** What a step's further inputs add to the words its kind is said in. */
export function shapeStepExtras(step: Args): string {
  const around = record(step["around"]);
  const extras: (string | undefined | false)[] = [];
  switch (step["kind"]) {
    case "boolean":
      extras.push(text(step["solver"]) && `${text(step["solver"])} solver`);
      break;
    case "bevel":
      extras.push(
        text(step["limit"]) &&
          step["limit"] !== "angle" &&
          `edges chosen by ${words(step["limit"])}`,
        step["harden_normals"] === true && "normals hardened",
      );
      break;
    case "array":
      extras.push(
        step["around"] !== undefined &&
          `round ${text(around["axis"]) ?? "z"}${isNumber(around["angle"]) ? ` over ${around["angle"]}°` : ""}`,
        text(step["curve"]) && `along ${text(step["curve"])}`,
        step["fit"] === "length" &&
          isNumber(step["length"]) &&
          `filling ${length(step["length"])}`,
        isNumber(step["merge"]) && `joined within ${length(step["merge"])}`,
      );
      break;
    case "mirror":
      extras.push(
        step["bisect"] === false && "without cutting what reaches across",
        isNumber(step["merge"]) && `joined within ${length(step["merge"])}`,
      );
      break;
    case "solidify":
      extras.push(
        step["mode"] === "complex" && "complex",
        step["rim"] === false && "rim open",
      );
      break;
    case "subdivision":
      extras.push(
        step["scheme"] === "simple" && "simple",
        isNumber(step["render_levels"]) &&
          `${step["render_levels"]} in renders`,
      );
      break;
    case "smooth":
      extras.push(
        text(step["shading"]) &&
          step["shading"] !== "by_angle" &&
          words(step["shading"]),
      );
      break;
  }
  const said = joined(extras);
  return said ? `, ${said}` : "";
}
