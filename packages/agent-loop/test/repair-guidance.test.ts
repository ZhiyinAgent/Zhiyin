import { describe, expect, it } from "vitest";
import {
  preservesContent,
  repairContextLines,
  repairDecisionFrom,
  repairLimits,
} from "../src/repair-guidance.js";

function base() {
  return {
    userIntent: "Change the owner on the brief to Kim.",
    toolName: "multi_edit",
    toolDescription: "Replace exact text in workspace files.",
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
    recent: [
      {
        action: "Read a workspace file",
        target: "brief.md",
        status: "completed",
        evidence: '{"text":"Owner: Rowan\\nStatus: draft"}',
      },
    ],
  };
}

describe("repairContextLines", () => {
  it("shows the refused call, the reason, and what was just observed", () => {
    const text = (repairContextLines(base()) ?? []).join("\n");

    expect(text).toContain("Owner: Dana");
    expect(text).toContain("was not found in brief.md");
    // The evidence that makes the fix possible: what the file actually holds,
    // from an action that already ran.
    expect(text).toContain("Owner: Rowan");
    expect(text).toContain("must not change these fields");
    expect(text).toContain("replace");
  });

  it("tells the small model that handing back is a real answer", () => {
    const text = (repairContextLines(base()) ?? []).join("\n");

    expect(text).toContain("handover");
    expect(text).toContain(
      "Hand back whenever the evidence does not settle it",
    );
  });

  it("keeps only the most recent observations and stays within budget", () => {
    const lines =
      repairContextLines({
        ...base(),
        recent: Array.from({ length: 30 }, (_, index) => ({
          action: "Read a workspace file",
          target: `file-${index}.md`,
          status: "completed",
          evidence: `contents of file ${index}. `.repeat(60),
        })),
      }) ?? [];

    const text = lines.join("\n");
    expect(text.length).toBeLessThanOrEqual(repairLimits.total);
    expect(text).toContain("file-29.md");
    expect(text).not.toContain("file-0.md");
  });

  it("refuses to describe a call too large to show in full", () => {
    expect(
      repairContextLines({
        ...base(),
        failedArguments: "x".repeat(repairLimits.arguments + 1),
      }),
    ).toBeUndefined();
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
