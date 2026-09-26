import type {
  TaskPlanItem,
  ToolCallInspection,
  WorkspaceDescription,
} from "@zhiyin/contract";
import type { ModelClient, ModelRequest } from "@zhiyin/model-client";
import {
  actionLabelFrom,
  criterionEvaluationFrom,
  planFrom,
} from "./task-guidance.js";
import {
  recordActionPresentationTool,
  recordConversationTitleTool,
  recordCriterionEvaluationTool,
  recordPlanTool,
} from "./auxiliary-tools.js";
import { evidenceText } from "./evidence.js";
import { actionContextLines } from "./guidance-context.js";
import { conversationTitleFrom } from "./conversation-context.js";
import type { AgentLoopDependencies } from "./index.js";
import type { TurnRecords } from "./turn-records.js";
import {
  modelFailure,
  auxiliarySystemMessage,
  workspaceInventory,
} from "./turn-shared.js";

/**
 * The least thinking the model will do, asked for on every auxiliary request.
 *
 * These are labels, plans and short judgements about evidence already gathered.
 * A model that spends its allowance reasoning about them returns nothing, and
 * what a person sees is a plan that never appeared and a conversation that
 * never got a name - which is exactly what happened before this was set.
 */
const auxiliaryReasoning = { enabled: true, effort: "minimal" } as const;

/**
 * The floor for an auxiliary answer, in tokens.
 *
 * Measured 2026-09-08: a planning request answered nothing at 320 tokens and
 * returned a structured plan at 1,600, using 788. The budget has to cover
 * whatever thinking happens before the answer, not just the answer, so it is
 * set well above what the answer alone needs.
 */
const auxiliaryTokenFloor = 800;

