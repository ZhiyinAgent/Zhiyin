/**
 * `suggest_setup`: the loop's own tool that shows the person a card for a
 * connector that is not ready, or a plugin they switched off, with a button
 * to that plugin's page in Plugins at its connectors. Everything the card
 * says is Zhiyin's, read from its declarations and what it found; the model
 * only names which connector. It reads nothing and changes nothing, so it
 * asks for no approval, and it is kept as the conversation's action like any
 * call.
 */

import type {
  ActionEffects,
  PluginDirectoryEntry,
  SetupSuggestion,
  TaskAction,
  ToolSpec,
} from "@zhiyin/contract";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { LoopAnswer, LoopTool } from "../round/loop-tool.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { AssembledToolCall } from "../turn/turn-shared.js";
import { nextTimelineSequence } from "../turn/timeline.js";
import { evidenceText } from "../context/evidence.js";
import { refusal } from "./refusals.js";

export const suggestSetupToolName = "suggest_setup";

const suggestSetupTool: ToolSpec = {
  name: suggestSetupToolName,
  description:
    "Show the person a card in the conversation for setting up a connector that is not ready, or for switching on a plugin they switched off. The card says what is needed, and its button opens that plugin's page in Plugins at its connectors. Give the connector's id as a plugin's needs in the plugin directory name it, such as research/tavily, or a switched-off plugin's id. Zhiyin writes the card; tell the person in your own words as well.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          "A connector's id from a plugin's needs in the plugin directory, or a switched-off plugin's id.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
};

/** Showing a card: Zhiyin's own records read, nothing changed or sent. */
const showsCard: ActionEffects = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
};

/** What the card asks the person to do, as the model is told it was shown. */
function setupAsked(suggestion: SetupSuggestion): string {
  const { plugin, connector } = suggestion;
  const steps = [
    ...(plugin.switchedOff ? [`switch on ${plugin.name}`] : []),
    ...(connector?.needs
      ? [
          {
            key: `add ${connector.name}'s ${connector.setup?.keyName ?? "key"}`,
            "sign-in": `sign in to ${connector.name}`,
            install: `install what ${connector.name} needs`,
            "could-not-start": `check ${connector.name} again`,
            "switched-off": `switch ${connector.name} on`,
          }[connector.needs],
        ]
      : []),
  ];
  return `${steps.join(" and ")}, on ${plugin.name}'s page in Plugins`;
}

export type SetupCardDependencies = Pick<
  AgentLoopDependencies,
  "capabilities" | "now"
>;

export class SetupCards implements LoopTool {
  readonly #deps: SetupCardDependencies;
  readonly #records: TurnRecords;
  readonly #taskId: string;
  readonly #directory: () => readonly PluginDirectoryEntry[];

  constructor(
    deps: SetupCardDependencies,
    turn: {
      readonly records: TurnRecords;
      readonly taskId: string;
      /** The plugin directory as it stands. */
      readonly directory: () => readonly PluginDirectoryEntry[];
    },
  ) {
    this.#deps = deps;
    this.#records = turn.records;
    this.#taskId = turn.taskId;
    this.#directory = turn.directory;
  }

  /** Offered while any plugin is listed, so the tools stay the same as connectors are set up. */
  specs(): readonly ToolSpec[] {
    return this.#directory().length ? [suggestSetupTool] : [];
  }

  answers(name: string): boolean {
    return name === suggestSetupToolName;
  }

  async answer(
    call: AssembledToolCall,
    input: Record<string, unknown>,
  ): Promise<LoopAnswer> {
    const value = input["id"];
    const id = typeof value === "string" ? value.trim() : "";
    if (!id)
      return refusal(
        "input-check",
        "suggest_setup takes one connector's or plugin's id, in id.",
        "Send it again with the id the plugin directory gives.",
      );
    const suggestion = await this.#deps.capabilities.connectorSetup(id);
    if (!suggestion)
      return refusal(
        "tool",
        `There is nothing to set up for “${id}”: it is ready or not reached yet, or no plugin in the directory has it.`,
        "Use a connector's id as a plugin's needs in the plugin directory give it, or a switched-off plugin's id.",
      );
    const asked = setupAsked(suggestion);
    await this.#record(call, input, suggestion, asked);
    return {
      ok: true,
      shown: `The person was shown a card asking them to ${asked}, with a button that opens it.`,
    };
  }

  async #record(
    call: AssembledToolCall,
    input: Record<string, unknown>,
    suggestion: SetupSuggestion,
    asked: string,
  ): Promise<void> {
    const at = this.#deps.now().toISOString();
    const task = this.#records.task(this.#taskId);
    const named = suggestion.connector?.name ?? suggestion.plugin.name;
    const action: TaskAction = {
      id: this.#records.nextActionId(this.#taskId),
      action: `Suggest setting up ${named}`,
      description: `Asks you to ${asked}.`,
      target: named,
      toolName: call.name,
      callId: call.callId,
      command: evidenceText(`${call.name}(${JSON.stringify(input)})`, 2_000),
      effects: showsCard,
      readOnly: true,
      setup: suggestion,
      approval: {
        by: "no-approval-needed",
        at,
        reason: "Showing a card in the conversation.",
      },
      startedAt: at,
      finishedAt: at,
      status: "completed",
      sequence: nextTimelineSequence(task),
    };
    await this.#records.replaceTask({
      ...task,
      actions: [...task.actions, action],
    });
  }
}
