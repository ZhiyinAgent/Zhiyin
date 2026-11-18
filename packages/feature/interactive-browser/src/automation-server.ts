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
import type { WorkspacePreview } from "./workspace-preview.js";
import type { ConnectionTool, OfferedConnection } from "@zhiyin/contract";
import {
  inspectBrowser,
  describeBrowserResult,
  describingInputs,
} from "./browser-presentation.js";
import { browserAddress } from "./browser-address.js";
import { decidedInputs, hiddenInputs } from "./browser-inputs.js";
import {
  browserTools,
  describedBrowserTools,
  mostAddresses,
} from "./browser-tools.js";
import { allowedOrigin } from "./network-gate.js";
import { pageState } from "./preview-answer.js";

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

/** A size as a person reads it: in gigabytes from one up, else megabytes. */
function sizeOf(bytes: number): string {
  const gigabytes = bytes / 1024 ** 3;
  return gigabytes >= 1
    ? `${Number(gigabytes.toFixed(1))} GB`
    : `${Number((bytes / 1024 ** 2).toFixed(1))} MB`;
}

/** An address without the place in the page it names. */
function withoutFragment(url: string): string {
  const at = url.indexOf("#");
  return at === -1 ? url : url.slice(0, at);
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
 * Each download stopped for its size: the automation server says a download
 * began, and never that it ended.
 */
const stoppedNotes = (stopped: readonly StoppedDownload[]) =>
  stopped.map(
    (download) =>
      `The download of ${download.name} was stopped: this browser's downloads may come to ${sizeOf(download.limitBytes)} in all.`,
  );

/**
 * The addresses the held preview was refused since the last answer, so the
 * model knows why part of its page did not load and how to ask for it
 * (ADR 0018).
 */
const refusedNotes = (refused: readonly string[]) =>
  refused.length
    ? [
        `The preview could not load from ${refused.join(", ")}: it reaches only its own files and the addresses allowed for it. If the page needs them, call browser_allow_addresses with addresses ${JSON.stringify(refused)}, then reload the page.`,
      ]
    : [];

/**
 * The files the preview's pages asked for and were not served since the
 * last answer, each named with why.
 */
const unservedNotes = (unserved: readonly string[]) =>
  unserved.length ? [unserved.join("\n")] : [];

/** What stopping the page's script came to. */
const stoppedScriptNotes = (stopped: string | undefined) =>
  stopped ? [`The page did not answer: ${stopped}.`] : [];

/** The answer with what the model is told beside it, each note its own part. */
function withNotes<T>(result: T, notes: readonly string[]): T {
  const content = (result as { content?: unknown }).content;
  if (!notes.length || !Array.isArray(content)) return result;
  return {
    ...result,
    content: [...content, ...notes.map((text) => ({ type: "text", text }))],
  };
}

const failed = (text: string) => ({
  isError: true,
  content: [{ type: "text", text }],
});

/** Lets the held preview reach the origins given, exactly those approved. */
function allowAddresses(
  browser: InteractiveBrowser,
  args: Readonly<Record<string, unknown>>,
  binding: string | undefined,
) {
  const addresses = args.addresses;
  if (
    !Array.isArray(addresses) ||
    !addresses.length ||
    addresses.length > mostAddresses ||
    addresses.some((address) => typeof address !== "string")
  )
    return failed(
      `Give between 1 and ${mostAddresses} addresses, each an origin such as https://cdn.jsdelivr.net.`,
    );
  // Exactly the addresses the person was shown, when they were asked.
  if (
    binding !== undefined &&
    binding !==
      JSON.stringify(
        (addresses as string[]).map((address) => allowedOrigin(address)),
      )
  )
    return failed(
      "These are not the addresses that were approved. Request approval again.",
    );
  const wrong = browser.allowAddresses(addresses as string[]);
  if (wrong.length)
    return failed(
      `Nothing was allowed: ${wrong.join(", ")} ${wrong.length === 1 ? "is not an origin" : "are not origins"}. Give each as a scheme and host with no path, such as https://cdn.jsdelivr.net.`,
    );
  return {
    content: [
      {
        type: "text",
        text: `The preview may now reach ${browser.previewNetwork()?.allowed.join(", ")}. Reload the page for what it could not load before.`,
      },
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
    ...decidedInputs(name),
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
      .filter((tool) => seeing || !browserTools[tool.name]?.picture)
      .map((tool) => {
        const own = browserTools[tool.name];
        const description = own?.description?.(seeing) ?? tool.description;
        return {
          name: tool.name,
          ...(description ? { description } : {}),
          inputSchema: withDescriptionsAsked(
            tool.name,
            own?.schema ??
              withoutHiddenInputs(
                tool.inputSchema as Readonly<Record<string, unknown>>,
              ),
          ),
        };
      }),
    ...(preview
      ? Object.entries(browserTools)
          .filter(([, tool]) => tool.previewTool)
          .map(([name, tool]) => ({
            name,
            ...(tool.checksWork ? { checksWork: tool.checksWork } : {}),
            description: tool.description?.(seeing) ?? tool.consequence,
            inputSchema: tool.schema ?? { type: "object", properties: {} },
          }))
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

  /** Opens a workspace file in the preview, answering with the page as drawn. */
  async function openPreview(
    preview: WorkspacePreview,
    path: string,
    signal: AbortSignal | undefined,
    binding: string | undefined,
  ) {
    const url = await preview.open(path, signal, binding);
    try {
      signal?.throwIfAborted();
      // Only what stopping a script comes to while this page opens.
      browser.takeStoppedScripts();
      await browser.open(url);
      signal?.throwIfAborted();
      if (browser.state().status !== "open")
        throw new Error(
          browser.state().reason ?? "The preview could not be opened.",
        );
      const held = browser.previewNetwork() !== undefined;
      const loading = browser.takeStoppedScripts();
      const client = await ready();
      const page = await pageState(
        (tool, given) =>
          browser.whileAnswering(() =>
            client.callTool(
              {
                name: tool,
                arguments: { ...given, ...decidedInputs(tool) },
              },
              { ...(signal ? { signal } : {}), timeout: 120_000 },
            ),
          ),
        (await options.acceptsImages?.()) ?? false,
      );
      signal?.throwIfAborted();
      const loaded = browser.takeStoppedScripts();
      const stopped = loading
        ? `The page did not finish loading: ${loading}.`
        : loaded
          ? `The page stopped answering once it loaded: ${loaded}.`
          : undefined;
      return withNotes(
        {
          ...(stopped ? { isError: true } : {}),
          content: [
            ...(stopped
              ? [
                  {
                    type: "text",
                    text: `${stopped} What follows is the page as the stop left it. Fix the script, then preview it again.`,
                  },
                ]
              : []),
            {
              type: "text",
              text: `Opened ${path} in the browser. ${held ? "The preview reaches only its own files: any other address its page asks for is refused, and named in the next answer. To let it load something from the internet, such as a font or a library, ask for every address it needs with browser_allow_addresses. " : ""}The preview stays available until explicitly stopped or the browser is closed.`,
            },
            ...page,
          ],
        },
        [
          ...refusedNotes(browser.takeRefused()),
          ...unservedNotes(preview.takeUnserved()),
        ],
      );
    } catch (error) {
      await preview.close();
      throw error;
    }
  }

  /** Zhiyin's own tools for the workspace preview. */
  async function previewCall(
    name: string,
    args: Readonly<Record<string, unknown>>,
    signal: AbortSignal | undefined,
    binding: string | undefined,
  ) {
    browser.markAgentAction();
    try {
      if (name === "browser_allow_addresses")
        return allowAddresses(browser, args, binding);
      if (!browser.preview)
        throw new Error("Workspace preview is unavailable.");
      if (name === "browser_stop_preview") {
        if (Object.keys(args).length)
          throw new Error("Stopping a preview takes no arguments.");
        await browser.preview.close();
        return {
          content: [{ type: "text", text: "The preview server is closed." }],
        };
      }
      if (
        typeof args.path !== "string" ||
        Object.keys(args).some((key) => key !== "path")
      )
        throw new Error("Provide a workspace-relative file path.");
      return await openPreview(browser.preview, args.path, signal, binding);
    } catch (error) {
      return failed(
        error instanceof Error
          ? error.message
          : "The preview could not complete.",
      );
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
      if (browserTools[name]?.previewTool)
        return previewCall(name, args, signal, binding);
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
      let called = name;
      // Opening the page already shown at a place in it means to see it as
      // it is now, where the browser would only scroll there.
      const reopens =
        address?.ok === true &&
        address.url.includes("#") &&
        withoutFragment(address.url) === withoutFragment(browser.state().url);
      if (address?.ok) {
        given = { ...given, url: address.url };
        // Out of the held preview before anything else is reached.
        await browser.prepareFor(address.url);
      }
      if (name === "browser_navigate_back") {
        // A step back out of the held preview goes to that page instead.
        const instead = await browser.leaveByHistory(-1);
        if (instead) {
          called = "browser_navigate";
          given = { url: instead };
        }
      }
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
              browser.state().url,
            ),
          };
        } catch (error) {
          return failed(
            error instanceof Error
              ? error.message
              : "The files could not be uploaded.",
          );
        }
      }
      let result: Awaited<ReturnType<Client["callTool"]>>;
      try {
        const client = await ready();
        result = await browser.whileAnswering(() =>
          client.callTool(
            { name: called, arguments: given },
            { ...(signal ? { signal } : {}), timeout: 120_000 },
          ),
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
      browser.downloadsKept(keptDownloads(result));
      if (reopens && !result.isError) await browser.reload();
      await browser.refresh();
      return withNotes(withoutDownloadsTab(result), [
        ...stoppedNotes(browser.takeStoppedDownloads()),
        ...refusedNotes(browser.takeRefused()),
        ...unservedNotes(browser.preview?.takeUnserved() ?? []),
        ...stoppedScriptNotes(browser.takeStoppedScripts()),
      ]);
    },
    close: reset,
  };
}
