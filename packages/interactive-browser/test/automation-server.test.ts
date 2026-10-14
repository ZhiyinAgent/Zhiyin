import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  browserAutomation,
  describeBrowserAutomation,
} from "../src/automation-server.js";
import { inspectBrowser } from "../src/browser-presentation.js";
import {
  WorkspaceUploads,
  type BrowserLauncher,
  type BrowserSessionState,
  type InteractiveBrowser,
} from "../src/index.js";

/**
 * A stand-in for the packaged Playwright server: it answers the two protocol
 * calls that matter and asks for a browser context only when a tool is
 * called — the behaviour the real one was measured to have.
 */
function fakeAutomationServer(
  /** Tools it lists besides its usual four, as Playwright describes them. */
  more: readonly { name: string; description: string }[] = [],
) {
  let contextGetter: (() => Promise<unknown>) | undefined;
  let closed = false;
  let calls = 0;
  let config: unknown;
  let lastArguments: unknown;
  return {
    getterCalls: () => calls,
    wasClosed: () => closed,
    config: () => config,
    lastArguments: () => lastArguments,
    createConnection: async (
      given?: unknown,
      getter?: () => Promise<unknown>,
    ) => {
      config = given;
      contextGetter = getter;
      return {
        connect: async (transport: {
          start(): Promise<void>;
          send(message: unknown): Promise<void>;
          onmessage?: (message: unknown) => void;
        }) => {
          transport.onmessage = async (message) => {
            const request = message as { id?: number; method?: string };
            if (request.id === undefined) return;
            const result =
              request.method === "initialize"
                ? {
                    protocolVersion: "2025-11-25",
                    capabilities: { tools: {} },
                    serverInfo: { name: "playwright", version: "1" },
                  }
                : request.method === "tools/list"
                  ? {
                      tools: [
                        {
                          name: "browser_navigate",
                          description: "Go to a page.",
                          inputSchema: { type: "object" },
                        },
                        {
                          name: "browser_run_code_unsafe",
                          description: "Run arbitrary Playwright code.",
                          inputSchema: { type: "object" },
                        },
                        {
                          name: "browser_cookie_list",
                          description: "List cookies.",
                          inputSchema: { type: "object" },
                        },
                        {
                          name: "browser_take_screenshot",
                          description: "Take a picture of the page.",
                          inputSchema: {
                            type: "object",
                            properties: {
                              filename: {
                                type: "string",
                                description: "Where to save the picture.",
                              },
                              fullPage: { type: "boolean" },
                              scale: {
                                type: "string",
                                enum: ["css", "device"],
                              },
                            },
                          },
                        },
                        ...more.map((tool) => ({
                          ...tool,
                          inputSchema: { type: "object" },
                        })),
                      ],
                    }
                  : await (async () => {
                      calls += 1;
                      lastArguments = (
                        message as { params?: { arguments?: unknown } }
                      ).params?.arguments;
                      await contextGetter?.();
                      return { content: [{ type: "text", text: "done" }] };
                    })().catch((cause: unknown) => ({
                      failed:
                        cause instanceof Error ? cause.message : String(cause),
                    }));
            await transport.send(
              "failed" in (result as Record<string, unknown>)
                ? {
                    jsonrpc: "2.0",
                    id: request.id,
                    error: {
                      code: -32603,
                      message: (result as { failed: string }).failed,
                    },
                  }
                : { jsonrpc: "2.0", id: request.id, result },
            );
          };
          await transport.start();
        },
        close: async () => {
          closed = true;
        },
      };
    },
  };
}

function fakeBrowser(context: unknown = { marker: "context" }) {
  const opened: string[] = [];
  const browser = {
    refresh: async () => {},
    onState: () => () => {},
    markAgentAction: vi.fn(),
    close: async () => {},
    opened,
    open: vi.fn(async (url?: string) => {
      opened.push(url ?? "");
    }),
    automation: () => context,
    state: (): BrowserSessionState => ({
      status: "open" as const,
      url: "",
      title: "",
      loading: false,
    }),
  };
  return browser as unknown as InteractiveBrowser & typeof browser;
}

