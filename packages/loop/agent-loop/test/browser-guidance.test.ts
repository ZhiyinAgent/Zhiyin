/**
 * What the agent is told about looking at a page. Zhiyin's browser is a
 * plugin's connector, so its tools are offered only once that plugin is
 * active; a model that did not know where it was printed and screenshotted
 * pages with a browser started in the shell. A turn is told the same words
 * whether that plugin is active or not, so its start stays the same (ADR
 * 0017); a specialist is told of the tools it has.
 */

import { describe, expect, it } from "vitest";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import {
  loopAndHost,
  pluginOffering,
  pluginsOffering,
  stubDependencies,
  until,
} from "./support.js";

const noShellBrowser =
  "Never start a browser in the shell to view, screenshot or print a page; a PDF comes from a document compiler.";

/** A model's call of one tool, whole in one piece. */
function call(callId: string, name: string, input: unknown): ModelEvent {
  return {
    kind: "toolCallDelta",
    index: 0,
    callId,
    name,
    argumentsDelta: JSON.stringify(input),
  };
}

const findTheBrowser =
  "To view a page or workspace HTML, for any task, use the Browser connector's preview, opening its plugin when its tools are not on offer, at phone size too for a phone. When that plugin is switched off or the browser needs something, ask the person for it instead. Never use a browser in the shell to view, screenshot or print; PDFs come from a document compiler.";
const useThePreview =
  "Use the browser's workspace-preview tool to view local HTML, at phone size too for a phone, and look at a page you made there before calling it finished. Never start a browser in the shell; a PDF comes from a document compiler.";

/** What the model was told, in a conversation offered these tools. */
async function told(toolNames: readonly string[]): Promise<string> {
  const heard: string[] = [];
  const base = stubDependencies(() => {});
  const { host } = loopAndHost({
    ...base,
    tools: {
      ...base.tools,
      list: () =>
        toolNames.map((name) => ({
          name,
          description: "A tool.",
          inputSchema: { type: "object" },
        })),
    },
    model: {
      ...base.model,
      send: async function* (request: ModelRequest) {
        heard.push(JSON.stringify(request.messages));
        yield { kind: "textDelta", text: "Hello." };
        yield { kind: "done" };
      },
    },
  });
  const taskId = await host.app.createTask();
  await host.app.start(taskId, "Make her a page for her phone");
  return heard.at(-1)!;
}

const quoted = (line: string) => JSON.stringify(line).slice(1, -1);

describe("what the agent is told about looking at a page", () => {
  it("is told, word for word, to use the browser's preview, opening its plugin when needed, and never to use one in the shell, whether the browser is offered or not", async () => {
    for (const tools of [
      ["read_file"],
      ["read_file", "mcp__browser__browser_preview"],
    ]) {
      const messages = await told(tools);
      expect(messages).toContain(quoted(findTheBrowser));
      expect(messages).not.toContain(quoted(useThePreview));
    }
  });

  it("tells a specialist, word for word, never to use a browser in the shell, and nothing of activating one", async () => {
    const toldSpecialist = await toldSpecialistWith(["read_file"]);

    expect(toldSpecialist).toContain(quoted(noShellBrowser));
    expect(toldSpecialist).not.toContain(quoted(findTheBrowser));
  });

  it("tells a specialist that has the browser's preview, word for word, to look at its page there", async () => {
    const toldSpecialist = await toldSpecialistWith([
      "read_file",
      "mcp__browser__browser_preview",
    ]);

    expect(toldSpecialist).toContain(quoted(useThePreview));
    expect(toldSpecialist).not.toContain(quoted(findTheBrowser));
  });
});

/** What a specialist was told first, in a conversation offered these tools. */
async function toldSpecialistWith(
  toolNames: readonly string[],
): Promise<string | undefined> {
  const base = stubDependencies(() => {});
  const toldSpecialist: string[] = [];
  const { host } = loopAndHost({
    ...base,
    tools: {
      ...base.tools,
      list: () =>
        toolNames.map((name) => ({
          name,
          description: "A tool.",
          inputSchema: { type: "object" },
        })),
    },
    plugins: pluginsOffering([
      pluginOffering({
        name: "research",
        specialists: [
          {
            id: "reader",
            name: "Reader",
            description: "Reads pages.",
            instructions: "Read what you are given.",
          },
        ],
      }),
    ]),
    model: {
      ...base.model,
      send: async function* (request: ModelRequest) {
        const text = JSON.stringify(request.messages);
        if (text.includes("You are the Reader specialist")) {
          toldSpecialist.push(text);
          yield call("finish-1", "finish_specialist", { report: "Read it." });
        } else if (!text.includes("Read the page.")) {
          yield call("delegate-1", "delegate_specialist", {
            id: "research/reader",
            task: "Read the page.",
          });
        } else {
          yield { kind: "textDelta" as const, text: "Done." };
        }
        yield { kind: "done" as const };
      },
    },
    newSpecialistRunId: () => "specialist-1",
  });
  const taskId = await host.app.createTask(["research"]);
  await host.app.start(taskId, "Have the page read");
  await until(() => toldSpecialist.length > 0);
  return toldSpecialist[0];
}
