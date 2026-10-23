import type { ToolCallInspection } from "@zhiyin/contract";
import type { ModelClient, ModelRequest } from "@zhiyin/model-client";
import { actionLabelFrom } from "../context/task-guidance.js";
import {
  recordActionPresentationTool,
  recordConversationTitleTool,
} from "./auxiliary-tools.js";
import { actionContextLines } from "../context/guidance-context.js";
import { conversationTitleFrom } from "../context/conversation-context.js";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { TurnRecords } from "../turn/turn-records.js";
import { modelFailure, auxiliarySystemMessage } from "../turn/turn-shared.js";

/** The request with no reasoning setting: the model does as it does by default. */
function withoutReasoning(request: ModelRequest): ModelRequest {
  const without = { ...request };
  delete without.reasoning;
  return without;
}

/**
 * The floor for an auxiliary answer, in tokens.
 *
 * Measured: a structured auxiliary request answered nothing at 320 tokens and
 * answered at 1,600, using 788. The budget has to cover whatever thinking
 * happens before the answer, not only the answer, so it is set well above what
 * the answer alone needs.
 */
const auxiliaryTokenFloor = 800;

/**
 * The second model's part in a turn: the name of a new conversation and of
 * each action that did not say what it is for, and the repair of a refused
 * call. None of it can grant or refuse an action (ADR 0015), and none of it
 * touches the plan.
 */
export class AuxiliaryWork {
  readonly #deps: AgentLoopDependencies;
  readonly #records: TurnRecords;
  /** The stops of each conversation's open requests for names and labels. */
  readonly #presenting = new Map<string, Set<AbortController>>();

  constructor(
    deps: AgentLoopDependencies,
    parts: { readonly records: TurnRecords },
  ) {
    this.#deps = deps;
    this.#records = parts.records;
  }