describe("browser automation", () => {
  it("offers its tools without starting a browser", async () => {
    const server = fakeAutomationServer();
    const browser = fakeBrowser();
    const automation = browserAutomation(browser, {
      createConnection: server.createConnection,
    });

    const tools = await automation.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["browser_navigate"]);
    // Nothing was launched to answer a question about what exists.
    expect(browser.open).not.toHaveBeenCalled();
  });

  it("describes browser_close in its own words", async () => {
    const automation = browserAutomation(fakeBrowser(), {
      createConnection: fakeAutomationServer([
        { name: "browser_close", description: "Close the page" },
      ]).createConnection,
    });

    const close = (await automation.listTools()).find(
      (tool) => tool.name === "browser_close",
    );
    expect(close?.description).toBe(
      "Close Zhiyin's browser and the page it shows. Use it when browsing for this task is finished, so the space beside the conversation goes back to the conversation or to a document. Pages are not kept.",
    );
  });

  it("tells the model that a picture's target must match exactly one element", async () => {
    const automation = browserAutomation(fakeBrowser(), {
      createConnection: fakeAutomationServer().createConnection,
      acceptsImages: () => true,
    });

    const screenshot = (await automation.listTools()).find(
      (tool) => tool.name === "browser_take_screenshot",
    );
    expect(screenshot?.description).toBe(
      "Take a picture of the current page. Without a target it shows what the window shows, or the whole page with fullPage. With a target it shows that one element, scrolled into view first, so a section of a long page needs no scrolling code. The target must match exactly one element: for several sections, take one picture of each, or target one element that contains them all. A picture cannot be acted on; use browser_snapshot for actions.",
    );
  });

  it("offers taking a picture only to a model that can be shown one", async () => {
    const server = fakeAutomationServer();
    const seen = browserAutomation(fakeBrowser(), {
      createConnection: server.createConnection,
      acceptsImages: () => true,
    });
    const unseen = browserAutomation(fakeBrowser(), {
      createConnection: fakeAutomationServer().createConnection,
      acceptsImages: () => false,
    });

    expect((await seen.listTools()).map((tool) => tool.name)).toContain(
      "browser_take_screenshot",
    );
    // A picture nobody can look at is not a capability, so it is not offered.
    expect((await unseen.listTools()).map((tool) => tool.name)).not.toContain(
      "browser_take_screenshot",
    );
  });

  it("opens the browser itself the first time a tool is used", async () => {
    const server = fakeAutomationServer();
    const browser = fakeBrowser();
    const automation = browserAutomation(browser, {
      createConnection: server.createConnection,
    });

    await automation.callTool("browser_navigate", {
      url: "https://example.com/",
    });

    // The application opens the panel; the model has no tool that could.
    expect(browser.open).toHaveBeenCalledOnce();
  });

  it("refuses a tool with the reason the browser gave, rather than acting", async () => {
    const server = fakeAutomationServer();
    const browser = fakeBrowser(null);
    browser.state = () => ({
      status: "failed" as const,
      url: "",
      title: "",
      loading: false,
      reason: "No supported browser could be started.",
    });
    const automation = browserAutomation(browser, {
      createConnection: server.createConnection,
    });

    await expect(
      automation.callTool("browser_navigate", { url: "https://example.com/" }),
    ).rejects.toThrow("No supported browser could be started.");
  });

  it("starts one server however many callers arrive at once", async () => {
    const started: number[] = [];
    const server = fakeAutomationServer();
    const automation = browserAutomation(fakeBrowser(), {
      createConnection: async (config, getter) => {
        started.push(1);
        return server.createConnection(config, getter);
      },
    });

    await Promise.all([
      automation.listTools(),
      automation.listTools(),
      automation.listTools(),
    ]);

    expect(started).toHaveLength(1);
  });

  it("closes the server without closing the page someone may still be reading", async () => {
    const server = fakeAutomationServer();
    const browser = fakeBrowser();
    const automation = browserAutomation(browser, {
      createConnection: server.createConnection,
    });
    await automation.listTools();

    await automation.close();

    expect(server.wasClosed()).toBe(true);
    expect(browser.open).not.toHaveBeenCalled();
  });
});

