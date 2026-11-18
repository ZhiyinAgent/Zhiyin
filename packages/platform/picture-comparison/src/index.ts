/**
 * How two pictures' pixels differ, and the sheet that shows it. Plain
 * arithmetic on pixels already drawn, run on a thread of its own in the app,
 * so it decodes nothing and imports nothing that does.
 */

export type { Pixels } from "./pixels.js";
export type { Difference, Rect } from "./picture-difference.js";
export type { Averages } from "./averages.js";
export {
  ComparisonThreads,
  comparedHere,
  serveComparisons,
  type Comparison,
  type ComparisonThread,
  type ComparedSize,
  type DrawnPart,
  type PixelComparer,
} from "./pixel-comparer.js";
