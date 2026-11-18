import type { ToolOwner } from "@zhiyin/contract";

/**
 * How much of what a call declares Zhiyin answers for, by who wrote the code
 * that declared it (ADR 0012):
 *
 * - `zhiyin`: a built-in tool's, or a connection's Zhiyin ships, set so by
 *   the connection feature: all of it, its effects, the files it changes and
 *   where it reaches.
 * - `effects`: a call of a connection Zhiyin does not ship whose effects come
 *   from a built-in plugin's manifest, set so by the connection feature: its
 *   effects, and nothing else about it.
 * - `reads`: a plugin's or a skill's: only a read of what it holds.
 * - `nothing`: any other connection's: nothing it says of itself.
 *
 * The one answer to "is this Zhiyin's own word", for the permission engine
 * and the agent loop alike. A name never enters it: a tool chooses its own
 * name.
 */
export type WhoseWord = "zhiyin" | "effects" | "reads" | "nothing";

export function whoseWord(
  owner: ToolOwner,
  said: {
    readonly builtInConnection?: true | undefined;
    readonly effectsDeclaredByZhiyin?: true | undefined;
  },
): WhoseWord {
  if (owner === "built-in") return "zhiyin";
  if (owner === "skill" || owner === "plugin") return "reads";
  if (said.builtInConnection === true) return "zhiyin";
  return said.effectsDeclaredByZhiyin === true ? "effects" : "nothing";
}