describe("where a picture of a page is allowed to go", () => {
  it("never offers the model a say in where a picture is written", async () => {
    const server = fakeAutomationServer();
    const automation = browserAutomation(fakeBrowser(), {
      createConnection: server.createConnection,
      acceptsImages: () => true,
      outputDirectory: "C:/app-data/browser-output",
    });

    const screenshot = (await automation.listTools()).find(
      (tool) => tool.name === "browser_take_screenshot",
    );

    const schema = screenshot?.inputSchema as {
      properties?: Record<string, unknown>;
    };
    // The picture is kept with the conversation; a path the model chose is
    // a file written somewhere nobody approved.
    expect(schema.properties).not.toHaveProperty("filename");
    expect(schema.properties).toHaveProperty("fullPage");
  });

  it("drops a filename the model sends anyway", async () => {
    const server = fakeAutomationServer();
    const automation = browserAutomation(fakeBrowser(), {
      createConnection: server.createConnection,
      acceptsImages: () => true,
      outputDirectory: "C:/app-data/browser-output",
    });

    await automation.callTool("browser_take_screenshot", {
      filename: "C:/Users/someone/Documents/report.png",
      fullPage: true,
    });

    expect(server.lastArguments()).not.toHaveProperty("filename");
    expect(server.lastArguments()).toMatchObject({ fullPage: true });
  });

  it("shows the model every picture at the page's own size, whatever it asks for", async () => {
    const server = fakeAutomationServer();
    const automation = browserAutomation(fakeBrowser(), {
      createConnection: server.createConnection,
      acceptsImages: () => true,
      outputDirectory: "C:/app-data/browser-output",
    });

    const screenshot = (await automation.listTools()).find(
      (tool) => tool.name === "browser_take_screenshot",
    );
    const schema = screenshot?.inputSchema as {
      properties?: Record<string, unknown>;
    };
    // The page is drawn at the screen's density for the person watching; a
    // picture at that density would cost the model four times as much.
    expect(schema.properties).not.toHaveProperty("scale");

    await automation.callTool("browser_take_screenshot", { scale: "device" });
    expect(server.lastArguments()).toEqual({ scale: "css" });

    await automation.callTool("browser_take_screenshot", { fullPage: true });
    expect(server.lastArguments()).toEqual({ fullPage: true, scale: "css" });
  });

  it("confines whatever the browser does write to the folder it is given", async () => {
    const server = fakeAutomationServer();
    const automation = browserAutomation(fakeBrowser(), {
      createConnection: server.createConnection,
      outputDirectory: "C:/app-data/browser-output",
    });

    await automation.callTool("browser_navigate", {
      url: "https://example.com",
    });

    expect(server.config()).toMatchObject({
      outputDir: "C:/app-data/browser-output",
    });
  });
});

