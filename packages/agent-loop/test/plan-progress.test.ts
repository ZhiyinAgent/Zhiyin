/**
 * The working model keeps its own plan: it sends the whole list, the list is
 * corrected rather than refused, and it is reminded once of what it left open.
 * Nothing judges the plan. ADR 0013.
 */

import { describe, expect, it } from "vitest";
import { notices, resultOf, withPlan, type Step } from "./plan-fixture.js";

const update = (id: string, items: readonly unknown[]): Step => ({
  calls: [{ name: "update_plan", args: { items }, id }],
});
const finish: Step = { text: "Done." };

const plan = (fixture: ReturnType<typeof withPlan>) =>
  fixture.loop.snapshot().tasks[0]?.plan ?? [];

describe("update_plan", () => {
  it("replaces the plan with the list the model sends, in its order", async () => {
    const fixture = withPlan({
      script: (request) =>
        [
          update("first", [
            { title: "List the reports", status: "in_progress" },
            { title: "Write the summary", status: "pending" },
          ]),
          update("second", [
            { title: "List the reports", status: "done" },
            { title: "Check the totals", status: "in_progress" },
            { title: "Write the summary", status: "pending" },
          ]),
        ][request - 1] ?? finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    expect(plan(fixture)).toEqual([
      { id: "plan-1", title: "List the reports", status: "done" },
      { id: "plan-2", title: "Check the totals", status: "in_progress" },
      { id: "plan-3", title: "Write the summary", status: "pending" },
    ]);
  });

  it("keeps only the first item in progress", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? update("update", [
              { title: "Read the brief", status: "in_progress" },
              { title: "Draft the report", status: "in_progress" },
            ])
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Write the report");

    expect(plan(fixture).map((item) => item.status)).toEqual([
      "in_progress",
      "pending",
    ]);
  });

  it("corrects an update instead of refusing it: untitled entries dropped, an unknown status read as pending, at most eight items", async () => {
    const items = [
      { title: "Step one", status: "done" },
      { status: "done" },
      { title: "Step two", status: "wip" },
      ...Array.from({ length: 9 }, (_, index) => ({
        title: `Later step ${index + 1}`,
        status: "pending",
      })),
    ];
    const fixture = withPlan({
      script: (request) => (request === 1 ? update("update", items) : finish),
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Do the steps");

    expect(resultOf(fixture.requests[1], "update")).toMatchObject({ ok: true });
    expect(plan(fixture).map((item) => [item.title, item.status])).toEqual([
      ["Step one", "done"],
      ["Step two", "pending"],
      ...Array.from({ length: 6 }, (_, index) => [
        `Later step ${index + 1}`,
        "pending",
      ]),
    ]);
  });

  it("keeps a title up to 200 characters whole, ends a longer one at a whole word with no ellipsis, and tells the model the limit", async () => {
    const whole =
      "Collecter et vérifier les sources officielles (programme de cycle 1, textes réglementaires, rapports IGESR)";
    const long = "word ".repeat(50).trim();
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? update("update", [
              { title: whole, status: "in_progress" },
              { title: long, status: "pending" },
            ])
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Write the report");

    expect(whole.length).toBeGreaterThan(72);
    expect(plan(fixture)[0]?.title).toBe(whole);
    const cut = plan(fixture)[1]?.title ?? "";
    expect(cut.length).toBeLessThanOrEqual(200);
    expect(cut).toBe("word ".repeat(40).trim());
    expect(cut).not.toMatch(/…|\.\.\.$/);
    const tool = fixture.requests[0]?.tools.find(
      (item) => item.name === "update_plan",
    );
    expect(JSON.stringify(tool?.inputSchema)).toContain('"maxLength":200');
  });

  it("refuses only an update that sends no list, and changes nothing", async () => {
    const fixture = withPlan({
      script: (request) =>
        [
          update("set", [{ title: "Read the brief", status: "pending" }]),
          { calls: [{ name: "update_plan", args: {}, id: "empty" }] },
        ][request - 1] ?? finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Write the report");

    expect(resultOf(fixture.requests[2], "empty")).toMatchObject({
      ok: false,
    });
    expect(plan(fixture)).toEqual([
      { id: "plan-1", title: "Read the brief", status: "pending" },
    ]);
  });

  it("asks for no ids, criteria or evidence", async () => {
    const fixture = withPlan({ script: () => finish });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");

    const tool = fixture.requests[0]?.tools.find(
      (item) => item.name === "update_plan",
    );
    expect(tool).toBeDefined();
    expect(JSON.stringify(tool?.inputSchema)).not.toMatch(
      /evidence|criterion|call_id|"id"/,
    );
  });
});

describe("the plan across a turn", () => {
  it("reminds the model once of the items it would leave open, then lets it finish", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? update("set", [
              { title: "Read the brief", status: "done" },
              { title: "Draft the report", status: "in_progress" },
              { title: "Proofread", status: "pending" },
            ])
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Write the report");

    expect(fixture.requests).toHaveLength(3);
    const [reminder] = notices(fixture.requests[2], "plan");
    expect(reminder?.content).toContain("Draft the report");
    expect(reminder?.content).toContain("Proofread");
    expect(reminder?.content).not.toContain("Read the brief");
    expect(fixture.loop.snapshot().tasks[0]?.phase).not.toBe("running");
  });

  const reads = (request: number): Step => ({
    calls: [
      {
        name: "read_file",
        args: { path: `part-${request}.md` },
        id: `r${request}`,
      },
    ],
  });
  const parts = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [`part-${index + 1}.md`, "text"]),
  );

  it("asks after four rounds of work with no update whether the step in progress has finished, and again only four rounds later", async () => {
    const fixture = withPlan({
      files: parts,
      script: (request) =>
        request === 1
          ? update("set", [
              { title: "Read the parts", status: "in_progress" },
              { title: "Write the summary", status: "pending" },
            ])
          : request <= 9
            ? reads(request)
            : request === 10
              ? update("close", [
                  { title: "Read the parts", status: "done" },
                  { title: "Write the summary", status: "done" },
                ])
              : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the parts");

    // Rounds 2-5 read without updating; the request after them asks.
    const asked = (request: number) =>
      notices(fixture.requests[request - 1], "plan").filter((notice) =>
        notice.content.includes("Read the parts"),
      ).length;
    expect(asked(5)).toBe(0);
    expect(asked(6)).toBe(1);
    expect(notices(fixture.requests[5], "plan").at(-1)?.content).toContain(
      "update_plan",
    );
    // Not again for the next three rounds; again after four more.
    expect(asked(9)).toBe(1);
    expect(asked(10)).toBe(2);
  });

  it("does not ask while the plan is kept current", async () => {
    const fixture = withPlan({
      files: parts,
      script: (request) =>
        request > 9
          ? finish
          : request % 2
            ? update(`u${request}`, [
                { title: `Step ${request}`, status: "done" },
                { title: `Step ${request + 1}`, status: "in_progress" },
                { title: "Last", status: "pending" },
              ])
            : reads(request),
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Do the steps");

    for (const request of fixture.requests.slice(0, 9))
      expect(
        notices(request, "plan").filter((notice) =>
          notice.content.includes("update_plan now"),
        ),
      ).toHaveLength(0);
  });

  it("does not remind when every item is done or skipped", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? update("set", [
              { title: "Read the brief", status: "done" },
              { title: "Proofread", status: "skipped" },
            ])
          : finish,
    });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Write the report");

    expect(fixture.requests).toHaveLength(2);
    expect(notices(fixture.requests[1], "plan")).toHaveLength(0);
  });

  it("shows the next turn the items still open, and nothing once all are finished", async () => {
    const fixture = withPlan({
      script: (request) =>
        request === 1
          ? update("set", [
              { title: "Read the brief", status: "done" },
              { title: "Proofread", status: "pending" },
            ])
          : request === 4
            ? update("close", [
                { title: "Read the brief", status: "done" },
                { title: "Proofread", status: "done" },
              ])
            : finish,
    });
    const taskId = await fixture.loop.createTask();

    // Requests 1-3: the plan is set, the model stops, is reminded, stops.
    await fixture.loop.start(taskId, "Write the report");
    // Requests 4-5: the plan is shown, the model finishes it.
    await fixture.loop.start(taskId, "Carry on");
    // Request 6: nothing is open, so nothing is added.
    await fixture.loop.start(taskId, "Thanks");

    expect(notices(fixture.requests[3], "plan").at(-1)?.content).toContain(
      "Proofread",
    );
    expect(notices(fixture.requests[5], "plan")).toHaveLength(
      notices(fixture.requests[4], "plan").length,
    );
  });

  it("starts a first message with one auxiliary request, to name the conversation, and a later one with none", async () => {
    const fixture = withPlan({ script: () => finish });
    const taskId = await fixture.loop.createTask();

    await fixture.loop.start(taskId, "Summarise the reports");
    const first = fixture.log.filter((entry) => entry !== "work");
    await fixture.loop.start(taskId, "And the invoices");
    const both = fixture.log.filter((entry) => entry !== "work");

    expect(first).toEqual(["other"]);
    expect(both).toEqual(["other"]);
    expect(plan(fixture)).toEqual([]);
  });
});
