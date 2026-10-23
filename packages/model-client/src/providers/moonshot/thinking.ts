/**
 * The models whose thinking is switched by `thinking.type`. K3 takes
 * `reasoning_effort` instead, and K2.7 Code takes nothing; neither is to be
 * sent `thinking`.
 */
export const thinkingSwitched: ReadonlySet<string> = new Set(["kimi-k2.6"]);
