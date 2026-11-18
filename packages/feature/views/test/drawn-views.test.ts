import { describe, expect, it } from "vitest";
import type { ViewCheckOutcome, ViewCheckRequest } from "@zhiyin/contract";
import { PendingViewChecks } from "../src/index.js";

/** Asks one question and answers it with `outcome`, as the window would. */
async function answered(outcome: unknown): Promise<ViewCheckOutcome> {
  const requests: ViewCheckRequest[] = [];
  const checks = new PendingViewChecks({
    ask: (request) => requests.push(request),
  });
  const answer = checks.validate("bar-chart", "{}");
  checks.answer(requests[0]!.id, outcome as ViewCheckOutcome);
  return answer;
}

const png = { mediaType: "image/png", data: "iVBORw0KGgo=" };

describe("what the window says it drew", () => {
  it("carries what was drawn and its picture back with the answer", async () => {
    const drawn = { facts: ["Drawn 720 × 360 px."], picture: png };

    await expect(answered({ ok: true, drawn })).resolves.toEqual({
      ok: true,
      drawn,
    });
  });

  it("carries the drawing as a file back with the answer, as an SVG of up to 2 MiB or not at all", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const facts = ["Drawn."];
    const huge = `<svg>${"x".repeat(2 * 1024 * 1024)}</svg>`;

    await expect(
      answered({ ok: true, drawn: { facts, svg } }),
    ).resolves.toEqual({ ok: true, drawn: { facts, svg } });
    for (const given of [huge, "<html></html>", 42])
      await expect(
        answered({ ok: true, drawn: { facts, svg: given } }),
      ).resolves.toEqual({ ok: true, drawn: { facts } });
  });

  it("keeps the first 60 facts, each up to 1,000 characters, and says how many it left out", async () => {
    const facts = Array.from({ length: 64 }, (_, index) =>
      index === 0 ? "x".repeat(1_200) : `Fact ${index}.`,
    );

    const outcome = await answered({ ok: true, drawn: { facts } });

    if (!outcome.ok) throw new Error("refused");
    expect(outcome.drawn?.facts).toHaveLength(61);
    expect(outcome.drawn?.facts[0]).toBe(`${"x".repeat(1_000)}…`);
    expect(outcome.drawn?.facts[59]).toBe("Fact 59.");
    expect(outcome.drawn?.facts[60]).toBe("4 more facts were left out.");
  });

  it.each([
    [
      "a picture that is not a PNG",
      { mediaType: "image/svg+xml", data: "PHN2Zz4=" },
    ],
    ["a picture that is not base64", { mediaType: "image/png", data: "<svg>" }],
    [
      "a picture over 8 MB",
      { mediaType: "image/png", data: "A".repeat(8 * 1024 * 1024 + 4) },
    ],
  ])("drops %s and keeps the facts", async (_, picture) => {
    await expect(
      answered({ ok: true, drawn: { facts: ["Drawn."], picture } }),
    ).resolves.toEqual({ ok: true, drawn: { facts: ["Drawn."] } });
  });

  it("drops what was drawn when it is not a list of sentences, and still accepts the view", async () => {
    await expect(
      answered({ ok: true, drawn: { facts: [{ text: "x" }] } }),
    ).resolves.toEqual({ ok: true });
    await expect(answered({ ok: true, drawn: "a chart" })).resolves.toEqual({
      ok: true,
    });
  });
});
