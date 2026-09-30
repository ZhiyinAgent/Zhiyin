/**
 * The automation server that lets the agent drive the browser the person is
 * watching.
 *
 * It runs inside this process, over an in-memory transport: no child process,
 * no loopback port, and so nothing else on the machine can reach it. Its tools
 * are advertised whether or not a browser is running — Playwright asks for a
 * browser context only when a tool actually needs one, which is what lets the
 * application open the panel on first use rather than teaching the model to
 * ask for it.
 *
 * Boundaries and invariants:
 * docs/architecture/features/interactive-browser/README.md
 */

import { createRequire } from "node:module";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type {
  BrowserLauncher,
  InteractiveBrowser,
} from "./interactive-browser.js";
import type {
  ActionDetail,
  ToolCallInspection,
  ToolInvocationResult,
} from "@zhiyin/contract";
import {
  inspectBrowser,
  describeBrowserResult,
  describedBrowserTools,
} from "./browser-presentation.js";

/**
 * The connection shape the application registers with the MCP feature.
 * Declared here rather than imported from a peer feature; the capabilities
 * group adapts this feature's own interface.
 */
export type AutomationTool = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
};

export type BrowserAutomation = {
  inspect(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ToolCallInspection>;
  describeResult(
    name: string,
    args: Readonly<Record<string, unknown>>,
    result: ToolInvocationResult,
  ): readonly ActionDetail[];
  listTools(): Promise<readonly AutomationTool[]>;
  callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
    binding?: string,
  ): Promise<unknown>;
  close(): Promise<void>;
};

/**
 * `@playwright/mcp` publishes CommonJS. Required rather than imported so this
 * module stays loadable from an ES module without a bundler rewriting it.
 */
type PlaywrightMcp = {
  createConnection(
    config?: unknown,
    contextGetter?: () => Promise<unknown>,
  ): Promise<{
    connect(transport: unknown): Promise<void>;
    close?(): Promise<void>;
  }>;
};

export type BrowserAutomationOptions = {
  /** Swapped in tests; production uses the packaged Playwright server. */
  readonly createConnection?: PlaywrightMcp["createConnection"];
  /**
   * Whether the model this browser is working for can be shown a picture.
   * Supplied by the application: this feature knows what a screenshot is and
   * nothing about which model is configured. Absent means no, because a
   * capability whose answer nobody can read is not a capability.
   */
  readonly acceptsImages?: () => boolean | Promise<boolean>;
  /**
   * The one folder the browser may write files into, supplied by the
   * application. Without it the packaged server falls back to the directory
   * the app was started from, which is the source tree in development and
   * never a place anyone approved.
   */
  readonly outputDirectory?: string;
};

/** Tools whose whole answer is a picture. */
const picturesOnly = new Set(["browser_take_screenshot"]);

/**
 * Inputs that name a place on disk. A picture is kept with the conversation
 * under an id the session store generates, so a filename the model chose has
 * nothing to select and everything to leak: it is removed from the schema the
 * model is shown, and from the arguments if one arrives regardless.
 */
const pathInputs = new Set(["filename"]);

function withoutPathArguments(
  args: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(([name]) => !pathInputs.has(name)),
  );
}

function withoutPathInputs(
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const properties = schema["properties"];
  if (typeof properties !== "object" || properties === null) return schema;
  const kept = Object.fromEntries(
    Object.entries(properties as Record<string, unknown>).filter(
      ([name]) => !pathInputs.has(name),
    ),
  );
  const required = Array.isArray(schema["required"])
    ? (schema["required"] as unknown[]).filter(
        (name) => typeof name !== "string" || !pathInputs.has(name),
      )
    : undefined;
  return {
    ...schema,
    properties: kept,
    ...(required ? { required } : {}),
  };
}

const packagedConnection: PlaywrightMcp["createConnection"] = (
  config,
  contextGetter,
) => {
  const require = createRequire(import.meta.url);
  const mcp = require("@playwright/mcp") as PlaywrightMcp;
  return mcp.createConnection(config, contextGetter);
};

type ListedTool = {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema?: unknown;
};

/** What the model is offered, whoever is asking: a conversation or settings. */
function offeredTools(
  tools: readonly ListedTool[],
  seeing: boolean,
  preview: boolean,
): readonly AutomationTool[] {
  return [
    ...tools
      // A tool nobody has described cannot be put behind an honest
      // approval, so it is not offered at all.
      .filter((tool) => describedBrowserTools.has(tool.name))
      .filter((tool) => seeing || !picturesOnly.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: withoutPathInputs(
          tool.inputSchema as Readonly<Record<string, unknown>>,
        ),
      })),
    ...(preview
      ? [
          {
            name: "browser_preview",
            description:
              "Preview a workspace HTML file in the visible browser. Zhiyin manages the local server; do not start one with bash or invent file URLs.",
            inputSchema: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description: "Workspace-relative file path, e.g. index.html",
                },
              },
              required: ["path"],
              additionalProperties: false,
            },
          },
          {
            name: "browser_stop_preview",
            description:
              "Stop the managed local preview server and confirm that it is closed.",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        ]
      : []),
  ];
}

