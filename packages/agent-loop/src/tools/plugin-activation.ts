import {
  PLUGIN_SWITCHED_OFF,
  type PluginDirectoryEntry,
  type ToolSpec,
} from "@zhiyin/contract";
import type { ConversationTools, PluginContents } from "@zhiyin/capabilities";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { AssembledToolCall } from "../turn/turn-shared.js";
import { gatherTools } from "./tool-gathering.js";

export const activatePluginTool: ToolSpec = {
  name: "activate_plugin",
  description:
    "Activate one enabled plugin, adding its skills, specialists, and connectors to context from this point in the conversation.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The plugin id, from the plugin directory.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
};

type ActivatePluginRequest = { readonly id: string };

function activatePluginRequest(
  value: unknown,
): ActivatePluginRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== "id") ||
    typeof record["id"] !== "string" ||
    !record["id"].trim()
  )
    return;
  return { id: record["id"].trim() };
}

/**
 * Resolves a proposed activation against the current directory, without
 * touching any store. One seam so the checks are made wherever a turn can
 * activate a plugin, not duplicated at each call site.
 */
function resolveActivation(
  request: ActivatePluginRequest | undefined,
  pluginDirectory: readonly PluginDirectoryEntry[],
):
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: string } {
  if (!request)
    return { ok: false, reason: "Choose one enabled plugin by id." };
  const entry = pluginDirectory.find((item) => item.id === request.id);
  if (!entry) return { ok: false, reason: "That plugin is not enabled." };
  if (entry.switchedOff) return { ok: false, reason: PLUGIN_SWITCHED_OFF };
  if (entry.activated)
    return { ok: false, reason: "That plugin is already active." };
  return { ok: true, id: entry.id };
}

type ActivatePluginResult =
  | ({ readonly ok: true; readonly id: string } & PluginContents)
  | { readonly ok: false; readonly reason: string };

/** What activating a plugin changes for the rest of the turn, once accepted. */
export type ActivationOutcome = {
  readonly result: ActivatePluginResult;
  readonly activatedPlugins: readonly string[];
  readonly tools: readonly ToolSpec[];
  readonly skills: ConversationTools["skills"];
  readonly specialists: ConversationTools["specialists"];
  readonly pluginDirectory: readonly PluginDirectoryEntry[];
  readonly ownerOf: ConversationTools["ownerOf"];
};

/**
 * Resolves a proposed activation and, once accepted, persists it durably and
 * re-gathers tools with the widened set — one seam so a turn's tool list is
 * never left stale after activation, wherever it is checked.
 */
export class PluginActivation {
  readonly #deps: AgentLoopDependencies;
  readonly #records: TurnRecords;

  constructor(deps: AgentLoopDependencies, parts: { records: TurnRecords }) {
    this.#deps = deps;
    this.#records = parts.records;
  }

  async activate(options: {
    readonly taskId: string;
    readonly call: AssembledToolCall;
    readonly parsedArguments: unknown;
    readonly pluginDirectory: readonly PluginDirectoryEntry[];
    readonly activatedPlugins: readonly string[];
    readonly tools: readonly ToolSpec[];
    readonly skills: ConversationTools["skills"];
    readonly specialists: ConversationTools["specialists"];
    readonly ownerOf: ConversationTools["ownerOf"];
  }): Promise<ActivationOutcome> {
    const unchanged: Omit<ActivationOutcome, "result"> = {
      activatedPlugins: options.activatedPlugins,
      tools: options.tools,
      skills: options.skills,
      specialists: options.specialists,
      pluginDirectory: options.pluginDirectory,
      ownerOf: options.ownerOf,
    };
    const resolved = resolveActivation(
      activatePluginRequest(options.parsedArguments),
      options.pluginDirectory,
    );
    if (!resolved.ok) return { result: resolved, ...unchanged };
    const contents = await this.#deps.capabilities.pluginContents(resolved.id);
    if (!contents)
      return {
        result: { ok: false, reason: "That plugin is not enabled." },
        ...unchanged,
      };
    const entry = options.pluginDirectory.find(
      (candidate) => candidate.id === resolved.id,
    );
    const pluginName = entry?.name ?? resolved.id;
    const inspection = {
      ok: true as const,
      action: `Activate ${pluginName}`,
      target: pluginName,
      command: `activate_plugin(${JSON.stringify({ id: resolved.id })})`,
      invocation: {
        name: "Activate plugin",
        arguments: [{ name: "Plugin", value: pluginName }],
      },
    };
    const presentation = {
      title: `Activate ${pluginName}`,
      description:
        "Make this plugin's components available in this conversation.",
    };
    const actionId = this.#records.nextActionId(options.taskId);
    await this.#records.recordToolAction(options.taskId, actionId, {
      inspection,
      presentation,
      status: "running",
      call: options.call,
      approval: {
        by: "no-approval-needed",
        at: this.#deps.now().toISOString(),
        reason: "Activating a plugin in this conversation.",
      },
    });
    const activatedPlugins = [...options.activatedPlugins, resolved.id];
    const task = this.#records.task(options.taskId);
    await this.#records.replaceTask({ ...task, activatedPlugins });
    const refreshed = await gatherTools(
      this.#deps,
      this.#records,
      options.taskId,
      activatedPlugins,
    );
    if (!refreshed.ok) {
      // Kept active, it would fail every later gathering in the conversation.
      await this.#records.replaceTask({
        ...this.#records.task(options.taskId),
        activatedPlugins: options.activatedPlugins,
      });
      const failed = {
        ok: false as const,
        reason: `The plugin could not be activated: ${refreshed.reason}`,
      };
      await this.#records.finishToolAction(
        options.taskId,
        options.call,
        actionId,
        { inspection, presentation, status: "failed", result: failed },
      );
      return { result: failed, ...unchanged };
    }
    // Read again: gathering the tools reached the plugin's connectors for
    // the first time, and one that refused now says what it needs.
    const reached =
      (await this.#deps.capabilities.pluginContents(resolved.id)) ?? contents;
    const result: ActivatePluginResult = {
      ok: true,
      id: resolved.id,
      ...reached,
    };
    await this.#records.finishToolAction(
      options.taskId,
      options.call,
      actionId,
      {
        inspection,
        presentation,
        status: "completed",
        result: {
          ok: true,
          value: result,
          details: this.#deps.capabilities.describePluginContents(reached),
        },
      },
    );
    return {
      result,
      activatedPlugins,
      tools: refreshed.value.tools,
      skills: refreshed.value.skills,
      specialists: refreshed.value.specialists,
      pluginDirectory: refreshed.value.pluginDirectory,
      ownerOf: refreshed.value.ownerOf,
    };
  }
}
