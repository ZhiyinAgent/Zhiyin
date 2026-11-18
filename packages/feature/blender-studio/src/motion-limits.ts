/**
 * The limits a motion is held to. Each tool's schema and description state
 * the ones its inputs reach, and Blender refuses a call past one, naming the
 * limit and how to work within it.
 */

import { statedNumbers } from "./stated-numbers.js";

/** The longest a timeline runs, in seconds: no time a motion input names reaches past it. */
export const longestTimeline = 600;

/** The most objects a frame sheet follows, and a close-up sheet draws. */
export const mostFollowed = 8;

/** The longest formula a part follows another by, in characters. */
export const longestFormula = 500;

/** The sentence the video tool's description states its longest video in. */
export const longestVideoStated = `A video lasts at most ${statedNumbers.video.longest_video} s: render a longer one in parts, each with its own start and end.`;
