/**
 * The judge: one request for every item it is asked about, evidence from this
 * turn's calls kept whole, read-only tools to check for itself, and a verdict
 * that says which of three things it is. ADR 0053.
 */

import { describe, expect, it } from "vitest";
import type { ModelRequest } from "@zhiyin/model-client";
import { verdictsFrom } from "../src/plan-judge.js";
import {
  notices,
  reviewedIds,
  until,
  withPlan,
  type Call,
  type Review,
  type Step,
} from "./plan-fixture.js";

const threeItems = {
  items: [
    { title: "List the reports", criterion: "The reports were listed." },
    { title: "Read the totals", criterion: "The totals were read." },
    { title: "Write the summary", criterion: "summary.md names every report." },
  ],
};
const fourItems = {
  items: [
    ...threeItems.items,
    { title: "Check the dates", criterion: "Every report's date was read." },
  ],
};

const listing = (id: string, path: string, planItem?: string): Step => ({
  calls: [
    {
      name: "list_directory",
      args: { path, ...(planItem ? { plan_item: planItem } : {}) },
      id,
    },
  ],
});
const claimDone = (id: string, item: string, cited: string): Step => ({
  calls: [
    {
      name: "update_plan",
      args: {
        items: [
          {
            id: item,
            progress: "done",
            evidence: [{ call_id: cited, shows: "The listing names q1.pdf." }],
          },
        ],
      },
      id,
    },
  ],
});
const finish: Step = { text: "Done." };

const plan = (fixture: ReturnType<typeof withPlan>) =>
  fixture.loop.snapshot().tasks[0]?.plan ?? [];
const reviewText = (request: ModelRequest | undefined) =>
  (request?.messages ?? [])
    .filter((message) => message.role === "user")
    .map((message) => String(message.content))
    .join("\n");
const allVerdicts = (
  request: ModelRequest,
  verdict: "verified" | "not-verified",
): Review => ({
  verdicts: reviewedIds(request).map((id) => ({
    id,
    verdict,
    reason: `${verdict} by the reviewer.`,
  })),
});

