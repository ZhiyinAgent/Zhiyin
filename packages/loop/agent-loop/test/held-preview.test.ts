/**
 * The workspace preview, held by its browser's network (ADR 0018), as the
 * permission policy decides its calls. The browser's own automation server
 * inspects each call against a real session and preview; the browser itself
 * is a stand-in whose network holds the page to the preview once the page
 * goes there, as the real proxy does. The conversation holds outside content
 * and the person's own file, where a send of the model's words to a
 * destination it chose asks every time.
 */

import { afterEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ActionEffects } from "@zhiyin/contract";
import {
  BrowserSession,
  browserAutomation,
  type BrowserLauncher,
  type BrowserTarget,
} from "@zhiyin/interactive-browser";
import { GuardedPermissionEngine } from "@zhiyin/permission-engine";
import { TemporaryFolders } from "@zhiyin/test-support";
import { WorkspaceTools } from "@zhiyin/tools";
import { loopFrom, stubDependencies, until } from "./support.js";

const folders = new TemporaryFolders();
const sessions: BrowserSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await folders.removeAll();
});

const nothing: ActionEffects = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
};

/** A browser whose network holds the page to the preview once it goes there. */
function heldLauncher(): BrowserLauncher {
  let url = "about:blank";
  let isPreview: (hostPort: string) => boolean = () => false;
  let sealed: string[] = [];
  let allowed: string[] = [];
  const target: BrowserTarget = {
    pid: 1,
    browserName: "Microsoft Edge",
    network: {
      preview: (given) => (isPreview = given),
      page: () => undefined,
      sealed: () => sealed,
      leave: () => (sealed = []),
      allow: (origins) => {
        allowed = [...allowed, ...origins];
        return [];
      },
      takeRefused: () => [],
    },
    automation: () => ({}),
    takeStoppedDownloads: () => [],
    url: () => url,
    title: async () => "Shanghai",
    goto: async (next) => {
      url = next;
      const at = new URL(next).host;
      if (isPreview(at)) sealed = [at];
    },
    back: async () => {},
    forward: async () => {},
    reload: async () => {},
    pointer: async () => {},
    typeText: async () => {},
    pressKey: async () => {},
    scroll: async () => {},
    selectedText: async () => "",
    captureFrame: async () => ({ data: "", width: 1, height: 1 }),
    startFrames: async () => {},
    streamFrames: async () => {},
    onNavigated: () => {},
    onLost: () => {},
    historyEntry: async () => undefined,
    endOrigins: async () => {},
    watchedPage: {
      answers: async () => {},
      stop: async () => {},
      asking: () => false,
    },
    downloadsKept: () => {},
    close: async () => {},
  };
  return {
    sealsPreview: true,
    available: async () => ({ available: true, browserName: "Microsoft Edge" }),
    launch: async () => target,
  };
}

/** Calls the model makes, in order, one per request. */
type Call = { name: string; args: Record<string, unknown> };

