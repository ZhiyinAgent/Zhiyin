import { describe, expect, it } from "vitest";
import { conversationOfScope, conversationScope } from "../src/index.js";

describe("a conversation's own scope", () => {
  it("names the conversation it belongs to", () => {
    expect(conversationOfScope(conversationScope("c7"))).toBe("c7");
  });

  it("is told apart from everything the person does and from a project", () => {
    expect([
      conversationOfScope("everything"),
      conversationOfScope("p-1f2e"),
    ]).toEqual([undefined, undefined]);
  });
});
