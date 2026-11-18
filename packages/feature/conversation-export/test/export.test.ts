/**
 * A conversation saved as one file that leaves the computer: a page a person
 * reads, or a record another program analyses. Both have the credentials
 * Zhiyin recognises removed; the saved conversation keeps them as sent.
 */

import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  conversationExport,
  conversationHtml,
  conversationTrajectory,
  type ExportAbout,
  type PictureReader,
} from "../src/index.js";

const folders = new TemporaryFolders();

const noPictures: PictureReader = async () => ({
  status: "missing",
  reason: "No pictures here.",
});

afterEach(() => folders.removeAll());

const about: ExportAbout = {
  appVersion: "0.1.0-alpha.1",
  exportedAt: new Date("2026-10-05T12:00:00.000Z"),
};

const command = 'curl -H "Authorization: Bearer abc.def" https://example.com';

/** A conversation with a secret in a command and one in a connector call. */
function conversation(): WorkspaceTask {
  return {
    ...emptyConversationLists,
    id: "task-1",
    title: "Check the weather service",
    titleSource: "generated",
    updatedAt: "2026-10-05T11:00:00.000Z",
    updatedLabel: "Today",
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
    messages: [
      { id: "m1", role: "user", text: "Is the weather API up?", sequence: 0 },
      {
        id: "m2",
        role: "assistant",
        text: "It answers, and the forecast file is updated.",
        sequence: 4,
      },
    ],
    actions: [
      {
        id: "a1",
        action: "Run a command",
        target: command,
        command,
        claim: "Asks the weather service whether it answers.",
        approval: { by: "you", at: "2026-10-05T11:00:01.000Z" },
        status: "completed",
        details: [{ kind: "text", label: "Output", text: "HTTP/1.1 200 OK" }],
        sequence: 1,
      },
      {
        id: "a2",
        action: "Call weather.forecast",
        target: "Weather",
        toolName: "weather__forecast",
        invocation: {
          name: "forecast",
          via: "Weather",
          arguments: [
            {
              name: "request",
              value: '{"api_key":"weather-secret-77","city":"Lyon"}',
            },
          ],
        },
        approval: {
          by: "conversation-permission",
          at: "2026-10-05T11:00:02.000Z",
          label: "Weather · forecast",
        },
        status: "completed",
        sequence: 2,
      },
      {
        id: "a3",
        action: "Change a file",
        target: "forecast.md",
        approval: { by: "you", at: "2026-10-05T11:00:03.000Z" },
        changes: [
          {
            path: "forecast.md",
            change: "updated",
            before: "Monday: rain\nTuesday: sun\n",
            after: "Monday: rain\nTuesday: clouds\n",
          },
        ],
        status: "completed",
        sequence: 3,
      },
    ],
    modelHistory: [
      {
        id: "h1",
        kind: "calls",
        text: "",
        calls: [
          {
            id: "c1",
            name: "weather__forecast",
            arguments: '{"api_key":"weather-secret-77","city":"Lyon"}',
          },
        ],
      },
    ],
    modelResponses: [
      {
        model: "provider/model-a",
        finishReason: "stop",
        termination: "finishReason",
        complete: true,
        usage: { inputTokens: 1200, outputTokens: 80, costUsd: 0.0123 },
      },
    ],
  };
}

describe("a conversation leaving the computer", () => {
  it("removes known credentials from both files and leaves the saved conversation as it was", async () => {
    const task = conversation();
    const saved = JSON.stringify(task);

    for (const file of [
      conversationHtml(task, about),
      (await conversationTrajectory(task, about, noPictures)).trajectory,
    ]) {
      expect(file).not.toContain("abc.def");
      expect(file).not.toContain("weather-secret-77");
      expect(file).toContain("Known credential formats were removed");
    }
    expect(JSON.stringify(task)).toBe(saved);
    expect(saved).toContain("Bearer abc.def");
    expect(saved).toContain("weather-secret-77");
  });
});