describe("when the judge runs", () => {
  it("makes no judge request between 20 calls and exactly one at the end", async () => {
    const fixture = withPlan({
      plan: threeItems,
      script: (request) =>
        request <= 20
          ? listing(`c${request}`, `folder-${request}`, "plan-1")
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    const worked = fixture.log.lastIndexOf("work");
    expect(fixture.log.filter((entry) => entry === "review")).toHaveLength(1);
    expect(fixture.log.indexOf("review")).toBeGreaterThan(worked);
    expect(plan(fixture).map((item) => item.status)).toEqual([
      "needs-attention",
      "needs-attention",
      "needs-attention",
    ]);
  });

  it("judges a claim of done while the worker carries on", async () => {
    let answer: (() => void) | undefined;
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? listing("c1", "reports", "plan-1")
          : request === 2
            ? claimDone("u1", "plan-1", "c1")
            : request <= 4
              ? listing(`c${request}`, `folder-${request}`)
              : finish,
      review: async (request, number) => {
        if (number === 1) await new Promise<void>((go) => (answer = go));
        return allVerdicts(request, "verified");
      },
    });
    const taskId = await fixture.loop.createTask();

    const running = fixture.loop.start(taskId, "Summarise the reports");
    await until(() => fixture.requests.length >= 4);

    // The worker's fourth request went out with the first review unanswered.
    expect(answer).toBeDefined();
    expect(plan(fixture)[0]).toMatchObject({
      progress: "done",
      status: "checking",
    });
    answer!();
    await running;

    expect(reviewedIds(fixture.reviews[0]!)).toEqual(["plan-1"]);
    expect(plan(fixture)[0]?.status).toBe("verified");
    // The end of the turn asks only about the item still open.
    expect(reviewedIds(fixture.reviews.at(-1)!)).toEqual(["plan-2"]);
  });

  it("stores four verdicts from one request for four pending items", async () => {
    const fixture = withPlan({
      plan: fourItems,
      script: () => finish,
      review: (request) => ({
        verdicts: reviewedIds(request).map((id, index) => ({
          id,
          verdict: index % 2 ? "not-verified" : "verified",
          reason: `Reason for ${id}.`,
        })),
      }),
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(fixture.reviews).toHaveLength(1);
    // The least thinking, and room for every verdict above the answer floor.
    expect(fixture.reviews[0]?.reasoning).toEqual({
      enabled: true,
      effort: "minimal",
    });
    expect(fixture.reviews[0]?.maximumOutputTokens).toBe(800 + 4 * 150);
    expect(
      plan(fixture).map((item) => [item.status, item.verification]),
    ).toEqual([
      ["verified", "Reason for plan-1."],
      ["needs-attention", "Reason for plan-2."],
      ["verified", "Reason for plan-3."],
      ["needs-attention", "Reason for plan-4."],
    ]);
  });

  it("asks once more, on its own, about an item the answer left out", async () => {
    const fixture = withPlan({
      plan: fourItems,
      script: () => finish,
      review: (request, number) => {
        const ids = reviewedIds(request);
        return {
          verdicts: (number === 1 ? ids.slice(0, 3) : ids).map((id) => ({
            id,
            verdict: "verified" as const,
            reason: `Seen in request ${number}.`,
          })),
        };
      },
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(fixture.reviews.map(reviewedIds)).toEqual([
      ["plan-1", "plan-2", "plan-3", "plan-4"],
      ["plan-4"],
    ]);
    expect(plan(fixture)[3]).toMatchObject({
      status: "verified",
      verification: "Seen in request 2.",
    });
  });
});

describe("what the judge is given", () => {
  it("verifies an item whose only proof is the 10th of 20 actions", async () => {
    const filler = "An unrelated line of listing output. ".repeat(20);
    const fixture = withPlan({
      plan: threeItems,
      script: (request) =>
        request <= 20
          ? listing(`c${request}`, `folder-${request}`, "plan-2")
          : finish,
      listing: (path) =>
        path === "folder-10" ? `TOTALS-MATCH ${filler}` : filler,
      review: (request) => ({
        verdicts: reviewedIds(request).map((id) => ({
          id,
          verdict:
            id === "plan-2" && reviewText(request).includes("TOTALS-MATCH")
              ? ("verified" as const)
              : ("not-verified" as const),
          reason: "Judged from the calls.",
        })),
      }),
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(plan(fixture)[1]?.status).toBe("verified");
  });

  it("gives the person's request, and the claim as the worker's, not as evidence", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? listing("c1", "reports", "plan-1")
          : request === 2
            ? claimDone("u1", "plan-1", "c1")
            : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the quarterly reports");

    const text = reviewText(fixture.reviews[0]);
    expect(text).toContain("Summarise the quarterly reports");
    expect(text).toMatch(/worker's claim, not evidence/i);
    expect(text).toContain("The listing names q1.pdf.");
  });

  it("names what did not fit rather than cutting it from the middle", async () => {
    const big = "x".repeat(6_000);
    const fixture = withPlan({
      script: (request) =>
        request <= 12 ? listing(`c${request}`, `folder-${request}`) : finish,
      listing: (path) => `${path.toUpperCase()}-START ${big}`,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    const text = reviewText(fixture.reviews[0]);
    const shown = [...text.matchAll(/FOLDER-(\d+)-START/g)].length;
    expect(shown).toBeLessThan(12);
    expect(text).toMatch(/not shown/i);
    expect(text).toContain("open_call");
    expect(text).not.toContain("evidence shortened");
  });
});

describe("the judge checks for itself", () => {
  it("opens a file with read_file to verify what the results alone do not show", async () => {
    const fixture = withPlan({
      plan: {
        items: [
          {
            title: "Save the report",
            criterion: "reports/q3.md holds the totals table.",
          },
        ],
      },
      files: { "reports/q3.md": "| Quarter | Total |\n| Q3 | 1,204 |" },
      script: (request) =>
        request === 1
          ? {
              calls: [
                {
                  name: "write_note",
                  args: { path: "reports/q3.md", plan_item: "plan-1" },
                  id: "c1",
                },
              ],
            }
          : finish,
      review: (request, number) => {
        if (number === 1)
          return {
            calls: [
              { name: "read_file", args: { path: "reports/q3.md" }, id: "r1" },
            ],
          };
        const opened = request.messages.find(
          (message) => message.role === "tool" && message.toolCallId === "r1",
        );
        return {
          verdicts: [
            {
              id: "plan-1",
              verdict: String(opened?.content).includes("1,204")
                ? "verified"
                : "not-verified",
              reason: "Opened reports/q3.md.",
            },
          ],
        };
      },
    });
    const taskId = await fixture.loop.createTask();
    const running = fixture.loop.start(taskId, "Write the Q3 report");
    await until(
      () => fixture.loop.snapshot().tasks[0]?.phase.kind === "approval",
    );
    const phase = fixture.loop.snapshot().tasks[0]?.phase;
    if (phase?.kind === "approval")
      await fixture.loop.resolveApproval(taskId, phase.prompt.id, "allow");
    await running;

    expect(fixture.executed).toContain("review:read_file");
    expect(plan(fixture)[0]?.status).toBe("verified");
    // The judge's reading is not an action of the conversation.
    expect(fixture.loop.snapshot().tasks[0]?.actions).toHaveLength(1);
  });

  it("is offered no tool that changes anything, and cannot run one", async () => {
    const fixture = withPlan({
      script: () => finish,
      review: (request, number) =>
        number === 1
          ? {
              calls: [
                {
                  name: "write_note",
                  args: { path: "summary.md" },
                  id: "r1",
                } satisfies Call,
              ],
            }
          : allVerdicts(request, "not-verified"),
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    const offered = (fixture.reviews[0]?.tools ?? []).map((tool) => tool.name);
    expect(offered).toContain("read_file");
    expect(offered).toContain("list_directory");
    expect(offered).not.toContain("write_note");
    expect(offered).not.toContain("update_plan");
    expect(fixture.executed).not.toContain("review:write_note");
    const refused = fixture.reviews[1]?.messages.find(
      (message) => message.role === "tool" && message.toolCallId === "r1",
    );
    expect(String(refused?.content)).toMatch(/not available/i);
  });

  it("opens a call the prompt left out with open_call", async () => {
    const big = "y".repeat(6_000);
    const fixture = withPlan({
      script: (request) =>
        request <= 12 ? listing(`c${request}`, `folder-${request}`) : finish,
      listing: (path) => `${path.toUpperCase()}-START ${big}`,
      review: (request, number) =>
        number === 1
          ? {
              calls: [{ name: "open_call", args: { call_id: "c1" }, id: "o1" }],
            }
          : allVerdicts(request, "not-verified"),
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    const opened = fixture.reviews[1]?.messages.find(
      (message) => message.role === "tool" && message.toolCallId === "o1",
    );
    expect(String(opened?.content)).toContain("FOLDER-1-START");
  });
});

describe("what a verdict says", () => {
  it("reads one verdict per id asked about, and none for an id given twice", () => {
    const verdicts = verdictsFrom(
      JSON.stringify({
        items: [
          {
            id: "plan-1",
            verdict: "verified",
            reason: "Seen.",
            evidence: ["c1"],
          },
          { id: "plan-2", verdict: "not-verified", reason: "One." },
          { id: "plan-2", verdict: "verified", reason: "Two." },
          { id: "plan-9", verdict: "verified", reason: "Not asked." },
          { id: "plan-3", verdict: "probably", reason: "Unknown verdict." },
          { id: "plan-3", verdict: "verified", reason: "  " },
        ],
      }),
      ["plan-1", "plan-2", "plan-3"],
    );
    expect([...(verdicts ?? new Map())]).toEqual([
      ["plan-1", { verdict: "verified", reason: "Seen.", evidence: ["c1"] }],
    ]);
    expect(verdictsFrom("Looks fine.", ["plan-1"])).toBeUndefined();
    expect(verdictsFrom('{"items":[]}', ["plan-1"])).toBeUndefined();
  });

  it("reports a failed judge request as couldn't judge, with its reason", async () => {
    const fixture = withPlan({
      script: () => finish,
      review: () => ({ fail: "The provider is unreachable." }),
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    for (const item of plan(fixture)) {
      expect(item.status).toBe("couldnt-judge");
      expect(item.verification).toContain("The provider is unreachable.");
    }
  });

  it("reports an answer it cannot read, twice, as couldn't judge", async () => {
    const fixture = withPlan({
      script: () => finish,
      review: () => ({ text: "Everything looks fine to me." }),
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(fixture.reviews).toHaveLength(2);
    expect(plan(fixture).map((item) => item.status)).toEqual([
      "couldnt-judge",
      "couldnt-judge",
    ]);
  });

  it("keeps the calls a verified verdict relied on", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1 ? listing("c1", "reports", "plan-1") : finish,
      review: (request) => ({
        verdicts: reviewedIds(request).map((id) => ({
          id,
          verdict: "verified" as const,
          reason: "The listing names both reports.",
          evidence: ["c1", "made-up"],
        })),
      }),
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(plan(fixture)[0]?.verdictEvidence).toEqual(["c1"]);
  });
});

describe("a gap goes back to the model", () => {
  it("puts exactly one gaps notice in the request after a not-verified verdict", async () => {
    const fixture = withPlan({
      script: (request, sent) =>
        request === 1
          ? listing("c1", "reports", "plan-1")
          : request === 2
            ? claimDone("u1", "plan-1", "c1")
            : request < 12 && notices(sent, "gaps").length === 0
              ? listing(`c${request}`, `folder-${request}`)
              : request < 14
                ? listing(`c${request}`, `later-${request}`)
                : finish,
      review: (request) => ({
        verdicts: reviewedIds(request).map((id) => ({
          id,
          verdict: "not-verified" as const,
          reason: "No call compared the totals with the CSV.",
        })),
      }),
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    const last = fixture.requests.at(-1);
    const gaps = notices(last, "gaps");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.content).toContain("plan-1");
    expect(gaps[0]?.content).toContain(
      "No call compared the totals with the CSV.",
    );
  });

  it("keeps every write when a verdict lands while an action is being saved", async () => {
    const fixture = withPlan({
      savesSlowly: true,
      script: (request) =>
        request === 1
          ? listing("c1", "reports", "plan-1")
          : request === 2
            ? claimDone("u1", "plan-1", "c1")
            : request <= 8
              ? listing(`c${request}`, `folder-${request}`)
              : finish,
      review: (request) => allVerdicts(request, "verified"),
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    const task = fixture.loop.snapshot().tasks[0];
    expect(task?.actions?.map((action) => action.status)).toEqual(
      Array(7).fill("completed"),
    );
    expect(task?.plan?.map((item) => item.status)).toEqual([
      "verified",
      "verified",
    ]);
    // A verdict overwritten by a stale save would be asked for again here.
    expect(fixture.reviews.map(reviewedIds)).toEqual([["plan-1"], ["plan-2"]]);
  });
});