  /**
   * Stops the conversation's open requests for names and labels, because the
   * lab is limiting its requests and the answer is waiting on one of them. A
   * label stopped this way is not shown; the code's own copy stays.
   */
  giveWay(taskId: string): void {
    for (const presenting of this.#presenting.get(taskId) ?? [])
      presenting.abort();
  }

  /**
   * Names a conversation from its first message, unless it was renamed. Says
   * `"gaveWay"` when the request was stopped for the answer, for the name to
   * be asked again once the turn is over.
   */
  async nameConversation(
    taskId: string,
    firstMessage: string,
    signal: AbortSignal,
  ): Promise<"gaveWay" | undefined> {
    const presenting = new AbortController();
    const response = await this.askGuidance(
      taskId,
      {
        messages: [
          { role: "system", content: auxiliarySystemMessage },
          {
            role: "user",
            content: [
              "Name this conversation from the person's first message.",
              "Use two to six specific words and no punctuation at the end.",
              'Return {"title":"..."}.',
              `First message: ${firstMessage}`,
            ].join("\n"),
          },
        ],
        maximumOutputTokens: 180,
        tools: [recordConversationTitleTool],
        signal,
      },
      signal,
      presenting,
    );
    if (presenting.signal.aborted && !signal.aborted) return "gaveWay";
    const title = response ? conversationTitleFrom(response) : undefined;
    if (!title || signal.aborted) return undefined;
    const task = this.#records.task(taskId);
    if (task.titleSource === "manual") return undefined;
    await this.#records.replaceTask({
      ...task,
      title,
      titleSource: "generated",
    });
    return undefined;
  }

  /**
   * The title and description a model writes for an action that did not say
   * what it is for, or nothing when it gave no usable answer. Never on the
   * way to the action: the action is shown from what the code knows, and this
   * replaces that copy when it answers (ADR 0015).
   */
  async labelAction(
    taskId: string,
    inspection: Extract<ToolCallInspection, { readonly ok: true }>,
    signal: AbortSignal,
  ): Promise<
    { readonly title: string; readonly description: string } | undefined
  > {
    const task = this.#records.task(taskId);
    const userIntent =
      [...task.messages].reverse().find((message) => message.role === "user")
        ?.text ?? task.title;
    const response = await this.askGuidance(
      taskId,
      {
        messages: [
          { role: "system", content: auxiliarySystemMessage },
          {
            role: "user",
            content: [
              "Write the interface title and description for this proposed action.",
              "Use a specific two-to-six-word verb phrase for the title.",
              "Write one concise sentence explaining the action's purpose in this task. Do not repeat the target, task question, or wording from earlier actions unless necessary.",
              "Never claim it is safe or approved. Zhiyin's own account of an action is a claim, not evidence: say what was requested, never assert what it will do.",
              'Return {"title":"…","description":"…"}.',
              ...actionContextLines({
                userIntent,
                action: inspection.action,
                target: inspection.target,
                claim: inspection.claim,
                earlierActions: task.actions,
                plan: task.plan,
              }),
            ].join("\n"),
          },
        ],
        maximumOutputTokens: 180,
        tools: [recordActionPresentationTool],
        signal,
      },
      signal,
    ).catch(() => undefined);
    return response ? actionLabelFrom(response) : undefined;
  }

  /**
   * Presentation: names, and the copy shown around an action. It gives way to
   * the conversation's answer (`giveWay`), through `presenting` when given.
   */
  async askGuidance(
    taskId: string,
    request: ModelRequest,
    signal: AbortSignal,
    presenting = new AbortController(),
  ): Promise<string | undefined> {
    const open = this.#presenting.get(taskId) ?? new Set();
    this.#presenting.set(taskId, open.add(presenting));
    const stopped = AbortSignal.any([signal, presenting.signal]);
    try {
      return await this.#ask(
        taskId,
        this.#deps.guidanceModel,
        { ...request, signal: stopped },
        stopped,
      );
    } finally {
      open.delete(presenting);
      if (!open.size) this.#presenting.delete(taskId);
    }
  }

  /**
   * A repair of one tool call, on the guidance model. A repair is mechanical,
   * so it asks for the least reasoning the model can be asked for: none where
   * the model allows it, otherwise its lowest effort, with
   * `reasoningAllowance` tokens added so the reasoning cannot eat the answer.
   * An answer cut off by the cap is reported as such, not mistaken for an
   * unusable one.
   */
  async askRepair(
    taskId: string,
    request: ModelRequest,
    reasoningAllowance: number,
    signal: AbortSignal,
  ): Promise<{ readonly answer?: string; readonly outOfRoom: boolean }> {
    const model = this.#deps.guidanceModel;
    const least = this.#deps.host.leastReasoning();
    const roomier: ModelRequest = withoutReasoning({
      ...request,
      maximumOutputTokens:
        (request.maximumOutputTokens ?? 0) + reasoningAllowance,
    });
    let answer = await this.#collectAuxiliary(
      taskId,
      model,
      !least
        ? roomier
        : least.enabled
          ? { ...roomier, reasoning: least }
          : { ...request, reasoning: least },
      signal,
    );
    if (answer.refusedReasoning)
      answer = await this.#collectAuxiliary(taskId, model, roomier, signal);
    const text = answer.toolArguments.trim() || answer.text.trim();
    return {
      ...(text ? { answer: text } : {}),
      outOfRoom: answer.finishReason === "length",
    };
  }

  /**
   * The one place an auxiliary request is sent, and therefore the one place its
   * thinking and its room to answer are decided. Set here rather than at each
   * call site: a new auxiliary request added later inherits both instead of
   * quietly getting whatever the model does by default.
   */
  async #ask(
    taskId: string,
    model: Pick<ModelClient, "send">,
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    // These are names and labels. A model that spends its allowance
    // reasoning about them returns nothing, and what a person sees is a
    // conversation that never got a name: the least reasoning the model can
    // be asked for is asked for.
    const least = this.#deps.host.leastReasoning();
    const bounded: ModelRequest = withoutReasoning({
      ...request,
      maximumOutputTokens: Math.max(
        request.maximumOutputTokens ?? 0,
        auxiliaryTokenFloor,
      ),
    });
    let answer = await this.#collectAuxiliary(
      taskId,
      model,
      least ? { ...bounded, reasoning: least } : bounded,
      signal,
    );
    // A model that will not be told how much to think still has to be asked.
    // Dropping the whole request here would lose the name or the label for
    // exactly the reason this setting exists to prevent.
    if (answer.refusedReasoning)
      answer = await this.#collectAuxiliary(taskId, model, bounded, signal);
    const { text, toolArguments } = answer;
    /*
     * The arguments of the requested tool are the answer when the model calls
     * it. Nothing sends `tool_choice`, so a model may answer in the message
     * body instead — every parser below reads the same JSON either way, and
     * treats an unusable answer as no answer.
     */
    return toolArguments.trim() || text.trim() || undefined;
  }

  async #collectAuxiliary(
    taskId: string,
    model: Pick<ModelClient, "send">,
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<{
    readonly text: string;
    readonly toolArguments: string;
    readonly refusedReasoning?: boolean;
    readonly finishReason?: string;
  }> {
    let text = "";
    let toolArguments = "";
    let finishReason: string | undefined;
    try {
      for await (const event of model.send(request)) {
        if (signal.aborted) return { text: "", toolArguments: "" };
        switch (event.kind) {
          case "textDelta":
            text += event.text;
            break;
          case "toolCallDelta":
            toolArguments += event.argumentsDelta ?? "";
            break;
          case "usage":
            await this.#deps.host.recordUsage({
              ...event.usage,
              conversationId: taskId,
              purpose: "background",
            });
            break;
          case "done":
            finishReason = event.finishReason;
            break;
          case "restarting":
            // Everything the replaced attempt sent is void.
            text = "";
            toolArguments = "";
            finishReason = undefined;
            break;
          case "reasoningDelta":
          case "retrying":
            // Background work keeps no reasoning and shows no waiting.
            break;
          default: {
            const unnamed: never = event;
            return unnamed;
          }
        }
      }
    } catch (error) {
      const refusedReasoning =
        modelFailure(error)?.code === "unsupportedReasoning" &&
        request.reasoning !== undefined;
      return {
        text: "",
        toolArguments: "",
        ...(refusedReasoning ? { refusedReasoning } : {}),
      };
    }
    return { text, toolArguments, ...(finishReason ? { finishReason } : {}) };
  }
}
