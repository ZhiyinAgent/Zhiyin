// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHANNEL,
  emptyConversationLists,
  type WorkspaceTask,
} from "@zhiyin/contract";
import type { LogEntry } from "@zhiyin/core";
import { FileSessions } from "@zhiyin/session";
import { buildCore } from "./composition.js";

/** Two models of one family: one can be shown pictures, the other cannot. */
const catalogue = {
  data: [
    {
      id: "z-ai/glm-5.3-flash",
      architecture: { input_modalities: ["text", "image"] },
    },
    { id: "z-ai/glm-5.3", architecture: { input_modalities: ["text"] } },
  ],
};

const finishedAnswer = [
  'data: {"id":"gen-1","model":"stub","choices":[{"delta":{"content":"Done."},"finish_reason":"stop"}]}\n\n',
  "data: [DONE]\n\n",
].join("");

/** The model asks to look at the picture in the folder. */
const readsThePicture = [
  `data: ${JSON.stringify({
    id: "gen-2",
    model: "stub",
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call-1",
              type: "function",
              function: {
                name: "read_document",
                arguments: JSON.stringify({ path: "chart.png" }),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  })}\n\n`,
  "data: [DONE]\n\n",
].join("");

/** A one-pixel PNG. */
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const environment = [
  "ZHIYIN_OPENROUTER_API_KEY",
  "ZHIYIN_MODEL",
  "ZHIYIN_MODEL_ENDPOINT",
  "ZHIYIN_PROVIDER",
  "ZHIYIN_REGION",
] as const;

async function eventually(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The condition was never met.");
}

