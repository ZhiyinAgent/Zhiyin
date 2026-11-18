/**
 * The requirements file both studios measure a design against: its format
 * and kinds, sizes as ranges, and the verdicts an answer gives. The studios
 * read the file and measure; this computes and does nothing else.
 */

export {
  readRequirements,
  requirementLimits,
  largestFile,
  type Requirement,
} from "./file.js";
export {
  requirementKinds,
  kindsOf,
  MATERIALS,
  type Kind,
  type KindName,
  type Kinds,
} from "./kinds.js";
export { sceneKinds } from "./scene-kinds.js";
export * as fieldRules from "./fields.js";
export type { FieldRule } from "./fields.js";
export { reviewBrief, type Reviewed } from "./brief.js";
export { rangeMargin, rangeWords, type Range } from "./ranges.js";
export {
  checkedIn,
  keptOf,
  lastOf,
  verdictDetail,
  verdictLines,
  type Checked,
  type Last,
  type Says,
  type Verdicts,
} from "./verdicts.js";