async function running(calls: readonly Call[]) {
  const root = await folders.make("zhiyin-held-preview-");
  await writeFile(join(root, "notes.md"), "The person's notes.", "utf8");
  await writeFile(join(root, "index.html"), "<title>Shanghai</title>", "utf8");
  const session = new BrowserSession({
    launcher: heldLauncher(),
    workspaceRoot: () => root,
  });
  sessions.push(session);
  const browser = browserAutomation(session);
  const workspace = new WorkspaceTools(root, { shell: undefined });
  const deps = stubDependencies(() => {});
  let requests = 0;
  const loop = loopFrom({
    ...deps,
    permissions: new GuardedPermissionEngine(),
    tools: workspace,
    workspace,
    mcp: {
      ...deps.mcp,
      availableTools: async () =>
        ["read_page", ...(await browser.listTools()).map((tool) => tool.name)]
          .filter((name, at, all) => all.indexOf(name) === at)
          .map((name) => ({
            name,
            description: name,
            inputSchema: { type: "object" },
          })),
      inspect: async (name: string, args: unknown) => {
        // A page from the internet: what it returns is outside content.
        if (name === "read_page")
          return {
            ok: true,
            action: "Read page",
            target: "https://example.com/",
            command: "read_page({})",
            connection: "Studio",
            builtInConnection: true,
            effects: { ...nothing, brings: "outside" },
          };
        const inspected = await browser.inspect!(
          name,
          args as Record<string, unknown>,
        );
        return inspected.ok
          ? { ...inspected, connection: "Browser", builtInConnection: true }
          : inspected;
      },
      execute: async (name: string, args: unknown) => {
        if (name === "browser_preview" || name === "browser_allow_addresses") {
          const result = await browser.callTool(
            name,
            args as Record<string, unknown>,
          );
          return { ok: true as const, value: JSON.stringify(result) };
        }
        return {
          ok: true as const,
          value: name === "read_page" ? "A page about Shanghai." : "Done.",
        };
      },
    },
    model: {
      ...deps.model,
      send: async function* () {
        const call = calls[requests];
        requests += 1;
        if (call)
          yield {
            kind: "toolCallDelta",
            index: 0,
            callId: `call-${requests}`,
            name: call.name,
            argumentsDelta: JSON.stringify(call.args),
          };
        else yield { kind: "textDelta", text: "Finished." };
        yield { kind: "done" };
      },
    },
  });
  const taskId = await loop.createTask();
  return { loop, taskId };
}

/** Runs the turn, allowing each card once, and gives back each card's target. */
async function cardsOf(
  loop: Awaited<ReturnType<typeof running>>["loop"],
  taskId: string,
): Promise<string[]> {
  const cards: string[] = [];
  const turn = loop.start(taskId, "Make the phone page");
  let done = false;
  void turn.then(() => (done = true));
  const answered = new Set<string>();
  const newCard = () => {
    const phase = loop.snapshot().tasks[0]?.phase;
    return phase?.kind === "approval" && !answered.has(phase.prompt.id)
      ? phase
      : undefined;
  };
  for (;;) {
    await until(() => done || newCard() !== undefined);
    const phase = newCard();
    if (!phase) break;
    answered.add(phase.prompt.id);
    cards.push(phase.prompt.target);
    await loop.resolveApproval(taskId, phase.prompt.id, "allow");
  }
  await turn;
  return cards;
}

const outside: Call = { name: "read_page", args: {} };
const preview: Call = { name: "browser_preview", args: { path: "index.html" } };
const working: readonly Call[] = [
  { name: "browser_resize", args: { width: 390, height: 844 } },
  {
    name: "browser_evaluate",
    args: { function: "() => document.body.scrollHeight" },
  },
  {
    name: "browser_click",
    args: { element: "the menu button", target: "e3" },
  },
];

describe("the held preview, once outside content and the person's files meet", () => {
  it("is opened and worked on without a card, since it can send nothing anywhere", async () => {
    const { loop, taskId } = await running([outside, preview, ...working]);

    expect(await cardsOf(loop, taskId)).toEqual([]);
  });

  it("asks once to allow addresses, naming every one", async () => {
    const { loop, taskId } = await running([
      outside,
      preview,
      {
        name: "browser_allow_addresses",
        args: {
          addresses: ["https://cdn.jsdelivr.net", "https://fonts.gstatic.com"],
        },
      },
    ]);

    expect(await cardsOf(loop, taskId)).toEqual([
      "https://cdn.jsdelivr.net:443, https://fonts.gstatic.com:443",
    ]);
  });

  it("asks again for what the model writes into it once an address is allowed, and not for a click", async () => {
    const { loop, taskId } = await running([
      outside,
      preview,
      {
        name: "browser_allow_addresses",
        args: { addresses: ["https://cdn.jsdelivr.net"] },
      },
      ...working,
    ]);

    const cards = await cardsOf(loop, taskId);

    // The allowance, then the size and the code, each the model's words.
    expect(cards).toHaveLength(3);
    expect(cards[0]).toBe("https://cdn.jsdelivr.net:443");
  });
});