/**
 * The second model's part in a turn: the plan, the name of each action, whether
 * a criterion was met, and the summary that compacts older context. None of it
 * can grant or refuse an action (ADR 0008).
 *
 * Two seams, not one. Writing a plan or naming an action is presentation, and a
 * weaker model there costs a slightly worse label. Judging whether evidence
 * satisfies a criterion, or distilling the summary every later turn is handed,
 * is judgement, and a weaker model there is wrong in ways nothing downstream
 * can detect. They were a single dependency once, so both followed whichever
 * model the person had selected, in either direction.
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

  async createPlan(
    taskId: string,
    userIntent: string,
    workspace: WorkspaceDescription,
    signal: AbortSignal,
    generateConversationTitle = false,
  ): Promise<void> {
    const response = await this.askGuidance(
      {
        messages: [
          { role: "system", content: auxiliarySystemMessage },
          {
            role: "user",
            content: [
              "Create an ordered plan for this task.",
              /*
               * A plan describes work a reviewer could watch happen. Asked
               * "who are you and what can you do?", the planner invented items
               * about reading README.md; no tool ran, and the assessment then
               * honestly reported them unresolved. The assessment was right —
               * the plan should never have existed.
               */
              "Return no items when the request is answered by the reply itself and needs no work in the workspace: a question about Zhiyin, a definition, an opinion, a greeting, or a rewrite of text already supplied. A plan describes work a reviewer could watch happen.",
              "Otherwise use one to four concrete work items. Do not include model calls, response preparation, or other internal mechanics.",
              "Each criterion must describe evidence a reviewer can observe. Keep titles and criteria plain and specific.",
              "Use the workspace inventory below. Do not refer vaguely to supplied material or available context.",
              ...(generateConversationTitle
                ? [
                    "Also write a concise conversation title based on the person's first message. Use two to six specific words and no punctuation at the end.",
                    'Return {"conversationTitle":"...","items":[{"title":"...","criterion":"..."}]}.',
                  ]
                : ['Return {"items":[{"title":"...","criterion":"..."}]}.']),
              `Task: ${userIntent}`,
              workspaceInventory(workspace),
            ].join("\n"),
          },
        ],
        maximumOutputTokens: 1_600,
        tools: [recordPlanTool(generateConversationTitle)],
        signal,
      },
      signal,
    );
    const plan = response ? planFrom(response) : undefined;
    let generatedTitle =
      generateConversationTitle && response
        ? conversationTitleFrom(response)
        : undefined;
    if (generateConversationTitle && !generatedTitle && !signal.aborted) {
      const titleResponse = await this.askGuidance(
        {
          messages: [
            { role: "system", content: auxiliarySystemMessage },
            {
              role: "user",
              content: [
                "Name this conversation from the person's first message.",
                "Use two to six specific words and no punctuation at the end.",
                'Return {"title":"..."}.',
                `First message: ${userIntent}`,
              ].join("\n"),
            },
          ],
          maximumOutputTokens: 180,
          tools: [recordConversationTitleTool],
          signal,
        },
        signal,
      );
      generatedTitle = titleResponse
        ? conversationTitleFrom(titleResponse)
        : undefined;
    }
    if ((!plan && !generatedTitle) || signal.aborted) return;
    const task = this.#records.task(taskId);
    await this.#records.replaceTask({
      ...task,
      ...(plan ? { plan } : {}),
      ...(generatedTitle && task.titleSource !== "manual"
        ? { title: generatedTitle, titleSource: "generated" as const }
        : {}),
    });
  }

  /**
   * The title and description a model writes for an action that did not say
   * what it is for, or nothing when it gave no usable answer. Never on the
   * way to the action: the action is shown from what the code knows, and this
   * replaces that copy when it answers. It no longer guesses a plan item;
   * the working model names that itself (ADR 0052).
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
                earlierActions: task.actions ?? [],
                plan: task.plan ?? [],
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

  async evaluateRemainingCriteria(
    taskId: string,
    assistantText: string,
    signal: AbortSignal,
  ): Promise<void> {
    const pending = (this.#records.task(taskId).plan ?? []).filter(
      (item) => item.status !== "verified" && item.progress !== "cancelled",
    );
    for (const item of pending) {
      if (signal.aborted) return;
      await this.#updatePlanItem(taskId, item.id, (current) => ({
        ...current,
        status: "checking",
      }));
      const task = this.#records.task(taskId);
      const response = await this.askJudgement(
        {
          messages: [
            { role: "system", content: auxiliarySystemMessage },
            {
              role: "user",
              content: [
                "Decide whether this single criterion is satisfied by the final response and what each action returned.",
                "Use only the supplied evidence. An attempted action is not proof of its result.",
                'Return {"satisfied":true or false,"summary":"..."}.',
                `Criterion: ${item.criterion}`,
                `Final response: ${this.#boundedEvidence(assistantText)}`,
                `Actions: ${this.#boundedEvidence(
                  (task.actions ?? []).map(
                    ({
                      action,
                      description,
                      target,
                      status,
                      reason,
                      evidence,
                    }) => ({
                      action,
                      description,
                      target,
                      status,
                      reason,
                      /*
                       * What the action returned, not merely that it ran. This
                       * list carried no results once, while the instruction
                       * above still told the model an attempt proves nothing —
                       * so any criterion resting on a tool's output was refused
                       * for want of evidence that was never sent. Bounded per
                       * action first, so one long result cannot crowd the rest
                       * out of the whole-list bound below.
                       */
                      ...(evidence
                        ? { returned: evidenceText(evidence, 600) }
                        : {}),
                    }),
                  ),
                )}`,
              ].join("\n"),
            },
          ],
          maximumOutputTokens: 140,
          tools: [recordCriterionEvaluationTool],
          signal,
        },
        signal,
      );
      if (signal.aborted) return;
      const evaluation = response
        ? criterionEvaluationFrom(response)
        : undefined;
      await this.#updatePlanItem(taskId, item.id, (current) =>
        evaluation?.satisfied
          ? {
              ...current,
              status: "verified",
              verification: evaluation.summary,
            }
          : {
              ...current,
              status: item.status,
            },
      );
    }
  }

  /** Presentation: plans, labels, and the copy shown around an action. */
  async askGuidance(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    return this.#ask(this.#deps.guidanceModel, request, signal);
  }

  /** Judgement: what the evidence shows, and what the summary must preserve. */
  async askJudgement(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    return this.#ask(this.#deps.judgementModel, request, signal);
  }

  /**
   * A repair of one tool call, on the guidance model. A repair is mechanical,
   * so thinking is turned off where the model allows it; where it does not,
   * the least thinking is asked for and `reasoningAllowance` tokens are added
   * so it cannot eat the answer. An answer cut off by the cap is reported as
   * such, not mistaken for an unusable one.
   */
  async askRepair(
    request: ModelRequest,
    reasoningAllowance: number,
    signal: AbortSignal,
  ): Promise<{ readonly answer?: string; readonly outOfRoom: boolean }> {
    const model = this.#deps.guidanceModel;
    let answer = await this.#collectAuxiliary(
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
        model,
        { ...roomier, reasoning: auxiliaryReasoning },
        signal,
      );
    if (answer.refusedReasoning)
      answer = await this.#collectAuxiliary(model, roomier, signal);
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
    let answer = await this.#collectAuxiliary(model, bounded, signal);
    if (answer.refusedReasoning) {
      // A model that will not be told how much to think still has to be asked.
      // Dropping the whole request here would lose the plan and the name for
      // exactly the reason this setting exists to prevent.
      const withoutReasoning = { ...bounded };
      delete withoutReasoning.reasoning;
      answer = await this.#collectAuxiliary(model, withoutReasoning, signal);
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
          await this.#deps.host.recordUsage(event.usage);
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

  #boundedEvidence(value: unknown): string {
    return evidenceText(value, 4000);
  }

  async #updatePlanItem(
    taskId: string,
    itemId: string,
    update: (item: TaskPlanItem) => TaskPlanItem,
  ): Promise<void> {
    const task = this.#records.task(taskId);
    if (!task.plan?.some((item) => item.id === itemId)) return;
    await this.#records.replaceTask({
      ...task,
      plan: task.plan.map((item) => (item.id === itemId ? update(item) : item)),
    });
  }
}