describe("which browser tools are offered at all", () => {
  it("offers only the tools it can describe to the person approving them", async () => {
    const server = fakeAutomationServer();
    const automation = browserAutomation(fakeBrowser(), {
      createConnection: server.createConnection,
      acceptsImages: () => true,
    });

    const offered = (await automation.listTools()).map((tool) => tool.name);

    // The packaged server ships far more tools than this app has decided
    // about. One it cannot name and cannot state the consequence of cannot be
    // put behind a truthful approval, so it is not offered.
    expect(offered).toContain("browser_navigate");
    expect(offered).toContain("browser_take_screenshot");
    expect(offered).not.toContain("browser_run_code_unsafe");
    expect(offered).not.toContain("browser_cookie_list");
  });

  it("tells the browser each time the agent acts in it, and not for a tool it refuses", async () => {
    const server = fakeAutomationServer();
    const browser = fakeBrowser();
    const automation = browserAutomation(browser, {
      createConnection: server.createConnection,
    });

    await automation.callTool("browser_navigate", {
      url: "https://example.com/",
    });
    await automation.callTool("browser_close", {});
    await expect(
      automation.callTool("browser_run_code_unsafe", { code: "() => {}" }),
    ).rejects.toThrow();

    // The workspace follows the surface the agent used last.
    expect(browser.markAgentAction).toHaveBeenCalledTimes(2);
  });

  it("refuses to run a tool it does not offer, even if one is asked for", async () => {
    const server = fakeAutomationServer();
    const automation = browserAutomation(fakeBrowser(), {
      createConnection: server.createConnection,
    });

    await expect(
      automation.callTool("browser_run_code_unsafe", { code: "() => {}" }),
    ).rejects.toThrow(/not available/i);
  });

  it("keeps the agent on the page the person watches: switching tabs is not offered", async () => {
    const server = fakeAutomationServer([
      {
        name: "browser_tabs",
        description: "List, create, close, or select a tab.",
      },
    ]);
    const automation = browserAutomation(fakeBrowser(), {
      createConnection: server.createConnection,
    });

    const offered = (await automation.listTools()).map((tool) => tool.name);

    expect(offered).not.toContain("browser_tabs");
    await expect(
      automation.callTool("browser_tabs", { action: "select", index: 1 }),
    ).rejects.toThrow(/not available/i);
  });
});

