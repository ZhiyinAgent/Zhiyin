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
 */

import { createRequire } from "node:module";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type {
  BrowserLauncher,
  InteractiveBrowser,
  StoppedDownload,
} from "./interactive-browser.js";
import type { ConnectionTool, OfferedConnection } from "@zhiyin/contract";
import {
  inspectBrowser,
  describeBrowserResult,
  describedBrowserTools,
  describingInputs,
} from "./browser-presentation.js";
import { browserAddress } from "./browser-address.js";
import { decidedInputs, hiddenInputs } from "./browser-inputs.js";

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
 * Where Playwright's own description leaves out what the model needs here:
 * closing the browser also gives back the space beside the conversation, and
 * a picture's target is strict — a selector matching several elements fails
 * the call — while it scrolls to the element itself.
 */
const ownDescriptions: Readonly<Record<string, string>> = {
  browser_close:
    "Close Zhiyin's browser and the page it shows. Use it when browsing for this task is finished, so the space beside the conversation goes back to the conversation or to a document. Pages are not kept.",
  browser_take_screenshot:
    "Take a picture of the current page. Without a target it shows what the window shows, or the whole page with fullPage. With a target it shows that one element, scrolled into view first, so a section of a long page needs no scrolling code. The target must match exactly one element: for several sections, take one picture of each, or target one element that contains them all. A picture cannot be acted on; use browser_snapshot for actions.",
  browser_file_upload:
    "Give files from the open folder to the file chooser a click on the page opened. Only files in the open folder can be uploaded. Without paths, the file chooser is cancelled.",
};

/**
 * Inputs whose meaning Zhiyin decides: an upload names files inside the open
 * folder, never anywhere on the computer.
 */
const ownSchemas: Readonly<Record<string, Readonly<Record<string, unknown>>>> =
  {
    browser_file_upload: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description:
            "The files to upload, each by its path inside the open folder, such as reports/q3.csv. Omit to cancel the file chooser.",
        },
      },
      additionalProperties: false,
    },
  };

/** A size as a person reads it: in gigabytes from one up, else megabytes. */
function sizeOf(bytes: number): string {
  const gigabytes = bytes / 1024 ** 3;
  return gigabytes >= 1
    ? `${Number(gigabytes.toFixed(1))} GB`
    : `${Number((bytes / 1024 ** 2).toFixed(1))} MB`;
}

/**
 * The downloads an answer says the automation server kept, by their names:
 * it says so once its copy in the conversation's folder is complete.
 */
function keptDownloads(result: unknown): readonly string[] {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((item: { text?: unknown }) =>
    typeof item.text === "string"
      ? [...item.text.matchAll(/^- Downloaded file (.+) to "/gm)].map(
          (said) => said[1]!,
        )
      : [],
  );
}

/**
 * A tab Edge opens on its own page of downloads, which ignores being closed
 * and holds nothing the agent can use.
 */
const downloadsTab =
  /^- \d+:(?: \(current\))? \[[^\n]*\]\(edge:\/\/downloads-hub\/?\)(?: \[crashed\])?(?:\r?\n|$)/gm;

/** The answer without Edge's tab of downloads among the tabs it lists. */
function withoutDownloadsTab<T>(result: T): T {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return result;
  return {
    ...result,
    content: content.map((item: { text?: unknown }) =>
      typeof item.text === "string"
        ? { ...item, text: item.text.replace(downloadsTab, "") }
        : item,
    ),
  };
}

/**
 * The answer, telling the agent of each download stopped for its size: the
 * automation server says a download began, and never that it ended.
 */
function withStoppedDownloads<T>(
  result: T,
  stopped: readonly StoppedDownload[],
): T {
  const content = (result as { content?: unknown }).content;
  if (!stopped.length || !Array.isArray(content)) return result;
  return {
    ...result,
    content: [
      ...content,
      ...stopped.map((download) => ({
        type: "text",
        text: `The download of ${download.name} was stopped: this browser's downloads may come to ${sizeOf(download.limitBytes)} in all.`,
      })),
    ],
  };
}

function modelArguments(
  name: string,
  args: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    ...Object.fromEntries(
      Object.entries(args).filter(([input]) => !hiddenInputs.has(input)),
    ),
    ...decidedInputs[name],
  };
}

