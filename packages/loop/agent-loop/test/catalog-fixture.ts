/**
 * A turn over a made-up catalog: plugins with core tools, toolkits, skills,
 * specialists and reference pages, answered as the capabilities group
 * declares it answers them (ADR 0017), and a working model that follows a
 * script. The tools of every plugin run as built-in tools do: one that
 * writes asks the person first.
 */

import {
  PLUGIN_SWITCHED_OFF,
  type CatalogEntry,
  type DirectoryReadiness,
  type PluginDirectoryEntry,
  type SetupSuggestion,
  type SpecialistDefinition,
  type ToolCallInspection,
  type ToolSpec,
} from "@zhiyin/contract";
import type {
  CapabilityTools,
  CatalogOpening,
  ConversationTools,
} from "@zhiyin/capabilities";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import {
  loopAndHost,
  stubDependencies,
  type LoopTestDependencies,
  type TestHost,
  type TurnTestApp,
} from "./support.js";

export type MadeUpPlugin = {
  readonly id: string;
  readonly switchedOff?: true;
  /** Tools there whenever the plugin is active. */
  readonly cores?: readonly string[];
  readonly toolkits?: readonly {
    readonly id: string;
    readonly tools: readonly string[];
  }[];
  readonly skills?: readonly {
    readonly id: string;
    readonly description: string;
    readonly text: string;
  }[];
  readonly specialists?: readonly {
    readonly id: string;
    readonly description: string;
    readonly tools?: readonly string[];
  }[];
  readonly docs?: readonly { readonly id: string; readonly text: string }[];
  /** Its connectors, as the directory lists them. */
  readonly connectors?: readonly string[];
};

/** What the directory marks of each plugin as it stands, asked at every gathering. */
export type MadeUpReadiness = () => DirectoryReadiness;

/** A tool of a made-up plugin: it takes a path, and one named write_… changes a file. */
function madeUpTool(name: string): ToolSpec {
  return {
    name,
    description: `The ${name} tool.`,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      additionalProperties: false,
    },
  };
}

type Call = {
  readonly name: string;
  /** An object, or the text the model streamed as it is. */
  readonly args: Record<string, unknown> | string;
  readonly id?: string;
};

export type Step =
  { readonly calls: readonly Call[] } | { readonly text: string };

export type CatalogFixture = {
  readonly loop: TurnTestApp;
  readonly host: TestHost;
  readonly requests: ModelRequest[];
  /** Each made-up tool that ran, with what it was handed. */
  readonly ran: { readonly name: string; readonly args: unknown }[];
};

function entriesOf(
  plugin: MadeUpPlugin,
): readonly (CatalogEntry & { readonly text: string })[] {
  return [
    ...(plugin.skills ?? []).map((skill) => ({
      id: `skill:${plugin.id}/${skill.id}`,
      kind: "skill" as const,
      title: skill.id,
      summary: skill.description,
      plugin: plugin.id,
      text: skill.text,
    })),
    ...(plugin.toolkits ?? []).map((toolkit) => ({
      id: `toolkit:${plugin.id}/${toolkit.id}`,
      kind: "toolkit" as const,
      title: toolkit.id,
      summary: `The ${toolkit.id} tools.`,
      plugin: plugin.id,
      text: toolkit.tools
        .map((tool) => `- ${tool}: The ${tool} tool.`)
        .join("\n"),
    })),
    ...(plugin.docs ?? []).map((doc) => ({
      id: `doc:${plugin.id}/${doc.id}`,
      kind: "doc" as const,
      title: doc.id,
      summary: `The ${doc.id} page.`,
      plugin: plugin.id,
      text: doc.text,
    })),
  ];
}

