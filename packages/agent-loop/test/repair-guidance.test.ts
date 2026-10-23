import { describe, expect, it } from "vitest";
import {
  recentCalls,
  repairDecisionFrom,
  repairLimits,
  repairPrompt,
  shortened,
} from "../src/tools/repair-guidance.js";

const call = {
  edits: [
    {
      path: "brief.md",
      replacements: [{ find: "Owner: Dana", replace: "Owner: Kim" }],
    },
  ],
};

function base() {
  return {
    userIntent: "Change the owner on the brief to Kim.",
    toolName: "multi_edit",
    toolDescription: "Replace exact text in workspace files.",
    schema: {
      type: "object",
      properties: { edits: { type: "array" } },
    },
    faulty: [
      { path: "edits[0].replacements[0].find", value: "Owner: Dana" },
    ] as { path: string; value?: unknown }[],
    reference: shortened(call),
    reason: "“Owner: Dana” was not found in brief.md.",
    roundText: "I will update the owner line.",
    roundReasoning: "",
    recent: [
      {
        name: "read_file",
        arguments: '{"path":"brief.md"}',
        result: '{"text":"Owner: Rowan\\nStatus: draft"}',
      },
    ],
  };
}

function promptText(input: Parameters<typeof repairPrompt>[0]) {
  const prompt = repairPrompt(input);
  return prompt ? `${prompt.system}\n${prompt.user}` : "";
}

describe("repairPrompt", () => {
  it("shows the inputs at fault, the reason, the schema, and what was just observed", () => {
    const text = promptText(base());

    expect(text).toContain('{"edits[0].replacements[0].find":"Owner: Dana"}');
    expect(text).toContain("was not found in brief.md");
    expect(text).toContain('"properties"');
    // The evidence that makes the fix possible: what the file actually holds,
    // from a call that already ran, and what the model meant to do.
    expect(text).toContain("Owner: Rowan");
    expect(text).toContain("I will update the owner line.");
  });

  it("names the inputs it may change, and says nothing else is taken", () => {
    const system = repairPrompt(base())?.system ?? "";

    expect(system).toContain(
      "You may change only these inputs of the call, named by where they sit in it: edits[0].replacements[0].find.",
    );
    expect(system).toContain("Nothing else is taken from your answer");
    expect(system).toContain("cannot read, run or ask anything");
  });

  it("says an input the call left out is left out", () => {
    const text = promptText({
      ...base(),
      faulty: [{ path: "subject" }],
    });

    expect(text).toContain('{"subject":"(left out)"}');
  });

  it("tells the repairer that handing back is a real answer", () => {
    const text = promptText(base());

    expect(text).toContain("handover");
    expect(text).toContain(
      "Hand back whenever the evidence does not settle it",
    );
  });

  it("keeps only the most recent calls and stays within budget", () => {
    const prompt = repairPrompt({
      ...base(),
      recent: Array.from({ length: 3 }, (_, index) => ({
        name: "read_file",
        arguments: JSON.stringify({ path: `file-${index}.md` }),
        result: `contents of file ${index}. `.repeat(60),
      })),
      faulty: [
        { path: "find", value: "x".repeat(repairLimits.arguments - 20) },
      ],
      toolDescription: "d".repeat(5_000),
    });

    const text = `${prompt?.system}\n${prompt?.user}`;
    expect(text.length).toBeLessThanOrEqual(repairLimits.total);
    expect(text).toContain("file-2.md");
    expect(text).not.toContain("file-0.md");
  });

  it("refuses to describe inputs at fault too large to show in full", () => {
    expect(
      repairPrompt({
        ...base(),
        faulty: [{ path: "find", value: "x".repeat(repairLimits.arguments) }],
      }),
    ).toBeUndefined();
  });
});

describe("shortened", () => {
  it("keeps the start of each long text and says how long it was", () => {
    const text = shortened({ find: "short", replace: "y".repeat(500) });

    expect(text).toContain('"find":"short"');
    expect(text).toContain(`${"y".repeat(200)}… (500 characters)`);
    expect(text).not.toContain("y".repeat(201));
  });

  it("shortens a long list or object of short texts the same way", () => {
    const lines = Array.from({ length: 300 }, (_, index) => `line ${index}`);
    const text = shortened({ path: "a.md", lines, meta: { lines } });

    expect(text).toContain('"path":"a.md"');
    expect(text).not.toContain("line 299");
    expect(text.length).toBeLessThan(700);
    expect(text).toMatch(/\(\d[\d,]* characters\)/);
  });
});

describe("recentCalls", () => {
  it("pairs each call with its result, newest last, at most three", () => {
    const calls = recentCalls([
      {
        role: "assistant",
        content: "",
        toolCalls: [1, 2, 3, 4].map((n) => ({
          id: `c${n}`,
          name: "read_file",
          arguments: `{"n":${n}}`,
        })),
      },
      ...[1, 2, 3].map((n) => ({
        role: "tool" as const,
        toolCallId: `c${n}`,
        name: "read_file",
        content: `result ${n}`,
      })),
    ]);

    expect(calls.map((call) => call.result)).toEqual([
      "result 1",
      "result 2",
      "result 3",
    ]);
    expect(calls[0]?.arguments).toBe('{"n":1}');
  });
});

describe("repairDecisionFrom", () => {
  it("reads a repair and a handover, and rejects anything else", () => {
    expect(
      repairDecisionFrom(
        '{"action":"repair","fields":{"find":"Owner: Rowan"},"remove":["text"]}',
      ),
    ).toEqual({
      kind: "repair",
      set: { find: "Owner: Rowan" },
      remove: ["text"],
    });
    expect(repairDecisionFrom('{"action":"repair","fields":{"a":1}}')).toEqual({
      kind: "repair",
      set: { a: 1 },
      remove: [],
    });
    expect(
      repairDecisionFrom('{"action":"handover","reason":"Ambiguous."}'),
    ).toEqual({ kind: "handover", reason: "Ambiguous." });

    expect(repairDecisionFrom("not json")).toBeUndefined();
    // A repair that changes nothing is no answer.
    expect(repairDecisionFrom('{"action":"repair"}')).toBeUndefined();
    expect(repairDecisionFrom('{"action":"delete"}')).toBeUndefined();
    expect(
      repairDecisionFrom('{"action":"repair","fields":"nope"}'),
    ).toBeUndefined();
    expect(
      repairDecisionFrom('{"action":"repair","fields":{},"remove":[1]}'),
    ).toBeUndefined();
  });
});
