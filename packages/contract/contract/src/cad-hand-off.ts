/*
 * What the CAD studio hands the 3D studio in files: the marks on each part's
 * mesh in a .glb it writes, and the motion file it writes for a mechanism or
 * an assembly sequence. Both studios run in Python and keep their own copies
 * of these names; each side's tests hold its copy to this one.
 */

/** The keys of the extras the CAD studio writes on each part's mesh in a .glb. */
export const CAD_PART_EXTRAS = {
  /** The part's name: its shape changes only through the CAD studio. */
  part: "zhiyin_cad_part",
  /** Its exact size along its own axes, in metres, which its facets only approach. */
  size: "zhiyin_cad_size",
  /** The group of surfaces each of its primitives draws, in order, "" for the rest. */
  surfaces: "zhiyin_surfaces",
} as const;

/** A CAD part's mesh extras. A part with no groups of surfaces has no `surfaces`. */
export type CadPartExtras = {
  readonly [CAD_PART_EXTRAS.part]: string;
  readonly [CAD_PART_EXTRAS.size]: readonly [number, number, number];
  readonly [CAD_PART_EXTRAS.surfaces]?: readonly string[];
};

/** The motion file's format, written in its `motion` field. */
export const CAD_MOTION_FORMAT = 1;

/** A motion file, as JSON: where each part that moves is at each position. */
export type CadMotionFile = {
  readonly motion: typeof CAD_MOTION_FORMAT;
  /** Each position's arguments to the script, or an assembly step's name. */
  readonly positions: readonly (readonly string[])[];
  /**
   * For each part that moves, by name, how it is moved at each position from
   * the part as built: a 4 × 4 matrix, row by row, in millimetres.
   */
  readonly parts: Readonly<Record<string, readonly (readonly number[])[]>>;
  /** Parts that change shape in a way no move, turn and stretch gives, each with why. */
  readonly unfitted: Readonly<Record<string, string>>;
  /** How many parts stay put. */
  readonly still: number;
  /** An assembly sequence: each part goes straight from one position to the next. */
  readonly straight?: true;
};