function withoutHiddenInputs(
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const properties = schema["properties"];
  if (typeof properties !== "object" || properties === null) return schema;
  const kept = Object.fromEntries(
    Object.entries(properties as Record<string, unknown>).filter(
      ([name]) => !hiddenInputs.has(name),
    ),
  );
  const required = Array.isArray(schema["required"])
    ? (schema["required"] as unknown[]).filter(
        (name) => typeof name !== "string" || !hiddenInputs.has(name),
      )
    : undefined;
  return {
    ...schema,
    properties: kept,
    ...(required ? { required } : {}),
  };
}

/**
 * An action on an element is refused without a description of it, so the
 * schema the model reads asks for one, and the model is not sent back for it.
 */
function withDescriptionsAsked(
  name: string,
  schema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const asked = describingInputs(name);
  if (!asked.length) return schema;
  const required = Array.isArray(schema["required"])
    ? (schema["required"] as unknown[])
    : [];
  return {
    ...schema,
    required: [...required, ...asked.filter((key) => !required.includes(key))],
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
): readonly ConnectionTool[] {
  return [
    ...tools
      // A tool nobody has described cannot be put behind an honest
      // approval, so it is not offered at all.
      .filter((tool) => describedBrowserTools.has(tool.name))
      .filter((tool) => seeing || !picturesOnly.has(tool.name))
      .map((tool) => {
        const description = ownDescriptions[tool.name] ?? tool.description;
        return {
          name: tool.name,
          ...(description ? { description } : {}),
          inputSchema: withDescriptionsAsked(
            tool.name,
            ownSchemas[tool.name] ??
              withoutHiddenInputs(
                tool.inputSchema as Readonly<Record<string, unknown>>,
              ),
          ),
        };
      }),
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
): Promise<readonly ConnectionTool[]> {
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
): OfferedConnection {
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
        browser.markAgentAction();
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
      // Checked again where the call is made, not only when it was shown: an
      // inspection is a description, and this is the browser being sent.
      const address =
        name === "browser_navigate"
          ? browserAddress(typeof args.url === "string" ? args.url : "")
          : undefined;
      if (address && !address.ok)
        return {
          isError: true,
          content: [{ type: "text", text: address.reason }],
        };
      browser.markAgentAction();
      if (name === "browser_close") {
        await browser.close();
        return { content: [{ type: "text", text: "Browser closed." }] };
      }
      let given = modelArguments(name, args);
      if (address?.ok) given = { ...given, url: address.url };
      if (
        name === "browser_file_upload" &&
        Array.isArray(args.paths) &&
        args.paths.length
      ) {
        try {
          if (!browser.uploads || !options.outputDirectory)
            throw new Error(
              "Choose a folder first: only its files can be uploaded.",
            );
          given = {
            ...given,
            paths: await browser.uploads.stage(
              args.paths as string[],
              options.outputDirectory,
              binding,
            ),
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? error.message
                    : "The files could not be uploaded.",
              },
            ],
          };
        }
      }
      let result: Awaited<ReturnType<Client["callTool"]>>;
      try {
        result = await (
          await ready()
        ).callTool(
          { name, arguments: given },
          { ...(signal ? { signal } : {}), timeout: 120_000 },
        );
      } catch (error) {
        // A browser that fails or is lost closes the connection under the
        // call, which then ends in the connection's words; the browser's
        // say what happened.
        const state = browser.state();
        if (
          (state.status === "failed" || state.status === "closed") &&
          state.reason
        )
          throw new Error(state.reason, { cause: error });
        throw error;
      }
      browser.downloadsKept?.(keptDownloads(result));
      await browser.refresh();
      return withStoppedDownloads(
        withoutDownloadsTab(result),
        browser.takeStoppedDownloads(),
      );
    },
    close: reset,
  };
}