describe("files a page asks for", () => {
  async function folder(): Promise<{ root: string; output: string }> {
    const parent = await mkdtemp(join(tmpdir(), "zhiyin-uploads-"));
    const root = join(parent, "workspace");
    await mkdir(join(root, "reports"), { recursive: true });
    await writeFile(join(root, "reports", "q3.csv"), "region,total\n", "utf8");
    await mkdir(join(parent, "outside"));
    await writeFile(join(parent, "outside", "secret.txt"), "secret", "utf8");
    await symlink(join(parent, "outside"), join(root, "linked"), "junction");
    return { root, output: join(parent, "browser-output") };
  }

  function watching(root: string) {
    return Object.assign(fakeBrowser(), {
      uploads: new WorkspaceUploads(() => root),
    });
  }

  it("asks the model for paths inside the open folder", async () => {
    const server = fakeAutomationServer([
      { name: "browser_file_upload", description: "Upload one or more files." },
    ]);
    const automation = browserAutomation(fakeBrowser(), {
      createConnection: server.createConnection,
    });

    const upload = (await automation.listTools()).find(
      (tool) => tool.name === "browser_file_upload",
    );

    expect(upload?.description).toMatch(/open folder/);
    expect(upload?.inputSchema).toMatchObject({
      properties: {
        paths: { description: expect.stringMatching(/inside the open folder/) },
      },
    });
  });

  it("shows the files from the open folder that would be sent, bound to how they are now", async () => {
    const { root } = await folder();

    const inspection = await inspectBrowser(
      watching(root),
      "browser_file_upload",
      { paths: ["reports/q3.csv"] },
    );

    expect(inspection).toMatchObject({
      ok: true,
      action: "Upload files",
      invocation: { arguments: [{ name: "Files", value: "reports/q3.csv" }] },
    });
    if (!inspection.ok) throw new Error("unreachable");
    expect(JSON.parse(inspection.identity ?? "")).toEqual([
      { path: "reports/q3.csv", bytes: 13, modifiedMs: expect.any(Number) },
    ]);
  });

  it.each([
    ["a path out of the folder", "../outside/secret.txt"],
    ["a path through a link out of the folder", "linked/secret.txt"],
    ["a full path", "C:/Windows/win.ini"],
  ])("refuses %s before anyone is asked", async (_case, path) => {
    const { root } = await folder();

    expect(
      await inspectBrowser(watching(root), "browser_file_upload", {
        paths: [path],
      }),
    ).toEqual({
      ok: false,
      correctable: true,
      reason:
        "Only files in the open folder can be uploaded. Name each by its path inside the folder.",
    });
  });

  it("hands the page a copy kept in the conversation's own browser folder", async () => {
    const { root, output } = await folder();
    const server = fakeAutomationServer();
    const browser = watching(root);
    const automation = browserAutomation(browser, {
      createConnection: server.createConnection,
      outputDirectory: output,
    });
    const approved = await inspectBrowser(browser, "browser_file_upload", {
      paths: ["reports/q3.csv"],
    });
    if (!approved.ok) throw new Error("unreachable");

    await automation.callTool(
      "browser_file_upload",
      { paths: ["reports/q3.csv"] },
      undefined,
      approved.identity,
    );

    const [sent] = (server.lastArguments() as { paths: string[] }).paths;
    expect(sent?.startsWith(output)).toBe(true);
    expect(await readFile(sent as string, "utf8")).toBe("region,total\n");
  });

  it("sends nothing when a file changed after its upload was approved", async () => {
    const { root, output } = await folder();
    const server = fakeAutomationServer();
    const browser = watching(root);
    const automation = browserAutomation(browser, {
      createConnection: server.createConnection,
      outputDirectory: output,
    });
    const approved = await inspectBrowser(browser, "browser_file_upload", {
      paths: ["reports/q3.csv"],
    });
    if (!approved.ok) throw new Error("unreachable");
    await writeFile(join(root, "reports", "q3.csv"), "region,total\nnorth,9\n");

    const result = await automation.callTool(
      "browser_file_upload",
      { paths: ["reports/q3.csv"] },
      undefined,
      approved.identity,
    );

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "A file changed after its upload was approved. Ask again.",
        },
      ],
    });
    expect(server.lastArguments()).toBeUndefined();
  });

  it("cancels the file chooser when no file is named", async () => {
    const server = fakeAutomationServer();
    const automation = browserAutomation(fakeBrowser(), {
      createConnection: server.createConnection,
    });

    await automation.callTool("browser_file_upload", {});

    expect(server.lastArguments()).toEqual({});
  });
});

describe("describing the browser without a conversation", () => {
  function launcher(
    availability: Awaited<ReturnType<BrowserLauncher["available"]>>,
  ) {
    const launch = vi.fn();
    return {
      launch,
      launcher: {
        available: async () => availability,
        launch,
      } as unknown as BrowserLauncher,
    };
  }

  it("describes the tools a conversation would be offered, without opening a browser", async () => {
    const server = fakeAutomationServer();
    const working = launcher({
      available: true,
      browserName: "Microsoft Edge",
    });

    const described = await describeBrowserAutomation(working.launcher, {
      createConnection: server.createConnection,
      acceptsImages: () => true,
      workspacePreview: false,
    });

    expect(described).toEqual(
      await browserAutomation(fakeBrowser(), {
        createConnection: fakeAutomationServer().createConnection,
        acceptsImages: () => true,
      }).listTools(),
    );
    expect(working.launch).not.toHaveBeenCalled();
    // What was started to answer the question does not outlive it.
    expect(server.wasClosed()).toBe(true);
  });

  it("says why the browser cannot work on this machine", async () => {
    const missing = launcher({
      available: false,
      reason: "No supported browser could be started.",
    });

    await expect(
      describeBrowserAutomation(missing.launcher, {
        createConnection: fakeAutomationServer().createConnection,
        workspacePreview: false,
      }),
    ).rejects.toThrow("No supported browser could be started.");
  });
});
