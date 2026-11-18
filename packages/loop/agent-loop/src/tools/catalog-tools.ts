/**
 * The catalog of what the enabled plugins bring, as tools of the loop's own
 * (ADR 0017): `find` searches it, `open` reads one entry whole, and on a lab
 * that cannot load tools while a conversation runs, `call` runs an opened
 * tool. Opening an entry activates its plugin. A skill or a toolkit opened is
 * Zhiyin's guidance, answered as its notice; a page, a function or an API
 * change is reference, fenced as data (ADR 0016).
 */

import {
  PLUGIN_SWITCHED_OFF,
  type CatalogEntryKind,
  type PluginDirectoryEntry,
  type ToolInvocation,
  type ToolSpec,
} from "@zhiyin/contract";
import type { CatalogOpening, OfferedToolkit } from "@zhiyin/capabilities";
import type { AgentLoopDependencies } from "../dependencies.js";
import { Spoken, type LoopAnswer, type LoopTool } from "../round/loop-tool.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { AssembledToolCall } from "../turn/turn-shared.js";
import { selfDescribing } from "../context/self-description.js";
import { callTool } from "./bridged-call.js";
import { bridgedSchemas, openToolName } from "./opened-entries.js";
import { refusal } from "./refusals.js";

/** How an opened toolkit reaches the model (ADR 0017). */
export type ToolRoute = "native" | "bridge" | "list";

const catalogKinds: readonly CatalogEntryKind[] = [
  "toolkit",
  "skill",
  "function",
  "doc",
  "break",
];

const findToolName = "find";

const findTool: ToolSpec = {
  name: findToolName,
  description:
    "Search the catalog of what the enabled plugins bring: toolkits of tools, skills, library functions, reference pages and known API changes. Answers up to five entries as id: title: summary. Search when a task may need what a plugin brings, before assuming a capability is unavailable, and open only what the task needs.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What you need, in words." },
      kind: {
        type: "string",
        enum: catalogKinds,
        description: "Only entries of this kind.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const openTool: ToolSpec = {
  name: openToolName,
  description:
    "Open one catalog entry by its id: a skill's guidance, a toolkit's tools, a page. A plugin's id from the plugin directory activates that plugin.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "A catalog id, as toolkit:… or skill:…, or a plugin id.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
};

/**
 * What an entry opened is answered with. A toolkit reached through `call`
 * carries its tools' schemas after its list, each with the purpose every
 * call gives.
 */
export function openingAnswer(
  opening: Extract<CatalogOpening, { readonly ok: true }>,
  route: ToolRoute,
): Spoken {
  if (opening.voice === "reference") return Spoken.output(opening.text);
  if (opening.entry.kind !== "toolkit")
    return Spoken.notice("skill", opening.text);
  return Spoken.notice(
    "toolkit",
    route === "bridge"
      ? `${opening.text}\n\n${bridgedSchemas((opening.tools ?? []).map(selfDescribing))}`
      : opening.text,
  );
}

/** What the catalog's tools read and change of what the turn offers. */
export type CatalogOffer = {
  readonly pluginDirectory: readonly PluginDirectoryEntry[];
  readonly activatedPlugins: readonly string[];
  readonly route: ToolRoute;
  toolkit(id: string): OfferedToolkit | undefined;
  /** Activates a plugin, what the turn offers changing with it; why not, when it cannot be. */
  activate(plugin: string): Promise<string | undefined>;
  /** Gathers the tools again, for a toolkit that connected as it was opened. */
  gatherAgain(): Promise<void>;
};

export type CatalogToolsDependencies = Pick<
  AgentLoopDependencies,
  "capabilities" | "now"
>;

