/**
 * A conversation saved as one file that leaves the computer: a page a person
 * reads, or a record another program analyses. Both have the credentials
 * Zhiyin recognises removed; the saved conversation keeps them as sent.
 */

import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import {
  conversationExport,
  conversationHtml,
  conversationJson,
  type ExportAbout,
} from "../src/index.js";

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
  it("removes known credentials from both files and leaves the saved conversation as it was", () => {
    const task = conversation();
    const saved = JSON.stringify(task);

    for (const file of [
      conversationHtml(task, about),
      conversationJson(task, about),
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

describe("the record for analysis", () => {
  it("keeps every list of the saved conversation, model requests included", () => {
    const task = conversation();

    const exported = JSON.parse(conversationJson(task, about)) as {
      format: string;
      app: { version: string };
      conversation: Record<string, unknown>;
    };

    expect(exported.format).toBe("zhiyin.conversation");
    expect(exported.app.version).toBe("0.1.0-alpha.1");
    expect(Object.keys(exported.conversation).sort()).toEqual(
      Object.keys(task).sort(),
    );
    for (const list of Object.keys(emptyConversationLists))
      expect(exported.conversation[list]).toHaveLength(
        (task[list as keyof typeof emptyConversationLists] as unknown[]).length,
      );
    expect(exported.conversation["modelResponses"]).toEqual(
      task.modelResponses,
    );
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

  it("shows a changed file as the lines it removed and added", () => {
    const page = conversationHtml(conversation(), about);

    expect(page).toMatch(/class="removed"[^>]*>[^<]*Tuesday: sun/);
    expect(page).toMatch(/class="added"[^>]*>[^<]*Tuesday: clouds/);
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

  it("shows what the conversation cost and which model answered", () => {
    const page = conversationHtml(conversation(), about);

    expect(page).toContain("$0.0123");
    expect(page).toContain("provider/model-a");
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
    const folder = await mkdtemp(join(tmpdir(), "zhiyin-export-"));
    let suggested = "";
    const exporter = conversationExport(() => about);

    const result = await exporter.save(conversation(), "html", async (name) => {
      suggested = name;
      return join(folder, name);
    });

    expect(suggested).toBe("check-the-weather-service.html");
    expect(result).toEqual({
      status: "saved",
      destination: join(folder, suggested),
    });
    expect(await readFile(join(folder, suggested), "utf8")).toContain(
      "Check the weather service",
    );
  });

  it("writes nothing when the person cancels", async () => {
    const folder = await mkdtemp(join(tmpdir(), "zhiyin-export-"));
    const exporter = conversationExport(() => about);

    const result = await exporter.save(
      conversation(),
      "json",
      async () => undefined,
    );

    expect(result).toEqual({ status: "cancelled" });
    await expect(
      stat(join(folder, "check-the-weather-service.json")),
    ).rejects.toThrow();
  });

  it("says why when the file cannot be written", async () => {
    const exporter = conversationExport(() => about);

    const result = await exporter.save(conversation(), "json", async () =>
      join(tmpdir(), "no-such-folder-zhiyin", "out.json"),
    );

    expect(result).toMatchObject({ status: "failed" });
  });
});
