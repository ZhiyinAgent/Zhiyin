// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNEL } from "@zhiyin/contract";
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

const environment = [
  "OPENROUTER_API_KEY",
  "ZHIYIN_MODEL",
  "ZHIYIN_MODEL_ENDPOINT",
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
  /** The tool names offered in each main model request, in order. */
  let offered: string[][];

  beforeEach(async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), "zhiyin-data-"));
    workspaceDirectory = await mkdtemp(join(tmpdir(), "zhiyin-workspace-"));
    for (const name of environment) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
    // A key from the environment keeps the test away from the machine's own
    // credential store.
    process.env["OPENROUTER_API_KEY"] = "test-key";
    offered = [];
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.endsWith("/api/v1/models")) return Response.json(catalogue);
        if (url.endsWith("/chat/completions")) {
          const body = JSON.parse(String(init?.body)) as {
            tools?: { function: { name: string } }[];
          };
          const names = body.tools?.map((tool) => tool.function.name) ?? [];
          // The main request is the one carrying the workspace tools; the
          // plan and title requests carry tools of their own.
          if (names.includes("list_directory")) offered.push(names);
          return new Response(finishedAnswer, {
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
    "offers the picture tool only while the chosen model can be shown pictures",
    { timeout: 60_000 },
    async () => {
      const sent: { readonly kind?: string }[] = [];
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
      });
      core.start();
      try {
        await core.receive(CHANNEL.frontendReady, []);
        // Provider settings arrive after startup, as they do in the window.
        await eventually(() =>
          sent.some((event) => event.kind === "providerSettingsChanged"),
        );
        const taskId = (await core.receive(CHANNEL.createTask, [])) as string;
        await core.receive(CHANNEL.sendMessage, [
          taskId,
          "Look at the folder.",
        ]);
        await core.receive(CHANNEL.selectModel, ["z-ai/glm-5.3", []]);
        await core.receive(CHANNEL.sendMessage, [taskId, "Look again."]);
      } finally {
        await core.shutdown();
      }

      expect(offered.map((names) => names.includes("read_image"))).toEqual([
        true,
        false,
      ]);
    },
  );
});
