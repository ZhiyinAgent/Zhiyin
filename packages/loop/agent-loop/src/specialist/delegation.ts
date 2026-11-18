/**
 * Delegating to a specialist, as a tool of the loop's own in a turn: offered
 * while the turn has specialists, named to exactly those, and counting what
 * the turn has delegated so far.
 */

import type {
  SpecialistDefinition,
  ToolOwner,
  ToolSpec,
  WorkspaceDescription,
} from "@zhiyin/contract";
import type { ModelMessage } from "@zhiyin/model-client";
import type { LoopTool } from "../round/loop-tool.js";
import type { WorkLimits } from "../turn/work-limits.js";
import {
  maxDelegatedChildren,
  type SpecialistExecution,
} from "./specialist-execution.js";

const delegateSpecialistToolName = "delegate_specialist";

/** A specialist's budget as the model reads it: "30 minutes, $10 (or 70 CNY) and 40 tool rounds". */
function budgetOf(limits: WorkLimits): string {
  const minutes = limits.maximumElapsedMs / 60_000;
  const time = Number.isInteger(minutes)
    ? `${minutes} minute${minutes === 1 ? "" : "s"}`
    : `${Math.round(limits.maximumElapsedMs / 1000)} seconds`;
  const others = Object.entries(limits.maximumProviderCosts ?? {}).map(
    ([currency, amount]) => `${amount} ${currency}`,
  );
  const money = `$${limits.maximumProviderCostUsd}${others.length ? ` (or ${others.join(" or ")})` : ""}`;
  const parts = [
    time,
    money,
    ...(limits.maximumToolRounds === undefined
      ? []
      : [`${limits.maximumToolRounds} tool rounds`]),
  ];
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * Named to the exact specialists a turn may delegate to, every enabled
 * plugin's whether it is active or not, so the model does not have to already
 * know a valid id by some other means and the tool stays the same as plugins
 * activate (ADR 0017). A specialist of a plugin not enabled cannot be named.
 */
function delegateSpecialistTool(
  specialists: readonly SpecialistDefinition[],
  limits: WorkLimits,
): ToolSpec {
  return {
    name: delegateSpecialistToolName,
    description: [
      "Delegate one narrow part of the current task to an enabled specialist and receive its report.",
      `A turn may delegate to at most ${maxDelegatedChildren} specialists. Each works for at most ${budgetOf(limits)}, then reports what it has.`,
      "Available specialists:",
      ...specialists.map(
        (specialist) => `- ${specialist.id}: ${specialist.description}`,
      ),
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          enum: specialists.map((specialist) => specialist.id),
          description: "The enabled specialist id.",
        },
        task: {
          type: "string",
          description: "The exact bounded task to hand to the specialist.",
        },
      },
      required: ["id", "task"],
      additionalProperties: false,
    },
  };
}

/** What the turn has to hand a specialist, as it stands when one is delegated to. */
export type DelegationOffer = {
  readonly specialists: readonly SpecialistDefinition[];
  readonly activatedPlugins: readonly string[];
  readonly ownerOf: (name: string) => ToolOwner | undefined;
  readonly workspace: WorkspaceDescription;
  /** The tools a specialist is handed, before its role narrows them. */
  specialistTools(specialist: SpecialistDefinition): readonly ToolSpec[];
  /** The start of a specialist's requests, written for it as of `now`, naming the tools it has. */
  specialistStart(
    now: Date,
    tools: readonly ToolSpec[],
  ): readonly ModelMessage[];
  /** Activates a plugin, what the turn offers changing with it; why not, when it cannot be. */
  activate(plugin: string): Promise<string | undefined>;
};

export class Delegation implements LoopTool {
  readonly #execution: Pick<SpecialistExecution, "delegate" | "workLimits">;
  readonly #taskId: string;
  readonly #offer: DelegationOffer;
  readonly #now: () => Date;
  /** Specialists the turn has delegated to, those carried across a wake included. */
  #delegated: number;
  /** The run each call started, by the call. */
  readonly #started = new Map<string, string>();

  constructor(
    execution: Pick<SpecialistExecution, "delegate" | "workLimits">,
    turn: {
      readonly taskId: string;
      readonly offer: DelegationOffer;
      readonly now: () => Date;
      readonly delegated: number;
    },
  ) {
    this.#execution = execution;
    this.#taskId = turn.taskId;
    this.#offer = turn.offer;
    this.#now = turn.now;
    this.#delegated = turn.delegated;
  }

  specs(): readonly ToolSpec[] {
    const { specialists } = this.#offer;
    return specialists.length
      ? [delegateSpecialistTool(specialists, this.#execution.workLimits)]
      : [];
  }

  answers(name: string): boolean {
    return name === delegateSpecialistToolName;
  }

  /**
   * Hands a task to a specialist, and tells the model whether it was taken.
   * A specialist whose plugin is not active activates it first, so it works
   * with its plugin's tools.
   */
  async answer(
    call: { readonly callId: string },
    input: Record<string, unknown>,
  ): Promise<Readonly<Record<string, unknown>>> {
    const offer = this.#offer;
    const chosen = offer.specialists.find(
      (specialist) => specialist.id === input["id"],
    );
    const plugin = chosen?.provenance.pluginId;
    if (
      plugin &&
      this.#delegated < maxDelegatedChildren &&
      !offer.activatedPlugins.includes(plugin)
    ) {
      const reason = await offer.activate(plugin);
      if (reason) return { ok: false, reason };
    }
    const delegation = await this.#execution.delegate({
      taskId: this.#taskId,
      parentTurnId: this.#taskId,
      parsedArguments: input,
      specialists: offer.specialists,
      delegatedChildren: this.#delegated,
      toolsFor: (specialist) => offer.specialistTools(specialist),
      ownerOf: offer.ownerOf,
      start: (tools) => offer.specialistStart(this.#now(), tools),
      workspace: offer.workspace,
    });
    this.#delegated = delegation.delegatedChildren;
    if (delegation.result.ok)
      this.#started.set(call.callId, delegation.result.runId);
    return delegation.result;
  }

  startedRun(callId: string): string | undefined {
    return this.#started.get(callId);
  }
}