describe("the application's composition", () => {
  let dataDirectory: string;
  let workspaceDirectory: string;
  const saved = new Map<string, string | undefined>();
  /** What each picture read answered the model, in order. */
  let answered: string[];

  beforeEach(async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), "zhiyin-data-"));
    workspaceDirectory = await mkdtemp(join(tmpdir(), "zhiyin-workspace-"));
    await writeFile(join(workspaceDirectory, "chart.png"), png);
    for (const name of environment) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
    // A key from the environment keeps the test away from the machine's own
    // credential store.
    process.env["ZHIYIN_OPENROUTER_API_KEY"] = "test-key";
    answered = [];
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.endsWith("/api/v1/models")) return Response.json(catalogue);
        if (url.endsWith("/chat/completions")) {
          const body = JSON.parse(String(init?.body)) as {
            tools?: { function: { name: string } }[];
            messages: { role: string; content: unknown }[];
          };
          const names = body.tools?.map((tool) => tool.function.name) ?? [];
          // The main request is the one carrying the workspace tools; the
          // plan and title requests carry tools of their own.
          const main = names.includes("read_document");
          // The person's message, then the tool's answer to the read it asked
          // for; a picture the read returned follows as a message of its own.
          const asked = body.messages.findLastIndex(
            (item) =>
              item.role === "user" &&
              JSON.stringify(item.content).includes("Look"),
          );
          const tool = body.messages
            .slice(asked + 1)
            .find((item) => item.role === "tool");
          const reading = main && !tool;
          if (main && !reading && tool) answered.push(JSON.stringify(tool));
          return new Response(reading ? readsThePicture : finishedAnswer, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        return new Response(null, { status: 404 });
      },
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(dataDirectory, { recursive: true, force: true, maxRetries: 5 });
    await rm(workspaceDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
    });
  });

  it(
    "sends no message until a model is chosen, and says to choose one",
    { timeout: 60_000 },
    async () => {
      const sent: unknown[] = [];
      const requests: string[] = [];
      const answering = globalThis.fetch;
      vi.stubGlobal(
        "fetch",
        (input: string | URL | Request, init?: RequestInit) => {
          requests.push(input instanceof Request ? input.url : String(input));
          return answering(input, init);
        },
      );
      const core = buildCore({
        dataDirectory,
        builtInPluginsDirectory: fileURLToPath(
          new URL("../../../../packages/plugins/built-in", import.meta.url),
        ),
        workspaceDirectory,
        version: "test",
        send: (_channel, payload) => void sent.push(payload),
        chooseFolder: async () => undefined,
        chooseSaveLocation: async () => undefined,
        openExternal: async () => {},
        openPath: async () => {},
        showInFolder: async () => {},
        startDrawing: async () => {
          throw new Error("Nothing is drawn in this test.");
        },
      });
      core.start();
      try {
        await core.receive(CHANNEL.frontendReady, []);
        const taskId = (await core.receive(CHANNEL.createTask, [])) as string;
        await core.receive(CHANNEL.sendMessage, [taskId, "Hello"]);
        await eventually(() =>
          JSON.stringify(sent).includes(
            "Choose a model on the Model page before starting a task.",
          ),
        );
      } finally {
        await core.shutdown();
      }

      expect(
        requests.filter((url) => url.endsWith("/chat/completions")),
      ).toEqual([]);
      expect(JSON.stringify(sent)).toContain('"chooseModel"');
    },
  );

  it(
    "keeps an error of Zhiyin's own that ended a turn in the log, and tells the conversation only that there was one",
    { timeout: 60_000 },
    async () => {
      const sent: unknown[] = [];
      const logged: LogEntry[] = [];
      const thrown = new Error("The window could not be told.");
      let updates = 0;
      const core = buildCore({
        dataDirectory,
        builtInPluginsDirectory: fileURLToPath(
          new URL("../../../../packages/plugins/built-in", import.meta.url),
        ),
        workspaceDirectory,
        version: "test",
        // Telling the window of the turn's progress fails, once it has begun.
        send: (_channel, payload) => {
          if ((payload as { kind?: string }).kind === "taskUpdated") {
            updates += 1;
            if (updates === 2) throw thrown;
          }
          sent.push(payload);
        },
        chooseFolder: async () => undefined,
        chooseSaveLocation: async () => undefined,
        openExternal: async () => {},
        openPath: async () => {},
        showInFolder: async () => {},
        startDrawing: async () => {
          throw new Error("Nothing is drawn in this test.");
        },
        log: { record: (entry) => void logged.push(entry) },
      });
      core.start();
      try {
        await core.receive(CHANNEL.frontendReady, []);
        const taskId = (await core.receive(CHANNEL.createTask, [])) as string;
        await core.receive(CHANNEL.sendMessage, [taskId, "Hello"]);
        await eventually(() =>
          JSON.stringify(sent).includes(
            "Zhiyin stopped on an error of its own. Try again.",
          ),
        );

        expect(logged).toEqual([
          {
            level: "error",
            source: "turn",
            message: `A turn stopped on an error of Zhiyin's own, in conversation ${taskId}.`,
            error: thrown,
          },
        ]);
        expect(JSON.stringify(sent)).not.toContain(thrown.message);
      } finally {
        await core.shutdown();
      }
    },
  );

  it(
    "keeps which part of a damaged conversation did not read in the log, and tells the person only that it is damaged",
    { timeout: 60_000 },
    async () => {
      // The store writes what it is given: an action in a status nobody writes.
      const planted = new FileSessions(dataDirectory, { version: "test" });
      await planted.saveWorkspace({
        tasks: [
          {
            id: "task-1",
            title: "Plan the launch",
            titleSource: "manual",
            updatedAt: "2026-10-05T09:00:00.000Z",
            updatedLabel: "Earlier",
            messages: [],
            ...emptyConversationLists,
            actions: [
              {
                id: "action-1",
                action: "Read",
                target: "notes.md",
                sequence: 1,
                status: "paused",
              },
            ],
            phase: { kind: "draft" },
          } as unknown as WorkspaceTask,
        ],
        selectedTaskId: "task-1",
        recentWorkspaces: [],
      });
      await planted.release();
      const sent: unknown[] = [];
      const logged: LogEntry[] = [];
      const core = buildCore({
        dataDirectory,
        builtInPluginsDirectory: fileURLToPath(
          new URL("../../../../packages/plugins/built-in", import.meta.url),
        ),
        workspaceDirectory,
        version: "test",
        send: (_channel, payload) => void sent.push(payload),
        chooseFolder: async () => undefined,
        chooseSaveLocation: async () => undefined,
        openExternal: async () => {},
        openPath: async () => {},
        showInFolder: async () => {},
        startDrawing: async () => {
          throw new Error("Nothing is drawn in this test.");
        },
        log: { record: (entry) => void logged.push(entry) },
      });
      core.start();
      try {
        await core.receive(CHANNEL.frontendReady, []);
        await eventually(() =>
          JSON.stringify(sent).includes("is damaged and can't be opened"),
        );

        expect(logged).toEqual([
          {
            level: "error",
            source: "history",
            message: "Conversation task-1 is damaged and was not opened.",
            error: expect.objectContaining({
              message:
                "This conversation is damaged and cannot be opened safely: what it holds as “actions” is not what Zhiyin saves there.",
            }),
          },
        ]);
        expect(JSON.stringify(sent)).not.toContain("is not what Zhiyin saves");
      } finally {
        await core.shutdown();
      }
    },
  );

  it(
    "shows the model a picture it reads only while the chosen model can be shown pictures",
    { timeout: 60_000 },
    async () => {
      const sent: {
        readonly kind?: string;
        readonly data?: {
          readonly fields?: { readonly phase?: { readonly kind?: string } };
        };
      }[] = [];
      // A send is answered once its message is in the conversation; the turn
      // is over when the window is told so.
      const turnsOver = () =>
        sent.filter(
          (event) =>
            event.kind === "taskUpdated" &&
            event.data?.fields?.phase?.kind === "completed",
        ).length;
      const core = buildCore({
        dataDirectory,
        builtInPluginsDirectory: fileURLToPath(
          new URL("../../../../packages/plugins/built-in", import.meta.url),
        ),
        workspaceDirectory,
        version: "test",
        send: (_channel, payload) => void sent.push(payload as object),
        chooseFolder: async () => undefined,
        chooseSaveLocation: async () => undefined,
        openExternal: async () => {},
        openPath: async () => {},
        showInFolder: async () => {},
        startDrawing: async () => {
          throw new Error("Nothing is drawn in this test.");
        },
      });
      core.start();
      try {
        await core.receive(CHANNEL.frontendReady, []);
        // Provider settings arrive after startup, as they do in the window.
        await eventually(() =>
          sent.some((event) => event.kind === "providerSettingsChanged"),
        );
        await core.receive(CHANNEL.selectModel, ["z-ai/glm-5.3-flash", []]);
        const taskId = (await core.receive(CHANNEL.createTask, [])) as string;
        await core.receive(CHANNEL.sendMessage, [
          taskId,
          "Look at the folder.",
        ]);
        await eventually(() => turnsOver() === 1);
        await core.receive(CHANNEL.selectModel, ["z-ai/glm-5.3", []]);
        await core.receive(CHANNEL.sendMessage, [taskId, "Look again."]);
        await eventually(() => turnsOver() === 2);
      } finally {
        await core.shutdown();
      }

      expect(answered).toHaveLength(2);
      expect(answered[0]).toContain("image/png");
      expect(answered[1]).toContain(
        "This model cannot be shown pictures, so chart.png cannot be looked at here.",
      );
    },
  );

  it.each([
    ["an installed app ignores it", true, "https://openrouter.ai/"],
    ["a development run sends there", false, "https://elsewhere.test/"],
  ])(
    "takes the model address from the environment only outside an installed app: %s",
    { timeout: 60_000 },
    async (_case, packaged, host) => {
      process.env["ZHIYIN_MODEL_ENDPOINT"] =
        "https://elsewhere.test/api/v1/chat/completions";
      const requested: string[] = [];
      const answering = globalThis.fetch;
      vi.stubGlobal(
        "fetch",
        (input: string | URL | Request, init?: RequestInit) => {
          requested.push(input instanceof Request ? input.url : String(input));
          return answering(input, init);
        },
      );
      const sent: { readonly kind?: string }[] = [];
      const core = buildCore({
        dataDirectory,
        builtInPluginsDirectory: fileURLToPath(
          new URL("../../../../packages/plugins/built-in", import.meta.url),
        ),
        workspaceDirectory,
        version: "test",
        packaged,
        send: (_channel, payload) => void sent.push(payload as object),
        chooseFolder: async () => undefined,
        chooseSaveLocation: async () => undefined,
        openExternal: async () => {},
        openPath: async () => {},
        showInFolder: async () => {},
        startDrawing: async () => {
          throw new Error("Nothing is drawn in this test.");
        },
      });
      core.start();
      const completions = () =>
        requested.filter((url) => url.endsWith("/chat/completions"));
      try {
        await core.receive(CHANNEL.frontendReady, []);
        await eventually(() =>
          sent.some((event) => event.kind === "providerSettingsChanged"),
        );
        await core.receive(CHANNEL.selectModel, ["z-ai/glm-5.3-flash", []]);
        const taskId = (await core.receive(CHANNEL.createTask, [])) as string;
        await core.receive(CHANNEL.sendMessage, [taskId, "Hello"]);
        await eventually(() => completions().length > 0);
      } finally {
        await core.shutdown();
      }

      expect(completions().every((url) => url.startsWith(host))).toBe(true);
    },
  );
});
