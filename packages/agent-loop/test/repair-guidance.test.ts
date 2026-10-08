import { describe, expect, it } from "vitest";
import {
  keepsRawText,
  preservesContent,
  recentCalls,
  repairDecisionFrom,
  repairLimits,
  repairPrompt,
} from "../src/tools/repair-guidance.js";

function base() {
  return {
    kind: "refused" as const,
    userIntent: "Change the owner on the brief to Kim.",
    toolName: "multi_edit",
    toolDescription: "Replace exact text in workspace files.",
    schema: {
      type: "object",
      properties: { edits: { type: "array" }, replace: { type: "string" } },
    },
    failedArguments: JSON.stringify({
      edits: [
        {
          path: "brief.md",
          replacements: [{ find: "Owner: Dana", replace: "Owner: Kim" }],
        },
      ],
    }),
    reason: "“Owner: Dana” was not found in brief.md.",
    preserve: ["replace"],
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
  it("shows the refused call, the reason, the schema, and what was just observed", () => {
    const text = promptText(base());

    expect(text).toContain("Owner: Dana");
    expect(text).toContain("was not found in brief.md");
    expect(text).toContain('"properties"');
    // The evidence that makes the fix possible: what the file actually holds,
    // from a call that already ran, and what the model meant to do.
    expect(text).toContain("Owner: Rowan");
    expect(text).toContain("I will update the owner line.");
  });

  it("says which fields may change and which must not", () => {
    const system = repairPrompt(base())?.system ?? "";

    expect(system).toContain("You may change these fields: edits.");
    expect(system).toContain(
      "You must not change these fields, wherever they appear: replace.",
    );
    expect(system).toContain("cannot read, run or ask anything");
  });

  it("allows only syntax changes to input that could not be read", () => {
    const system =
      repairPrompt({ ...base(), kind: "unreadable", failedArguments: '{"a":' })
        ?.system ?? "";

    expect(system).toContain("only the JSON syntax");
    expect(system).not.toContain("You may change these fields");
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
      failedArguments: "x".repeat(repairLimits.arguments),
      toolDescription: "d".repeat(5_000),
    });

    const text = `${prompt?.system}\n${prompt?.user}`;
    expect(text.length).toBeLessThanOrEqual(repairLimits.total);
    expect(text).toContain("file-2.md");
    expect(text).not.toContain("file-0.md");
  });

  it("refuses to describe a call too large to show in full", () => {
    expect(
      repairPrompt({
        ...base(),
        failedArguments: "x".repeat(repairLimits.arguments + 1),
      }),
    ).toBeUndefined();
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

describe("keepsRawText", () => {
  const raw = '{"path":"a.md","text":"She said "hi"\\nthen left"}';

  it("accepts text found in the raw input as written or as JSON escapes it", () => {
    expect(
      keepsRawText(raw, { path: "a.md", text: 'She said "hi"\nthen left' }),
    ).toBe(true);
  });

  it("refuses a repair that changes one character of text", () => {
    expect(
      keepsRawText(raw, { path: "a.md", text: 'She said "hi"\nthen lefT' }),
    ).toBe(false);
  });
});

describe("repairDecisionFrom", () => {
  it("reads a repair and a handover, and rejects anything else", () => {
    expect(
      repairDecisionFrom('{"action":"repair","arguments":{"a":1}}'),
    ).toEqual({ kind: "repair", arguments: { a: 1 } });
    expect(
      repairDecisionFrom('{"action":"handover","reason":"Ambiguous."}'),
    ).toEqual({ kind: "handover", reason: "Ambiguous." });

    expect(repairDecisionFrom("not json")).toBeUndefined();
    expect(repairDecisionFrom('{"action":"repair"}')).toBeUndefined();
    expect(repairDecisionFrom('{"action":"delete"}')).toBeUndefined();
    // Arguments must be an object, never a bare value the tool cannot read.
    expect(
      repairDecisionFrom('{"action":"repair","arguments":"nope"}'),
    ).toBeUndefined();
  });
});

describe("preservesContent", () => {
  const original = {
    edits: [
      {
        path: "a.md",
        replacements: [
          { find: "one", replace: "ONE" },
          { find: "two", replace: "TWO" },
        ],
      },
    ],
  };

  it("allows a repair that only re-aims the edit", () => {
    const repaired = {
      edits: [
        {
          path: "docs/a.md",
          replacements: [
            { find: "one thing", replace: "ONE" },
            { find: "two things", replace: "TWO", replaceAll: true },
          ],
        },
      ],
    };

    expect(preservesContent(original, repaired, ["replace"])).toBe(true);
  });

  it("refuses a repair that changes what would be written", () => {
    const repaired = {
      edits: [
        {
          path: "a.md",
          replacements: [
            { find: "one", replace: "SOMETHING ELSE" },
            { find: "two", replace: "TWO" },
          ],
        },
      ],
    };

    expect(preservesContent(original, repaired, ["replace"])).toBe(false);
  });

  it("refuses a repair that reorders or drops the content", () => {
    const reordered = {
      edits: [
        {
          path: "a.md",
          replacements: [
            { find: "two", replace: "TWO" },
            { find: "one", replace: "ONE" },
          ],
        },
      ],
    };
    const dropped = {
      edits: [
        { path: "a.md", replacements: [{ find: "one", replace: "ONE" }] },
      ],
    };

    expect(preservesContent(original, reordered, ["replace"])).toBe(false);
    expect(preservesContent(original, dropped, ["replace"])).toBe(false);
  });
});
