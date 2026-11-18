/**
 * Names that build123d's and bd_warehouse's development documentation
 * describes and the versions the CAD environment holds lack (ADR 0024): a
 * model that read those docs writes them, and is answered, by cad_api and in
 * a failed build, with what the version installed has for the same job. Each
 * was checked absent from the CAD environment.
 */

import { libraries, type Library } from "./library-versions.js";

/** Names a later release adds, and what the version installed has for the same job. */
export type LaterName = {
  readonly names: readonly string[];
  readonly library: Library;
  /** What does the job in the version installed, as a clause after "In 0.13.0, ". */
  readonly route: string;
};

export const laterNames: readonly LaterName[] = [
  {
    names: [
      "BuildSheet",
      "SheetMetalParameters",
      "bend",
      "jog",
      "hem",
      "HemType",
      "unfold",
      "FaceMap",
    ],
    library: "build123d",
    route:
      'sheet metal is folded with the helper sheet(outline, thickness, bends), from zhiyin_cad_helpers: its bends are folds, flanges, hems and jogs, and its flat pattern is part.flat; cad_api("sheet") gives its inputs',
  },
  {
    names: ["flange"],
    library: "build123d",
    route:
      'a sheet\'s flange is a bend of kind "flange" in the helper sheet(outline, thickness, bends), from zhiyin_cad_helpers; bd_warehouse.flange is pipe flanges',
  },
  {
    names: ["project_to_shape"],
    library: "build123d",
    route:
      "it is a method: Face.project_to_shape(target, direction) gives the faces a face makes on the target, and Edge.project_to_shape(target, direction) and Wire.project_to_shape the edges and wires",
  },
  {
    names: ["filter_by_value"],
    library: "build123d",
    route:
      "filter_by(lambda edge: abs(edge.length - 20) < 0.01) keeps those of a measure, filter_by_position(Axis.Z, 4, 6) those within a stretch of an axis, and sort_by(SortBy.LENGTH) or group_by(SortBy.RADIUS) orders them",
  },
  {
    names: ["SlotCurve"],
    library: "build123d",
    route:
      "trace(line_width=w) in a BuildSketch, after the curve's BuildLine, makes a band w wide along it, and Circle(w / 2) at each end, with Locations(path @ 0, path @ 1), rounds it; SlotArc, SlotCenterToCenter and SlotOverall are slots along an arc or a line",
  },
  {
    names: ["BevelGear", "MiterGear", "SphericalInvoluteToothProfile"],
    library: "bd_warehouse",
    route:
      "bd_warehouse.gear has spur, helical, rack and worm gears; a bevel gear is lofted from SpurGearPlan to its copy scaled toward the cone's apex, as skill:3d-rendering/mechanical-design shows",
  },
];

/**
 * The entry a name asked for is, if any: a bd_warehouse path by its last
 * name among bd_warehouse's, so bd_warehouse.flange is never build123d's
 * flange; any other name whole, without build123d's prefix.
 */
function laterOf(name: string) {
  const trimmed = name.trim();
  const warehouse = trimmed.startsWith("bd_warehouse.");
  const asked = warehouse
    ? trimmed.split(".").at(-1)!
    : trimmed.replace(/^(?:build123d|bd)\./, "").replace(/^gear\./, "");
  const found = laterNames.find(
    (one) =>
      one.names.includes(asked) &&
      (!warehouse || one.library === "bd_warehouse"),
  );
  return found && { asked, found };
}

/** What a name a later release adds is answered with, or nothing for any other. */
export function laterAnswer(name: string): string | undefined {
  const later = laterOf(name);
  if (!later) return undefined;
  const { asked, found } = later;
  const version = `${found.library} ${libraries[found.library]}`;
  return `${asked} is not in ${version}, the version installed: only the development docs, which describe a later release, have it. In ${libraries[found.library]}, ${found.route}.`;
}

/** Each name a later release adds, for the library's words a script fails with. */
export const allLaterNames = laterNames.flatMap((one) => one.names);