function textArgument(
  input: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = input[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export class CatalogTools implements LoopTool {
  readonly #deps: CatalogToolsDependencies;
  readonly #records: TurnRecords;
  readonly #taskId: string;
  readonly #offer: CatalogOffer;

  constructor(
    deps: CatalogToolsDependencies,
    turn: {
      readonly records: TurnRecords;
      readonly taskId: string;
      readonly offer: CatalogOffer;
    },
  ) {
    this.#deps = deps;
    this.#records = turn.records;
    this.#taskId = turn.taskId;
    this.#offer = turn.offer;
  }

  /** Offered while any plugin is enabled; `call` only where opened tools go through it. */
  specs(): readonly ToolSpec[] {
    if (!this.#offer.pluginDirectory.some((entry) => !entry.switchedOff))
      return [];
    return [
      findTool,
      openTool,
      ...(this.#offer.route === "bridge" ? [callTool] : []),
    ];
  }

  answers(name: string): boolean {
    return name === findToolName || name === openToolName;
  }

  async answer(
    call: AssembledToolCall,
    input: Record<string, unknown>,
  ): Promise<LoopAnswer> {
    return call.name === findToolName
      ? this.#find(call, input)
      : this.#open(call, input);
  }

  async #find(
    call: AssembledToolCall,
    input: Record<string, unknown>,
  ): Promise<LoopAnswer> {
    const query = textArgument(input, "query");
    if (!query)
      return refusal(
        "input-check",
        "find takes what to search for in query.",
        "Send find again with a query.",
      );
    const kind = catalogKinds.find((item) => item === input["kind"]);
    const entries = await this.#deps.capabilities.catalogFind(
      this.#taskId,
      query,
      kind,
    );
    const text = entries.length
      ? entries
          .map((entry) => `${entry.id}: ${entry.title}: ${entry.summary}`)
          .join("\n")
      : "Nothing in the catalog matches that.";
    await this.#recordRead(call, {
      title: "Search the catalog",
      description: "Find what the enabled plugins bring for this.",
      target: query,
      invocation: {
        name: "Search the catalog",
        arguments: [
          { name: "Query", value: query },
          ...(kind ? [{ name: "Kind", value: kind }] : []),
        ],
      },
      text,
    });
    return Spoken.output(text);
  }

  async #open(
    call: AssembledToolCall,
    input: Record<string, unknown>,
  ): Promise<LoopAnswer> {
    const id = textArgument(input, "id");
    if (!id)
      return refusal(
        "input-check",
        "open takes one catalog id, or a plugin id, in id.",
        "Send open again with the id find or the plugin directory gave.",
      );
    const plugin = this.#offer.pluginDirectory.find((entry) => entry.id === id);
    if (plugin) return this.#openPlugin(call, plugin);
    const opening = await this.#deps.capabilities.catalogOpen(this.#taskId, id);
    if (!opening.ok) return { ok: false, reason: opening.reason };
    if (!this.#offer.activatedPlugins.includes(opening.plugin)) {
      const reason = await this.#offer.activate(opening.plugin);
      if (reason) return { ok: false, reason };
    }
    if (
      opening.entry.kind === "toolkit" &&
      !this.#offer.toolkit(opening.entry.id)
    )
      await this.#offer.gatherAgain();
    await this.#recordRead(call, {
      title: `Open ${opening.entry.title}`,
      description:
        opening.entry.kind === "toolkit"
          ? "Load this toolkit's tools in this conversation."
          : opening.entry.kind === "skill"
            ? "Read this skill's guidance."
            : "Read this reference.",
      target: opening.entry.id,
      invocation: {
        name: "Open",
        arguments: [{ name: "Entry", value: opening.entry.id }],
      },
      text: opening.text,
    });
    return openingAnswer(opening, this.#offer.route);
  }

  /**
   * Activates a plugin by its id, answering with its contents as they stand
   * once its connectors were reached for the first time, so one that refused
   * says what it needs in that same answer.
   */
  async #openPlugin(
    call: AssembledToolCall,
    entry: PluginDirectoryEntry,
  ): Promise<LoopAnswer> {
    if (entry.switchedOff) return { ok: false, reason: PLUGIN_SWITCHED_OFF };
    if (this.#offer.activatedPlugins.includes(entry.id))
      return {
        ok: false,
        reason: "That plugin is already active: its tools are on offer.",
      };
    const { capabilities } = this.#deps;
    const contents = await capabilities.pluginContents(entry.id);
    if (!contents) return { ok: false, reason: "That plugin is not enabled." };
    const inspection = {
      ok: true as const,
      action: `Activate ${entry.name}`,
      target: entry.name,
      command: `${openToolName}(${JSON.stringify({ id: entry.id })})`,
      invocation: {
        name: "Activate plugin",
        arguments: [{ name: "Plugin", value: entry.name }],
      },
    };
    const presentation = {
      title: `Activate ${entry.name}`,
      description:
        "Make this plugin's components available in this conversation.",
    };
    const actionId = this.#records.nextActionId(this.#taskId);
    await this.#records.recordToolAction(this.#taskId, actionId, {
      inspection,
      presentation,
      status: "running",
      call,
      approval: {
        by: "no-approval-needed",
        at: this.#deps.now().toISOString(),
        reason: "Activating a plugin in this conversation.",
      },
    });
    const refused = await this.#offer.activate(entry.id);
    if (refused) {
      const failed = { ok: false as const, reason: refused };
      await this.#records.finishToolAction(this.#taskId, call, actionId, {
        inspection,
        presentation,
        status: "failed",
        result: failed,
      });
      return failed;
    }
    // Read again: gathering the tools reached the plugin's connectors for
    // the first time, and one that refused now says what it needs.
    const reached = (await capabilities.pluginContents(entry.id)) ?? contents;
    const result = { ok: true as const, id: entry.id, ...reached };
    await this.#records.finishToolAction(this.#taskId, call, actionId, {
      inspection,
      presentation,
      status: "completed",
      result: {
        ok: true,
        value: result,
        details: capabilities.describePluginContents(reached),
      },
    });
    return result;
  }

  /** Keeps a read of the catalog with the conversation, as any action is kept. */
  async #recordRead(
    call: AssembledToolCall,
    read: {
      readonly title: string;
      readonly description: string;
      readonly target: string;
      readonly invocation: ToolInvocation;
      readonly text: string;
    },
  ): Promise<void> {
    const inspection = {
      ok: true as const,
      action: read.title,
      target: read.target,
      command: `${call.name}(${call.arguments})`,
      invocation: read.invocation,
    };
    const presentation = {
      title: read.title,
      description: read.description,
    };
    const actionId = this.#records.nextActionId(this.#taskId);
    await this.#records.recordToolAction(this.#taskId, actionId, {
      inspection,
      presentation,
      status: "running",
      call,
      readOnly: true,
      approval: {
        by: "no-approval-needed",
        at: this.#deps.now().toISOString(),
        reason: "Reading the catalog of the enabled plugins.",
      },
    });
    await this.#records.finishToolAction(this.#taskId, call, actionId, {
      inspection,
      presentation,
      status: "completed",
      result: { ok: true, value: read.text },
    });
  }
}
