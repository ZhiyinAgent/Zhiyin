import type { PluginDirectoryEntry, ToolSpec } from "@zhiyin/contract";
import type { ConversationTools, PluginContents } from "@zhiyin/capabilities";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { AssembledToolCall } from "../turn/turn-shared.js";

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

export type ActivatePluginRequest = { readonly id: string };

export function activatePluginRequest(
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
export function resolveActivation(
  request: ActivatePluginRequest | undefined,
  pluginDirectory: readonly PluginDirectoryEntry[],
):
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: string } {
  if (!request)
    return { ok: false, reason: "Choose one enabled plugin by id." };
  const entry = pluginDirectory.find((item) => item.id === request.id);
  if (!entry) return { ok: false, reason: "That plugin is not enabled." };
  if (entry.activated)
    return { ok: false, reason: "That plugin is already active." };
  return { ok: true, id: entry.id };
}

export type ActivatePluginResult =
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
    await this.#records.recordToolAction(
      options.taskId,
      actionId,
      inspection,
      presentation,
      "running",
      undefined,
      options.call,
      {
        by: "no-approval-needed",
        at: this.#deps.now().toISOString(),
        reason: "Activating a plugin in this conversation.",
      },
    );
    const activatedPlugins = [...options.activatedPlugins, resolved.id];
    const task = this.#records.task(options.taskId);
    await this.#records.replaceTask({ ...task, activatedPlugins });
    const refreshed = await this.#deps.capabilities.toolsFor(options.taskId, {
      skills: this.#deps.host.capabilitiesAvailable(),
      activatedPlugins,
    });
    const result: ActivatePluginResult = {
      ok: true,
      id: resolved.id,
      ...contents,
    };
    await this.#records.finishToolAction(
      options.taskId,
      options.call,
      actionId,
      inspection,
      presentation,
      "completed",
      undefined,
      {
        ok: true,
        value: result,
        details: this.#deps.capabilities.describePluginContents(contents),
      },
    );
    return {
      result,
      activatedPlugins,
      tools: refreshed.ok ? refreshed.value.tools : options.tools,
      skills: refreshed.ok ? refreshed.value.skills : options.skills,
      specialists: refreshed.ok
        ? refreshed.value.specialists
        : options.specialists,
      pluginDirectory: refreshed.ok
        ? refreshed.value.pluginDirectory
        : options.pluginDirectory,
      ownerOf: refreshed.ok ? refreshed.value.ownerOf : options.ownerOf,
    };
  }
}