/** The capabilities group's catalog and tools, as it declares them, over these plugins. */
function madeUpCatalog(
  plugins: readonly MadeUpPlugin[],
  workspaceTools: readonly ToolSpec[],
  readiness?: MadeUpReadiness,
  connectorSetup?: (id: string) => SetupSuggestion | undefined,
): Partial<CapabilityTools> {
  const enabled = plugins.filter((plugin) => !plugin.switchedOff);
  const directory = (): PluginDirectoryEntry[] =>
    plugins.map((plugin) => {
      const marks = readiness?.()[plugin.id];
      return {
        id: plugin.id,
        name: plugin.id,
        purpose: `The ${plugin.id} plugin.`,
        includes: {
          skills: (plugin.skills ?? []).map((skill) => ({
            id: `skill:${plugin.id}/${skill.id}`,
            description: skill.description,
          })),
          specialists: (plugin.specialists ?? []).map((item) => item.id),
          connectors: plugin.connectors ?? [],
          toolkits: (plugin.toolkits ?? []).map(
            (toolkit) => `toolkit:${plugin.id}/${toolkit.id}`,
          ),
        },
        ...(marks?.needs ? { needs: marks.needs } : {}),
        ...((marks ? marks.switchedOff : plugin.switchedOff)
          ? { switchedOff: true as const }
          : {}),
      };
    });
  const toolkits = enabled.flatMap((plugin) =>
    (plugin.toolkits ?? []).map((toolkit) => ({
      id: `toolkit:${plugin.id}/${toolkit.id}`,
      plugin: plugin.id,
      tools: toolkit.tools.map(madeUpTool),
    })),
  );
  const specialists: SpecialistDefinition[] = enabled.flatMap((plugin) =>
    (plugin.specialists ?? []).map((item) => ({
      id: `${plugin.id}/${item.id}`,
      name: item.id,
      description: item.description,
      instructions: `Work as the ${item.id}.`,
      provenance: { source: "plugin" as const, pluginId: plugin.id },
      ...(item.tools ? { tools: item.tools } : {}),
    })),
  );
  const pluginTools = new Set(
    plugins.flatMap((plugin) => [
      ...(plugin.cores ?? []),
      ...(plugin.toolkits ?? []).flatMap((toolkit) => toolkit.tools),
    ]),
  );
  const workspace = new Set(workspaceTools.map((tool) => tool.name));
  const entries = plugins.flatMap(entriesOf);
  return {
    toolsFor: async (_conversation, options) => {
      const active = new Set(options.activatedPlugins ?? []);
      const value: ConversationTools = {
        tools: [
          ...workspaceTools,
          ...enabled
            .filter((plugin) => active.has(plugin.id))
            .flatMap((plugin) => (plugin.cores ?? []).map(madeUpTool)),
        ],
        skills: [],
        specialists,
        pluginDirectory: directory(),
        toolkits,
        ownerOf: (name) =>
          workspace.has(name) || pluginTools.has(name) ? "built-in" : undefined,
      };
      return { ok: true, value };
    },
    catalogFind: async (_conversation, query, kind) =>
      entries
        .filter(
          (entry) =>
            (!kind || entry.kind === kind) &&
            !plugins.find((plugin) => plugin.id === entry.plugin)
              ?.switchedOff &&
            `${entry.id} ${entry.title} ${entry.summary}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .slice(0, 5)
        .map(({ id, kind, title, summary, plugin }) => ({
          id,
          kind,
          title,
          summary,
          plugin,
        })),
    catalogOpen: async (_conversation, id): Promise<CatalogOpening> => {
      const found = entries.find((entry) => entry.id === id);
      if (!found) return { ok: false, reason: `There is no entry ${id}.` };
      if (plugins.find((plugin) => plugin.id === found.plugin)?.switchedOff)
        return { ok: false, reason: PLUGIN_SWITCHED_OFF };
      const { text, ...entry } = found;
      return {
        ok: true,
        entry,
        text,
        voice: entry.kind === "doc" ? "reference" : "guidance",
        plugin: entry.plugin,
        ...(entry.kind === "toolkit"
          ? {
              tools:
                toolkits.find((toolkit) => toolkit.id === entry.id)?.tools ??
                [],
            }
          : {}),
      };
    },
    pluginContents: async (id) =>
      enabled.some((plugin) => plugin.id === id)
        ? { skills: [], specialists: [], connectors: [] }
        : undefined,
    describePluginContents: () => [],
    connectorSetup: async (id) => connectorSetup?.(id),
  };
}

/** A turn over these plugins, the working model following `script`. */
export function overCatalog(options: {
  readonly plugins: readonly MadeUpPlugin[];
  readonly script: (request: number, sent: ModelRequest) => Step;
  readonly route?: ReturnType<TestHost["toolLoading"]>;
  /** The workspace's own tools; one, read_file, when not given. */
  readonly workspaceTools?: readonly string[];
  /** What a made-up tool answers; that it ran, when not given. */
  readonly answer?: (name: string) => unknown;
  /** More of the loop's dependencies, such as the model's window. */
  readonly more?: Partial<LoopTestDependencies>;
  /** The directory's marks as they stand, in place of each plugin's own. */
  readonly readiness?: MadeUpReadiness;
  /** The setup card the capabilities answer for an id. */
  readonly connectorSetup?: (id: string) => SetupSuggestion | undefined;
}): CatalogFixture {
  const requests: ModelRequest[] = [];
  const ran: { name: string; args: unknown }[] = [];
  const base = stubDependencies(() => {});
  const workspaceTools = (options.workspaceTools ?? ["read_file"]).map(
    madeUpTool,
  );
  const inspect = async (
    name: string,
    args: unknown,
  ): Promise<ToolCallInspection> => ({
    ok: true,
    action: `Run ${name}`,
    target: (args as { path?: string }).path ?? "the workspace",
    command: `${name}(${JSON.stringify(args)})`,
  });
  const { host } = loopAndHost({
    ...base,
    ...(options.route ? { route: options.route } : {}),
    capabilitiesWith: () =>
      madeUpCatalog(
        options.plugins,
        workspaceTools,
        options.readiness,
        options.connectorSetup,
      ),
    tools: {
      list: () => workspaceTools,
      inspect,
      execute: async (name: string, args: unknown) => {
        ran.push({ name, args });
        return {
          ok: true as const,
          value: options.answer?.(name) ?? `${name} ran.`,
        };
      },
    } as never,
    permissions: {
      decide: async (request: { readonly name: string }) =>
        request.name.startsWith("write_")
          ? { outcome: "ask" as const, reason: "Changes a file." }
          : { outcome: "allow" as const, reason: "Reads only." },
    } as never,
    model: {
      ...base.model,
      send: async function* (
        request: ModelRequest,
      ): AsyncGenerator<ModelEvent> {
        requests.push(request);
        const step = options.script(requests.length, request);
        if ("text" in step) yield { kind: "textDelta", text: step.text };
        else
          for (const [index, call] of step.calls.entries())
            yield {
              kind: "toolCallDelta",
              index,
              callId: call.id ?? `call-${requests.length}-${index}`,
              name: call.name,
              argumentsDelta:
                typeof call.args === "string"
                  ? call.args
                  : JSON.stringify(call.args),
            };
        yield { kind: "done" };
      },
    },
    ...options.more,
  });
  return { loop: host.app, host, requests, ran };
}

/** What a request says a call returned, as it was sent. */
export function answerTo(
  request: ModelRequest | undefined,
  callId: string,
): string {
  const message = request?.messages.find(
    (item) => item.role === "tool" && item.toolCallId === callId,
  );
  if (!message || typeof message.content !== "string")
    throw new Error(`No answer to ${callId}.`);
  return message.content;
}

/** The start of a request: its system messages, and the tools it offers. */
export function startOf(request: ModelRequest | undefined): string {
  return JSON.stringify({
    system: (request?.messages ?? []).filter(
      (message) => message.role === "system",
    ),
    tools: request?.tools ?? [],
  });
}

export function toolNames(request: ModelRequest | undefined): string[] {
  return (request?.tools ?? []).map((tool) => tool.name);
}
