import type { ConversationTools } from "@zhiyin/capabilities";
import type {
  ToolOwner,
  ToolSpec,
  WorkspaceDescription,
} from "@zhiyin/contract";
import type { ModelMessage } from "@zhiyin/model-client";
import { fixedModelMessages } from "../context/conversation-context.js";
import { advertisedTools, offeredTools } from "../plan/request-plan.js";
import type { ActivationOutcome } from "../tools/plugin-activation.js";

/**
 * What a turn offers the model, as it stands: the tools it may call, the
 * skills, specialists and plugins it is told about, and the start of its
 * requests, which names them. Activating a plugin changes all of it together,
 * so what the model is told about plugins and skills changes in the same
 * request as its tools: one new start for the provider to cache, not one now
 * and another next turn.
 */
export class TurnOffering {
  readonly workspace: WorkspaceDescription;
  readonly #startedAt: Date;
  #gathered: ConversationTools;
  #activatedPlugins: readonly string[];
  #fixedMessages: readonly ModelMessage[];

  constructor(start: {
    readonly workspace: WorkspaceDescription;
    readonly startedAt: Date;
    readonly gathered: ConversationTools;
    readonly activatedPlugins: readonly string[];
  }) {
    this.workspace = start.workspace;
    this.#startedAt = start.startedAt;
    this.#gathered = start.gathered;
    this.#activatedPlugins = start.activatedPlugins;
    this.#fixedMessages = this.#start();
  }

  get tools(): ConversationTools["tools"] {
    return this.#gathered.tools;
  }

  get skills(): ConversationTools["skills"] {
    return this.#gathered.skills;
  }

  get specialists(): ConversationTools["specialists"] {
    return this.#gathered.specialists;
  }

  get pluginDirectory(): ConversationTools["pluginDirectory"] {
    return this.#gathered.pluginDirectory;
  }

  get activatedPlugins(): readonly string[] {
    return this.#activatedPlugins;
  }

  /** Who answers for a name, as the tools stand now. */
  get ownerOf(): (name: string) => ToolOwner | undefined {
    return this.#gathered.ownerOf;
  }

  /** The start of every request of the turn, the same until a plugin is activated. */
  get fixedMessages(): readonly ModelMessage[] {
    return this.#fixedMessages;
  }

  /** The tools as the model is shown them. */
  advertised(): readonly ToolSpec[] {
    return advertisedTools(this.#gathered);
  }

  /** The tools as their own specs, which a call is checked against. */
  offered(): readonly ToolSpec[] {
    return offeredTools(this.#gathered);
  }

  /** The start of a specialist's requests, written for it as of `now`. */
  specialistStart(now: Date): readonly ModelMessage[] {
    return fixedModelMessages({
      workspace: this.workspace,
      skills: this.skills,
      pluginDirectory: this.pluginDirectory,
      now,
      tools: this.tools,
      reader: "specialist",
    });
  }

  /** Takes what activating a plugin left on offer, and starts requests anew. */
  adopt(activation: ActivationOutcome): void {
    this.#activatedPlugins = activation.activatedPlugins;
    this.#gathered = {
      tools: activation.tools,
      skills: activation.skills,
      specialists: activation.specialists,
      pluginDirectory: activation.pluginDirectory,
      ownerOf: activation.ownerOf,
    };
    this.#fixedMessages = this.#start();
  }

  #start(): readonly ModelMessage[] {
    return fixedModelMessages({
      workspace: this.workspace,
      skills: this.skills,
      pluginDirectory: this.pluginDirectory,
      now: this.#startedAt,
      tools: this.tools,
    });
  }
}
