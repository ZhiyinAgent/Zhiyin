import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
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

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/**
 * A stand-in for the packaged Playwright server: it answers the two protocol
 * calls that matter and asks for a browser context only when a tool is
 * called — the behaviour the real one was measured to have.
 */
function fakeAutomationServer(
  /** Tools it lists besides its usual four, as Playwright describes them. */
  more: readonly {
    name: string;
    description: string;
    inputSchema?: Readonly<Record<string, unknown>>;
  }[] = [],
  /** What it answers each tool call with. */
  said = "done",
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
                          inputSchema: { type: "object" },
                          ...tool,
                        })),
                      ],
                    }
                  : await (async () => {
                      calls += 1;
                      lastArguments = (
                        message as { params?: { arguments?: unknown } }
                      ).params?.arguments;
                      await contextGetter?.();
                      return { content: [{ type: "text", text: said }] };
                    })().catch((cause: unknown) => ({
                      failed:
                        cause instanceof Error ? cause.message : String(cause),
                    }));
            await transport
              .send(
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
              )
              // An answer to a client that has gone is dropped, as a server would.
              .catch(() => undefined);
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
    // A test may replace it with one that keeps its listeners.
    onState: (() => () => {}) as (
      listener: (state: BrowserSessionState) => void,
    ) => () => void,
    markAgentAction: vi.fn(),
    close: async () => {},
    opened,
    open: vi.fn(async (url?: string) => {
      opened.push(url ?? "");
    }),
    automation: () => context,
    takeStoppedDownloads: () => [],
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

  it("asks the model to say in words what each element an action acts on is", async () => {
    const automation = browserAutomation(fakeBrowser(), {
      createConnection: fakeAutomationServer([
        {
          name: "browser_click",
          description: "Click.",
          // As the packaged server lists it: only the target is required.
          inputSchema: {
            type: "object",
            properties: {
              element: { type: "string" },
              target: { type: "string" },
              doubleClick: { type: "boolean" },
            },
            required: ["target"],
          },
        },
        {
          name: "browser_drag",
          description: "Drag.",
          inputSchema: {
            type: "object",
            properties: {
              startElement: { type: "string" },
              startTarget: { type: "string" },
              endElement: { type: "string" },
              endTarget: { type: "string" },
            },
            required: ["startTarget", "endTarget"],
          },
        },
      ]).createConnection,
    });

    const tools = await automation.listTools();
    const required = (name: string) =>
      (
        tools.find((tool) => tool.name === name)?.inputSchema as {
          required?: string[];
        }
      )?.required;

    expect(required("browser_click")).toEqual(["target", "element"]);
    expect(required("browser_drag")).toEqual([
      "startTarget",
      "endTarget",
      "startElement",
      "endElement",
    ]);
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

  it("opens the browser again on the next tool once it was closed", async () => {
    const server = fakeAutomationServer();
    const closedListeners: ((state: BrowserSessionState) => void)[] = [];
    const browser = Object.assign(fakeBrowser(), {
      onState: (listener: (state: BrowserSessionState) => void) => {
        closedListeners.push(listener);
        return () => {};
      },
    });
    const automation = browserAutomation(browser, {
      createConnection: server.createConnection,
    });
    await automation.callTool("browser_navigate", {
      url: "https://example.com/",
    });

    for (const listener of closedListeners)
      listener({ status: "closed", url: "", title: "", loading: false });
    const again = await automation.callTool("browser_navigate", {
      url: "https://example.com/",
    });

    expect(again).not.toMatchObject({ isError: true });
    expect(browser.open).toHaveBeenCalledTimes(2);
  });

  it("tells the agent, once, of each download the browser stopped at its limit", async () => {
    const server = fakeAutomationServer();
    const stopped = [{ name: "endless.bin", limitBytes: 1024 ** 3 }];
    const browser = Object.assign(fakeBrowser(), {
      takeStoppedDownloads: () => stopped.splice(0),
    });
    const automation = browserAutomation(browser, {
      createConnection: server.createConnection,
    });
    const text = (result: unknown) =>
      (result as { content: { text?: string }[] }).content
        .map((item) => item.text ?? "")
        .join("\n");

    const told = await automation.callTool("browser_navigate", {
      url: "https://example.com/",
    });
    const after = await automation.callTool("browser_navigate", {
      url: "https://example.com/",
    });

    expect(text(told)).toContain(
      "The download of endless.bin was stopped: this browser's downloads may come to 1 GB in all.",
    );
    expect(text(after)).not.toContain("endless.bin");
  });

  it("lists no tab on Edge's own page of downloads among the tabs the agent is shown", async () => {
    const server = fakeAutomationServer(
      [],
      [
        "### Open tabs",
        "- 0: (current) [Files](http://127.0.0.1/)",
        "- 1: [Téléchargements](edge://downloads-hub/)",
        "- 2: [Docs](https://example.com/docs)",
      ].join("\n"),
    );
    const automation = browserAutomation(fakeBrowser(), {
      createConnection: server.createConnection,
    });

    const result = await automation.callTool("browser_navigate", {
      url: "https://example.com/",
    });

    expect((result as { content: { text?: string }[] }).content[0]?.text).toBe(
      [
        "### Open tabs",
        "- 0: (current) [Files](http://127.0.0.1/)",
        "- 2: [Docs](https://example.com/docs)",
      ].join("\n"),
    );
  });

  it("tells the browser of each download the automation server says it kept", async () => {
    const server = fakeAutomationServer(
      [],
      [
        "### Events",
        '- Downloaded file report.pdf to "./report.pdf"',
        "- Downloading file data.csv ...",
        '- Downloaded file data.csv to "./data.csv"',
      ].join("\n"),
    );
    const kept: string[] = [];
    const browser = Object.assign(fakeBrowser(), {
      downloadsKept: (names: readonly string[]) => kept.push(...names),
    });
    const automation = browserAutomation(browser, {
      createConnection: server.createConnection,
    });

    await automation.callTool("browser_navigate", {
      url: "https://example.com/",
    });

    expect(kept).toEqual(["report.pdf", "data.csv"]);
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

  it.each([
    ["cannot start", "failed", "No supported browser could be started."],
    ["is lost during the call", "closed", "The browser closed unexpectedly."],
  ])(
    "fails a call whose browser %s with the browser's own reason",
    async (_, status, reason) => {
      const server = fakeAutomationServer();
      const listeners: ((state: BrowserSessionState) => void)[] = [];
      const failed: BrowserSessionState = {
        status: status as "failed" | "closed",
        url: "",
        title: "",
        loading: false,
        reason,
      };
      let current: BrowserSessionState = {
        status: "open",
        url: "",
        title: "",
        loading: false,
      };
      const browser = fakeBrowser();
      browser.onState = (listener: (state: BrowserSessionState) => void) => {
        listeners.push(listener);
        return () => {};
      };
      browser.state = () => current;
      // As the session does: the failure is told to its listeners, which
      // close the connection, while the call is still waiting for a browser.
      browser.open = vi.fn(async () => {
        current = failed;
        for (const listener of listeners) listener(failed);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      browser.automation = () => null;
      const automation = browserAutomation(browser, {
        createConnection: server.createConnection,
      });

      await expect(
        automation.callTool("browser_navigate", {
          url: "https://example.com/",
        }),
      ).rejects.toThrow(reason);
    },
  );

  it("refuses an address that is not a web page, before the browser sees it", async () => {
    const server = fakeAutomationServer();
    const automation = browserAutomation(fakeBrowser(), {
      createConnection: server.createConnection,
    });

    const result = await automation.callTool("browser_navigate", {
      url: "view-source:https://example.com/",
    });

    expect(result).toMatchObject({ isError: true });
    expect(server.lastArguments()).toBeUndefined();
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
    const parent = await folders.make("zhiyin-uploads-");
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

  it.skipIf(!TemporaryFolders.canTellCaseApart())(
    "refuses a file a link carries to a folder named like the open one but for case",
    async () => {
      const parent = await folders.makeCaseSensitive("zhiyin-uploads-case-");
      const root = join(parent, "work");
      await mkdir(root);
      await mkdir(join(parent, "WORK"));
      await writeFile(join(parent, "WORK", "secret.txt"), "secret", "utf8");
      await symlink(join(parent, "WORK"), join(root, "linked"), "junction");

      expect(
        await inspectBrowser(watching(root), "browser_file_upload", {
          paths: ["linked/secret.txt"],
        }),
      ).toMatchObject({
        ok: false,
        reason:
          "Only files in the open folder can be uploaded. Name each by its path inside the folder.",
      });
    },
  );

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
