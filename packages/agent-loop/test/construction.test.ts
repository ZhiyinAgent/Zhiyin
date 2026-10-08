import { describe, expect, it } from "vitest";
import { AgentLoop, type AgentLoopDependencies } from "../src/index.js";

describe("AgentLoop", () => {
  it("can be constructed with no real feature present", () => {
    // Nothing here is real, and nothing needs to be: constructing the loop
    // must not reach for a filesystem, a process or a network.
    const nothing = {} as AgentLoopDependencies;
    const loop = new AgentLoop(nothing);
    expect(loop).toBeInstanceOf(AgentLoop);
  });
});