/**
 * What a conversation's browser offers, and whether the browser executable and
 * containment prerequisite are present, answered without a conversation: no
 * process is started, no page is opened, and no session is created. A launch
 * failure is still reported truthfully when the first browser action runs.
 */
export async function describeBrowserAutomation(
  launcher: BrowserLauncher,
  options: BrowserAutomationOptions & {
    /** Whether a conversation's browser can preview the chosen workspace. */
    readonly workspacePreview: boolean;
  },
): Promise<readonly AutomationTool[]> {
  const availability = await launcher.available();
  if (!availability.available) throw new Error(availability.reason);
  const create = options.createConnection ?? packagedConnection;
  const connection = await create({}, async () => {
    throw new Error("Describing the browser's tools opens no page.");
  });
  const client = new Client({ name: "zhiyin", version: "0.1.0" });
  try {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await connection.connect(serverSide);
    await client.connect(clientSide, { timeout: 15_000 });
    const { tools } = await client.listTools();
    return offeredTools(
      tools,
      (await options.acceptsImages?.()) ?? false,
      options.workspacePreview,
    );
  } finally {
    await client.close().catch(() => undefined);
    await connection.close?.().catch(() => undefined);
  }
}

export function browserAutomation(
  browser: InteractiveBrowser,
  options: BrowserAutomationOptions = {},
): BrowserAutomation {
  let client: Client | undefined;
  let server: { close?(): Promise<void> } | undefined;
  let starting: Promise<Client> | undefined;
  let generation = 0;

  async function reset(): Promise<void> {
    ++generation;
    const open = client;
    const running = server;
    client = undefined;
    server = undefined;
    starting = undefined;
    await open?.close().catch(() => undefined);
    await running?.close?.().catch(() => undefined);
  }
  browser.onState((state) => {
    if (state.status === "closed" || state.status === "failed") void reset();
  });

  const create = options.createConnection ?? packagedConnection;

  async function ready(): Promise<Client> {
    if (client) return client;
    starting ??= (async () => {
      const epoch = generation;
      const connection = await create(
        options.outputDirectory ? { outputDir: options.outputDirectory } : {},
        async () => {
          // The first tool call is what opens the browser, and with it the
          // panel. The model never asks for the panel and has no tool for it.
          await browser.open();
          const context = browser.automation();
          if (!context) {
            throw new Error(
              browser.state().reason ?? "The browser could not be opened.",
            );
          }
          return context;
        },
      );
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await connection.connect(serverSide);
      const connected = new Client({ name: "zhiyin", version: "0.1.0" });
      await connected.connect(clientSide, { timeout: 15_000 });
      if (generation !== epoch) {
        await connected.close();
        await connection.close?.();
        throw new Error(
          "The browser session closed before automation was ready.",
        );
      }
      server = connection;
      client = connected;
      return connected;
    })();
    const pending = starting;
    try {
      return await pending;
    } finally {
      if (starting === pending) starting = undefined;
    }
  }

  return {
    inspect: (name, args) => inspectBrowser(browser, name, args),
    describeResult: (name, args, result) =>
      describeBrowserResult(browser, name, args, result),
    listTools: async () =>
      offeredTools(
        (await (await ready()).listTools()).tools,
        (await options.acceptsImages?.()) ?? false,
        Boolean(browser.preview),
      ),
    callTool: async (name, args, signal, binding) => {
      signal?.throwIfAborted();
      if (name === "browser_preview" || name === "browser_stop_preview") {
        try {
          if (!browser.preview)
            throw new Error("Workspace preview is unavailable.");
          if (name === "browser_stop_preview") {
            if (Object.keys(args).length)
              throw new Error("Stopping a preview takes no arguments.");
            await browser.preview.close();
            return {
              content: [
                { type: "text", text: "The preview server is closed." },
              ],
            };
          }
          if (
            typeof args.path !== "string" ||
            Object.keys(args).some((key) => key !== "path")
          )
            throw new Error("Provide a workspace-relative file path.");
          const url = await browser.preview.open(args.path, signal, binding);
          try {
            signal?.throwIfAborted();
            await browser.open(url);
            signal?.throwIfAborted();
            if (browser.state().status !== "open")
              throw new Error(
                browser.state().reason ?? "The preview could not be opened.",
              );
            return {
              content: [
                {
                  type: "text",
                  text: `Opened ${args.path} in the browser. The preview stays available until explicitly stopped or the browser is closed.`,
                },
              ],
            };
          } catch (error) {
            await browser.preview.close();
            throw error;
          }
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? error.message
                    : "The preview could not complete.",
              },
            ],
          };
        }
      }
      // The model can only ask for what it was offered, but a stale call from
      // an interrupted turn or a renamed tool must not slip past the same rule.
      if (!describedBrowserTools.has(name))
        throw new Error(`${name} is not available in Zhiyin’s browser.`);
      if (name === "browser_close") {
        await browser.close();
        return { content: [{ type: "text", text: "Browser closed." }] };
      }
      const result = await (
        await ready()
      ).callTool(
        { name, arguments: withoutPathArguments(args) },
        { ...(signal ? { signal } : {}), timeout: 120_000 },
      );
      await browser.refresh();
      return result;
    },
    close: reset,
  };
}
