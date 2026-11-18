/**
 * How long one call of each tool may run before Blender is stopped. Each
 * tool's description states its limit, and the answer to a call that runs
 * past it names the limit and how to finish within it.
 */

import type { SceneCommand } from "./scene-session.js";

const minute = 60_000;
const minutes = (n: number) => n * minute;

// On a PC whose graphics card cannot draw, Cycles draws on the processor what
// EEVEE and the solid view would, and these limits stay as they are, because
// each such picture is bounded by something other than the processor's speed:
// a preview may draw for a second and a quick one for a quarter of one, so a
// frame sheet's 36 frames at most stay well within its 10 minutes; a look's
// views take 4 samples each; a render asked of EEVEE takes 16 samples and,
// as every large Cycles render, is timed from two small ones first and
// refused when it would run past its 30 minutes, rather than stopped there;
// and a video asked of EEVEE takes 16 samples a frame and, as every video, is
// drawn over several calls when it would not fit in one. What stays
// unbounded, reading the scene into Cycles, is the same work a Cycles render
// does on any PC without a card Cycles can use.

export const timeLimits: Readonly<
  Record<Exclude<SceneCommand, "lines">, number>
> = {
  open: minutes(3),
  add: minutes(2),
  edit: minutes(2),
  shape: minutes(2),
  material: minutes(2),
  camera: minutes(2),
  lighting: minutes(2),
  animate: minutes(2),
  settle: minutes(5),
  scatter: minutes(5),
  measure: minutes(2),
  unwrap: minutes(5),
  bake: minutes(30),
  decal: minutes(2),
  rig: minutes(5),
  simulate: minutes(30),
  script: minutes(5),
  render: minutes(30),
  video: minutes(60),
  export: minutes(5),
  describe: minutes(1),
  api: minutes(1),
  frames: minutes(10),
  closeups: minutes(10),
  look: minutes(5),
  reference: minutes(5),
};

/** A length of time as a person says it, such as "2 minutes". */
export function duration(ms: number): string {
  const [count, unit] =
    ms >= minute ? [ms / minute, "minute"] : [Math.ceil(ms / 1_000), "second"];
  return `${count.toLocaleString("en")} ${unit}${count === 1 ? "" : "s"}`;
}

/** The sentence a tool's description states its time limit in. */
export const timeLimitStated = (command: keyof typeof timeLimits) =>
  `A call may run for up to ${duration(timeLimits[command])}.`;