describe("the page for people", () => {
  it("shows every message and action in the order they happened", () => {
    const page = conversationHtml(conversation(), about);

    const order = [
      "Is the weather API up?",
      "Run a command",
      "Call weather.forecast",
      "Change a file",
      "It answers, and the forecast file is updated.",
    ].map((text) => page.indexOf(text));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("lists a compaction before a message that shares its place", () => {
    const task = conversation();
    const page = conversationHtml(
      {
        ...task,
        messages: [
          ...task.messages,
          { id: "m9", role: "user", text: "Remember everything?", sequence: 9 },
        ],
        condensings: [
          {
            id: "c1",
            sequence: 9,
            createdAt: "2026-10-07T10:00:00.000Z",
            targetTokens: 13_600,
            tokensBefore: 14_200,
            outcome: "condensed",
            revision: 1,
            throughMessageId: "m1",
            tokensAfter: 2_000,
            messages: 2,
            actions: 1,
            summary: "The forecast was checked.",
          },
        ],
      },
      about,
    );

    expect(page.indexOf("Earlier messages were condensed")).toBeGreaterThan(0);
    expect(page.indexOf("Earlier messages were condensed")).toBeLessThan(
      page.indexOf("Remember everything?"),
    );
  });

  it("says who approved each action, what the model said it was for, and what it returned", () => {
    const page = conversationHtml(conversation(), about);

    expect(page).toContain("Approved by you");
    expect(page).toContain("Allowed by the conversation permission");
    expect(page).toContain("Weather · forecast");
    expect(page).toContain("Asks the weather service whether it answers.");
    expect(page).toContain("HTTP/1.1 200 OK");
  });

  it("says each check a tool measured as holding, failing or not checked", () => {
    const task = conversation();
    const page = conversationHtml(
      {
        ...task,
        actions: [
          ...task.actions!,
          {
            id: "a4",
            action: "Build the CAD script",
            target: "car.py",
            status: "completed",
            details: [
              {
                kind: "checks",
                label: "Requirements in requirements.json",
                items: [
                  { label: "R1", holds: true, note: "1 mm to spare" },
                  { label: "R2", holds: false },
                  { label: "R3", holds: null, note: "no part is named Lid" },
                ],
                note: "R4 failed in the last build and is no longer in requirements.json.",
              },
            ],
            sequence: 4,
          },
        ],
      },
      about,
    );

    expect(page).toContain("<h3>Requirements in requirements.json</h3>");
    expect(page).toContain("<li>Holds: R1 · 1 mm to spare</li>");
    expect(page).toContain("<li>Fails: R2</li>");
    expect(page).toContain("<li>Not checked: R3 · no part is named Lid</li>");
    expect(page).toContain(
      "R4 failed in the last build and is no longer in requirements.json.",
    );
  });

  it("shows a changed file as the lines it removed and added", () => {
    const page = conversationHtml(conversation(), about);

    expect(page).toMatch(/class="removed"[^>]*>[^<]*Tuesday: sun/);
    expect(page).toMatch(/class="added"[^>]*>[^<]*Tuesday: clouds/);
  });

  it("shows a large file's change as the lines it carries", () => {
    const task = conversation();
    const page = conversationHtml(
      {
        ...task,
        actions: [
          {
            id: "a8",
            action: "Edit workspace files",
            target: "data.csv",
            changes: [
              {
                path: "data.csv",
                change: "updated",
                diff: {
                  added: 1,
                  removed: 1,
                  sections: [
                    { kind: "skipped", count: 4000 },
                    {
                      kind: "lines",
                      lines: [
                        { kind: "removed", beforeLine: 4001, text: "old row" },
                        { kind: "added", afterLine: 4001, text: "new row" },
                      ],
                    },
                  ],
                },
              },
            ],
            status: "completed",
            sequence: 1,
          },
        ],
      },
      about,
    );

    expect(page).toContain("4000 unchanged lines");
    expect(page).toMatch(/class="added"[^>]*>[^<]*new row/);
  });

  it("says a declined action changed nothing, and that the person declined it", () => {
    const task = conversation();
    const page = conversationHtml(
      {
        ...task,
        actions: [
          {
            id: "a9",
            action: "Delete a file",
            target: "old-draft.md",
            approval: { by: "you", at: "2026-10-05T11:00:04.000Z" },
            changes: [{ path: "old-draft.md", change: "recycled" }],
            status: "denied",
            sequence: 1,
          },
        ],
      },
      about,
    );

    expect(page).toContain("Declined by you");
    expect(page).not.toContain("Approved by you");
    expect(page).toContain("old-draft.md · proposed, not made");
    expect(page).toMatch(/<dt>Files changed<\/dt><dd>0<\/dd>/);
  });

  it("says where a moved file went and where a file came from", () => {
    const task = conversation();
    const page = conversationHtml(
      {
        ...task,
        actions: [
          {
            id: "a10",
            action: "Move notes.md to kept/notes.md",
            target: "notes.md",
            approval: { by: "you", at: "2026-10-05T11:00:04.000Z" },
            changes: [
              { path: "notes.md", change: "moved", to: "kept/notes.md" },
              { path: "kept/notes.md", change: "created", from: "notes.md" },
            ],
            status: "completed",
            sequence: 1,
          },
        ],
      },
      about,
    );

    expect(page).toContain("notes.md · moved to kept/notes.md");
    expect(page).toContain("kept/notes.md · moved here from notes.md");
    expect(page).not.toContain("Too large to include");
  });

  it("shows what the conversation cost and which model answered", () => {
    const page = conversationHtml(conversation(), about);

    expect(page).toContain("$0.0123");
    expect(page).toContain("provider/model-a");
  });

  it("says a cost estimated from price lists is estimated, in its own currency and with the list's date", () => {
    const task = conversation();
    const estimated = (amount: number) => ({
      model: "deepseek-v4-pro",
      finishReason: "stop",
      termination: "finishReason" as const,
      complete: true,
      usage: {
        inputTokens: 1200,
        outputTokens: 80,
        estimatedCost: {
          amount,
          currency: "CNY",
          priceList: "2026-10-09",
        },
      },
    });
    const page = conversationHtml(
      {
        ...task,
        modelResponses: [
          ...task.modelResponses,
          estimated(0.5),
          estimated(0.25),
        ],
      },
      about,
    );

    expect(page).toMatch(/<dt>Cost<\/dt><dd>\$0\.0123<\/dd>/);
    expect(page).toMatch(
      /<dt>Estimated cost<\/dt><dd>¥0\.7500, from the price list of 2026-10-09<\/dd>/,
    );
  });

  it("counts what each specialist's requests cost in the conversation's cost", () => {
    const task = conversation();
    const page = conversationHtml(
      {
        ...task,
        specialistRuns: [
          {
            id: "run-1",
            specialist: {
              id: "engineering/reviewer",
              name: "Reviewer",
              description: "Reviews work.",
              instructions: "Review the evidence.",
              provenance: { source: "plugin", pluginId: "engineering" },
            },
            task: "Check the forecast.",
            depth: 1,
            status: "completed",
            startedAt: "2026-10-05T11:00:01.000Z",
            finishedAt: "2026-10-05T11:00:02.000Z",
            sequence: 2,
            actionIds: [],
            handoff: { report: "It holds." },
            modelResponses: [
              {
                model: "provider/model-b",
                finishReason: "stop",
                termination: "finishReason",
                complete: true,
                usage: { inputTokens: 300, outputTokens: 20, costUsd: 0.0077 },
              },
            ],
          },
        ],
      },
      about,
    );

    expect(page).toMatch(/<dt>Cost<\/dt><dd>\$0\.0200<\/dd>/);
    expect(page).toContain("provider/model-b");
  });

  it("loads nothing from outside the file and runs no code", () => {
    const page = conversationHtml(
      {
        ...conversation(),
        messages: [
          {
            id: "m1",
            role: "user",
            text: '<script>alert(1)</script><img src="https://example.com/x.png">',
            sequence: 0,
          },
        ],
      },
      about,
    );

    expect(page).not.toMatch(/<script|<link|<img|<iframe|@import|url\(/i);
    expect(page).not.toMatch(/<[^>]*\s(?:src|href)=/i);
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("says what was left out of the file", () => {
    const page = conversationHtml(
      {
        ...conversation(),
        messages: [
          {
            id: "m1",
            role: "user",
            text: "Here is the chart.",
            attachments: [
              {
                kind: "picture",
                id: "p1",
                name: "chart.png",
                mediaType: "image/png",
                bytes: 2048,
              },
            ],
            sequence: 0,
          },
        ],
      },
      about,
    );

    expect(page).toContain("chart.png");
    expect(page).toMatch(/Pictures and attached files are named, not included/);
  });
});

describe("saving an export", () => {
  it("writes the file where the person chose, named after the conversation", async () => {
    const folder = await folders.make("zhiyin-export-");
    let suggested = "";
    const exporter = conversationExport(() => about);

    const result = await exporter.save(
      conversation(),
      "html",
      async (name) => {
        suggested = name;
        return join(folder, name);
      },
      noPictures,
    );

    expect(suggested).toBe("check-the-weather-service.html");
    expect(result).toEqual({
      status: "saved",
      destination: join(folder, suggested),
    });
    expect(await readFile(join(folder, suggested), "utf8")).toContain(
      "Check the weather service",
    );
  });

  it("names the file in the script the title is written in", async () => {
    let suggested = "";
    const exporter = conversationExport(() => about);

    await exporter.save(
      { ...conversation(), title: "हिन्दी सारांश" },
      "html",
      async (name) => {
        suggested = name;
        return undefined;
      },
      noPictures,
    );

    expect(suggested).toBe("हिन्दी-सारांश.html");
  });

  it("cuts a long title's file name between characters, never inside one or after a dash", async () => {
    const suggested: string[] = [];
    const exporter = conversationExport(() => about);
    const offer = async (name: string) => {
      suggested.push(name);
      return undefined;
    };

    await exporter.save(
      { ...conversation(), title: `${"a".repeat(79)}𠀀 tail` },
      "html",
      offer,
      noPictures,
    );
    await exporter.save(
      { ...conversation(), title: `${"a".repeat(79)} b` },
      "html",
      offer,
      noPictures,
    );
    await exporter.save(
      { ...conversation(), title: "́́" },
      "html",
      offer,
      noPictures,
    );

    expect(suggested).toEqual([
      `${"a".repeat(79)}𠀀.html`,
      `${"a".repeat(79)}.html`,
      "conversation.html",
    ]);
  });

  it("writes nothing when the person cancels", async () => {
    const folder = await folders.make("zhiyin-export-");
    const exporter = conversationExport(() => about);

    const result = await exporter.save(
      conversation(),
      "trajectory",
      async () => undefined,
      noPictures,
    );

    expect(result).toEqual({ status: "cancelled" });
    await expect(
      stat(join(folder, "check-the-weather-service.zip")),
    ).rejects.toThrow();
  });

  it("says why when the file cannot be written", async () => {
    const exporter = conversationExport(() => about);

    const result = await exporter.save(
      conversation(),
      "trajectory",
      async () => join(tmpdir(), "no-such-folder-zhiyin", "out.zip"),
      noPictures,
    );

    expect(result).toMatchObject({ status: "failed" });
  });
});
