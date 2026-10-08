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

/**
 * The least thinking the model will do, asked for on every auxiliary request.
 *
 * These are names and labels. A model that spends its allowance reasoning
 * about them returns nothing, and what a person sees is a conversation that
 * never got a name.
 */
const auxiliaryReasoning = { enabled: true, effort: "minimal" } as const;

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
 * call. None of it can grant or refuse an action (ADR 0010), and none of it
 * touches the plan.
 */
export class AuxiliaryWork {
  readonly #deps: AgentLoopDependencies;
  readonly #records: TurnRecords;

  constructor(
    deps: AgentLoopDependencies,
    parts: { readonly records: TurnRecords },
  ) {
    this.#deps = deps;
    this.#records = parts.records;
  }

  /** Names a conversation from its first message, unless it was renamed. */
  async nameConversation(
    taskId: string,
    firstMessage: string,
    signal: AbortSignal,
  ): Promise<void> {
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
    );
    const title = response ? conversationTitleFrom(response) : undefined;
    if (!title || signal.aborted) return;
    const task = this.#records.task(taskId);
    if (task.titleSource === "manual") return;
    await this.#records.replaceTask({
      ...task,
      title,
      titleSource: "generated",
    });
  }

  /**
   * The title and description a model writes for an action that did not say
   * what it is for, or nothing when it gave no usable answer. Never on the
   * way to the action: the action is shown from what the code knows, and this
   * replaces that copy when it answers (ADR 0010).
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

  /** Presentation: names, and the copy shown around an action. */
  async askGuidance(
    taskId: string,
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    return this.#ask(taskId, this.#deps.guidanceModel, request, signal);
  }

  /**
   * A repair of one tool call, on the guidance model. A repair is mechanical,
   * so thinking is turned off where the model allows it; where it does not,
   * the least thinking is asked for and `reasoningAllowance` tokens are added
   * so it cannot eat the answer. An answer cut off by the cap is reported as
   * such, not mistaken for an unusable one.
   */
  async askRepair(
    taskId: string,
    request: ModelRequest,
    reasoningAllowance: number,
    signal: AbortSignal,
  ): Promise<{ readonly answer?: string; readonly outOfRoom: boolean }> {
    const model = this.#deps.guidanceModel;
    let answer = await this.#collectAuxiliary(
      taskId,
      model,
      { ...request, reasoning: { enabled: false } },
      signal,
    );
    const roomier = {
      ...request,
      maximumOutputTokens:
        (request.maximumOutputTokens ?? 0) + reasoningAllowance,
    };
    if (answer.refusedReasoning)
      answer = await this.#collectAuxiliary(
        taskId,
        model,
        { ...roomier, reasoning: auxiliaryReasoning },
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
    const bounded: ModelRequest = {
      ...request,
      reasoning: auxiliaryReasoning,
      maximumOutputTokens: Math.max(
        request.maximumOutputTokens ?? 0,
        auxiliaryTokenFloor,
      ),
    };
    let answer = await this.#collectAuxiliary(taskId, model, bounded, signal);
    if (answer.refusedReasoning) {
      // A model that will not be told how much to think still has to be asked.
      // Dropping the whole request here would lose the name or the label for
      // exactly the reason this setting exists to prevent.
      const withoutReasoning = { ...bounded };
      delete withoutReasoning.reasoning;
      answer = await this.#collectAuxiliary(
        taskId,
        model,
        withoutReasoning,
        signal,
      );
    }
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
        if (event.kind === "textDelta") text += event.text;
        else if (event.kind === "toolCallDelta")
          toolArguments += event.argumentsDelta ?? "";
        else if (event.kind === "usage")
          await this.#deps.host.recordUsage({
            ...event.usage,
            conversationId: taskId,
            purpose: "background",
          });
        else if (event.kind === "done") finishReason = event.finishReason;
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
