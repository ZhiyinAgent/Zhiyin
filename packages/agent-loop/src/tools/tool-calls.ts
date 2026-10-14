import type {
  ConversationPermission,
  ToolCallInspection,
  ToolInvocationResult,
  ToolOwner,
} from "@zhiyin/contract";
import type { RepairRejection } from "@zhiyin/audit";
import type { FileBackup } from "@zhiyin/rewind";
import { evidenceText } from "../context/evidence.js";
import {
  type RoundEvidence,
  ToolCallRepair,
  maximumRepairAttempts,
} from "./tool-repair.js";
import { type CallInput, CallInputs, type InputReading } from "./call-input.js";
import { readableToolName } from "./invocation.js";
import { correctableByModel, refusal, unknownTool } from "./refusals.js";
import { closedForPerson, shownToPerson } from "./document-reads.js";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { TurnRecords } from "../turn/turn-records.js";
import { isOwnDefect } from "../turn/turn-recovery.js";
import type { AuxiliaryWork } from "../specialist/auxiliary-work.js";
import type { TurnWaits } from "../turn/turn-waits.js";
import type {
  AssembledToolCall,
  PresentedAction,
} from "../turn/turn-shared.js";
import type { SelfDescription } from "../context/self-description.js";
import { factsLabel } from "../context/task-guidance.js";
import { approvalRecord, decideToolPermission } from "./tool-permission.js";
import { withSchemaProblems } from "./schema-problems.js";

/**
 * What a tool call produced, and whether the person was ever told about it. A
 * quiet outcome was answered to the model alone: no action record, no
 * permission request, nothing in the transcript.
 */
/** A call its tool looked at and did not refuse. */
type AllowedInspection = Extract<ToolCallInspection, { readonly ok: true }>;

type ToolCallOutcome = {
  readonly result: ToolInvocationResult;
  readonly quiet?: boolean;
  /**
   * The action this call was written down as, when it was written down at all.
   * Carried so that what happens to a picture after the record is made — being
   * scaled to fit the model — can be added to the same record.
   */
  readonly actionId?: string;
  /** A change to the workspace that succeeded: progress, to the loop guard. */
  readonly changed?: boolean;
  /** The step as the person's action list names it. */
  readonly title?: string;
  /** A person's denial stops the remaining calls in this model batch. */
  readonly denied?: boolean;
};

/** Bounded so a refused edit's arguments cannot fill the audit record. */
const auditedArguments = 2_000;

/**
 * How an action ended, as the person watching should see it.
 *
 * A tool that refused, broke, or was stopped failed. A tool that ran to
 * completion and came back with something other than success — a command that
 * exited non-zero — did not fail: it answered, and the answer is useful. The
 * model is handed the identical `ok: false` either way; only the marker a
 * person reads distinguishes them.
 */
/**
 * Whether a call is known to change nothing. It is the permission engine's
 * trust rule: a read declared by code the app wrote. A connector's read-only
 * annotation does not count, because the server describes itself.
 */
function changesNothing(
  owner: ToolOwner,
  inspection: Extract<ToolCallInspection, { readonly ok: true }>,
): boolean {
  return owner !== "mcp" && inspection.access === "read";
}

function outcomeStatus(
  result: ToolInvocationResult,
): "completed" | "reported" | "failed" {
  if (result.ok) return "completed";
  return result.reported ? "reported" : "failed";
}

/**
 * One tool call from proposal to result: inspection, a quiet repair when the
 * refusal allows one, the permission decision, the file backup, execution, and
 * the record of it.
 */
export class ToolCalls {
  readonly #deps: AgentLoopDependencies;
  readonly #records: TurnRecords;
  readonly #auxiliary: AuxiliaryWork;
  readonly #waits: TurnWaits;
  /** Re-aiming a refused call, which is its own piece of work. */
  readonly #repair: ToolCallRepair;
  /** Reading what the model streamed as a call's input. */
  readonly #inputs: CallInputs;

  constructor(
    deps: AgentLoopDependencies,
    parts: {
      readonly records: TurnRecords;
      readonly auxiliary: AuxiliaryWork;
      readonly waits: TurnWaits;
    },
  ) {
    this.#deps = deps;
    this.#records = parts.records;
    this.#auxiliary = parts.auxiliary;
    this.#waits = parts.waits;
    this.#repair = new ToolCallRepair({
      records: parts.records,
      auxiliary: parts.auxiliary,
      inspect: (taskId, owner, name, args) =>
        this.#inspectTool(taskId, owner, name, args),
      audit: (taskId, toolName, kind, reason, extra) =>
        this.#audit(taskId, toolName, kind, reason, extra),
    });
    this.#inputs = new CallInputs({
      repair: this.#repair,
      audit: (taskId, toolName, kind, reason, extra) =>
        this.#audit(taskId, toolName, kind, reason, extra),
      fail: (taskId, call, reason, _signal, specialistRunId) =>
        this.recordFailedProposal(taskId, call, {
          description: "The requested action used invalid input.",
          reason,
          specialistRunId,
        }),
    });
  }

  /**
   * The call's input as a tool would be handed it, or the refusal to answer
   * the model with. May correct `call.arguments` in place; see `CallInputs`.
   */
  readInput(
    taskId: string,
    call: AssembledToolCall,
    reading: InputReading,
  ): Promise<CallInput> {
    return this.#inputs.read(taskId, call, reading);
  }

  async runToolCall(
    taskId: string,
    call: AssembledToolCall,
    {
      proposedArguments,
      owner,
      controller,
      quietRetriesLeft,
      round,
      said = {},
      specialistRunId,
    }: {
      readonly proposedArguments: unknown;
      /** Absent for a tool nobody offers. */
      readonly owner: ToolOwner | undefined;
      readonly controller: AbortController;
      readonly quietRetriesLeft: number;
      readonly round: RoundEvidence;
      readonly said?: SelfDescription;
      readonly specialistRunId?: string;
    },
  ): Promise<ToolCallOutcome> {
    if (!owner) {
      const result = unknownTool(
        call.name,
        round.tools.map((tool) => tool.name),
      );
      await this.recordFailedProposal(taskId, call, {
        description: "Zhiyin requested a capability that is not connected.",
        reason: result.reason,
        specialistRunId,
        status: "failed",
        answer: result,
      });
      return { result };
    }

    const checked = await this.#inspected(taskId, call, {
      proposedArguments,
      owner,
      controller,
      quietRetriesLeft,
      round,
      specialistRunId,
    });
    if ("settled" in checked) return checked.settled;
    const { args, inspection } = checked;

    if (owner === "built-in" && inspection.requiresApproval === false) {
      if (inspection.input)
        return this.#askPerson(taskId, call, {
          args,
          input: inspection.input,
          signal: controller.signal,
        });
      if (inspection.view)
        return this.#showView(taskId, call, {
          args,
          inspection,
          view: inspection.view,
          controller,
          quietRetriesLeft,
          round,
          specialistRunId,
        });
    }

    // Named by the call itself, or from what the code knows; a call that did
    // not say what it is for is named by a model in the background, and never
    // waited for (ADR 0010).
    const facts = factsLabel(inspection.action, inspection.target);
    let presentation: PresentedAction =
      inspection.presentation ??
      (said.purpose ? { ...facts, description: said.purpose } : facts);
    const labelled =
      inspection.presentation || said.purpose
        ? undefined
        : this.#auxiliary.labelAction(taskId, inspection, controller.signal);

    const actionId = this.#records.nextActionId(taskId);
    void labelled
      ?.then(async (label) => {
        if (!label) return;
        presentation = label;
        await this.#records.relabelAction(taskId, actionId, label);
      })
      .catch(() => undefined);
    let backup: FileBackup | undefined;
    if (
      (owner === "built-in" ||
        (owner === "mcp" && inspection.builtInConnection)) &&
      inspection.access === "change" &&
      inspection.scope === "workspace" &&
      inspection.changes?.length
    )
      backup = await this.#deps.rewind.backUp(
        actionId,
        this.#deps.workspace.workspaceRoot(),
        inspection.changes,
        taskId,
      );

    const checkedPermission = await decideToolPermission({
      deps: this.#deps,
      records: this.#records,
      waits: this.#waits,
      taskId,
      owner,
      call,
      args,
      inspection,
      presentation,
      backup,
      signal: controller.signal,
      labelled,
    });
    const { permission, decision, candidate } = checkedPermission;
    let appliedRule: ConversationPermission | undefined =
      checkedPermission.appliedRule;
    if (decision === "cancelled") {
      if (backup) await this.#deps.rewind.discardBackup(actionId);
      return {
        result: { ok: false, reason: "The task was cancelled." },
      };
    }
    if (typeof decision === "object" && decision.kind === "deny") {
      if (backup) await this.#deps.rewind.discardBackup(actionId);
      const userDenied = permission.outcome === "ask";
      const reason = userDenied
        ? decision.reason
          ? `The person declined this action: ${decision.reason}`
          : "The person declined this action."
        : permission.reason;
      const result = userDenied
        ? refusal(
            "person",
            reason,
            "Follow the person's guidance or choose another approach. Do not retry this action unchanged.",
          )
        : refusal(
            "permission",
            reason,
            "Choose an action permitted by the current policy.",
          );
      await this.#records.recordToolAction(taskId, actionId, {
        inspection,
        presentation,
        status: userDenied ? "denied" : "blocked",
        reason,
        approval: {
          by: userDenied ? "you" : "blocked",
          at: this.#deps.now().toISOString(),
          reason,
        },
        ...(specialistRunId ? { specialistRunId } : {}),
        readOnly: changesNothing(owner, inspection),
      });
      await this.#records.showWorking(
        taskId,
        undefined,
        this.#records.visibleSteps(taskId),
      );
      return { result, denied: userDenied };
    }

    // An approved action that no longer matches what the person approved is
    // never run. It is refused in its record and to the model, saying why, and
    // the turn goes on: the model can look again and propose it anew, which the
    // person is asked about afresh (ADR 0005, ADR 0008).
    const notRun = async (reason: string) => {
      if (backup) await this.#deps.rewind.discardBackup(actionId);
      const result = refusal(
        "safety",
        reason,
        "Nothing was changed. Look at the target again and propose the change from what it holds now; the person will be asked again. If it cannot be reached, tell the person why.",
      );
      await this.#records.recordToolAction(taskId, actionId, {
        inspection,
        presentation,
        status: "failed",
        reason,
        call,
        approval: approvalRecord(
          permission,
          decision,
          appliedRule,
          this.#deps.now().toISOString(),
        ),
        ...(specialistRunId ? { specialistRunId } : {}),
        readOnly: changesNothing(owner, inspection),
      });
      await this.#records.showWorking(
        taskId,
        undefined,
        this.#records.visibleSteps(taskId),
      );
      return { result };
    };
    const currentInspection = await this.#inspectTool(
      taskId,
      owner,
      call.name,
      args,
    );
    controller.signal.throwIfAborted();
    if (
      !currentInspection.ok ||
      JSON.stringify(currentInspection) !== JSON.stringify(inspection)
    )
      return notRun(
        `${inspection.target || "Its target"} changed while this action waited for approval, so it was not run.`,
      );
    if (backup?.files.some((file) => file.status === "protected")) {
      const valid = await this.#deps.rewind.checkBackup(actionId);
      if (!valid.ok) return notRun(`${valid.reason} It was not run.`);
    }
    if (decision === "allow-conversation" && candidate) {
      appliedRule = {
        ...candidate,
        id: this.#deps.newApprovalId(),
        at: this.#deps.now().toISOString(),
      };
      await this.#records.grantConversationPermission(taskId, appliedRule);
    }
    const approval = approvalRecord(
      permission,
      decision,
      appliedRule,
      this.#deps.now().toISOString(),
    );
    await this.#records.recordToolAction(taskId, actionId, {
      inspection,
      presentation,
      status: "running",
      call,
      approval,
      ...(specialistRunId ? { specialistRunId } : {}),
      readOnly: changesNothing(owner, inspection),
      ...(backup ? { recovery: { files: backup.files } } : {}),
    });
    await this.#records.showToolProgress(
      taskId,
      call,
      inspection,
      presentation,
      "active",
    );
    let result: ToolInvocationResult;
    try {
      controller.signal.throwIfAborted();
      result = await this.#deps.capabilities.execute(
        taskId,
        owner,
        call.name,
        args,
        { signal: controller.signal, identity: inspection.identity },
      );
    } catch (error) {
      // A tool answers its failures; one that throws is kept for whoever
      // looks into it, and the model is told only that the action failed.
      if (!controller.signal.aborted && isOwnDefect(error))
        this.#deps.recordDefect?.({ taskId, error });
      result = {
        ok: false,
        reason: "The requested action failed while it was running.",
      };
    }
    if (backup) await this.#deps.rewind.completeBackup(actionId);
    if (owner === "mcp" && !result.ok)
      await this.#deps.host.refreshConnections();
    // What the main agent reads in a document, the person sees beside the
    // conversation, and the document it closes goes (ADR 0018). A
    // specialist works in the background and does not take that space: it
    // is not offered close_document at all.
    const beside =
      owner === "built-in" && !specialistRunId && !controller.signal.aborted;
    if (beside && inspection.document)
      result = await shownToPerson(
        this.#deps.host,
        taskId,
        inspection.document,
        result,
      );
    if (beside && inspection.closesDocument)
      result = await closedForPerson(this.#deps.host, taskId, result);
    if (!controller.signal.aborted) {
      await this.#records.finishToolAction(taskId, call, actionId, {
        inspection,
        presentation,
        status: outcomeStatus(result),
        reason: result.ok ? undefined : result.reason,
        result,
        from: owner === "mcp" ? "connector" : "tool",
      });
    }
    return {
      result,
      actionId,
      title: presentation.title,
      ...(inspection.access === "change" && result.ok ? { changed: true } : {}),
    };
  }

  /**
   * What a call would do, as the tool that owns it says. A call the tool
   * refuses as fixable is given once to a small model to re-aim, before the
   * main model is troubled with it. One still refused is answered here: to
   * the model alone while it has tries left, and on the record once it has
   * none.
   */
  async #inspected(
    taskId: string,
    call: AssembledToolCall,
    {
      proposedArguments,
      owner,
      controller,
      quietRetriesLeft,
      round,
      specialistRunId,
    }: {
      readonly proposedArguments: unknown;
      readonly owner: ToolOwner;
      readonly controller: AbortController;
      readonly quietRetriesLeft: number;
      readonly round: RoundEvidence;
      readonly specialistRunId: string | undefined;
    },
  ): Promise<
    | { readonly args: unknown; readonly inspection: AllowedInspection }
    | { readonly settled: ToolCallOutcome }
  > {
    let args = proposedArguments;
    let inspection = withSchemaProblems(
      await this.#inspectTool(taskId, owner, call.name, args),
      args,
      round.tools.find((tool) => tool.name === call.name)?.inputSchema,
    );
    controller.signal.throwIfAborted();

    // Before the main model is troubled with it, a small model is given the
    // refusal and the last few observations and allowed to re-aim the call.
    if (!inspection.ok && inspection.correctable) {
      const repair = await this.#repair.repair(taskId, call, {
        proposed: args,
        owner,
        refusal: inspection,
        round,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (repair) {
        args = repair.arguments;
        // The call is rewritten to what will run, so the model is left
        // holding what actually happened rather than the draft it first wrote.
        call.arguments = JSON.stringify(repair.arguments);
        inspection = repair.inspection;
      }
    }

    if (!inspection.ok) {
      const result = inspection.correctable
        ? correctableByModel(inspection.reason)
        : refusal(
            "tool",
            inspection.reason,
            "Do not send this call again. Choose another way, or tell the person why it cannot be done.",
          );
      // The tool says the model can fix this itself, and the model has tries
      // left: answer it and leave the person out of it entirely.
      if (inspection.correctable && quietRetriesLeft > 0) {
        await this.#audit(taskId, call.name, "quiet-retry", inspection.reason, {
          before: args,
        });
        return { settled: { result, quiet: true } };
      }
      await this.recordFailedProposal(taskId, call, {
        description: "The requested action could not be inspected.",
        reason: result.reason,
        specialistRunId,
        status: "failed",
        answer: result,
      });
      return { settled: { result } };
    }
    return { args, inspection };
  }

  /** A question for the person: asked, and answered with what they said. */
  async #askPerson(
    taskId: string,
    call: AssembledToolCall,
    {
      args,
      input,
      signal,
    }: {
      readonly args: unknown;
      readonly input: NonNullable<AllowedInspection["input"]>;
      readonly signal: AbortSignal;
    },
  ): Promise<ToolCallOutcome> {
    const complete = this.#deps.capabilities.completeUserInput;
    if (!complete)
      return {
        result: {
          ok: false,
          reason:
            "This question tool cannot accept an answer in the current runtime.",
        },
      };
    const outcome = await this.#waits.waitForUserInput(
      taskId,
      input,
      (response) => complete(call.name, args, response),
      signal,
    );
    if (outcome.kind === "cancelled")
      return {
        result: { ok: false, reason: "The task was cancelled." },
      };
    await this.#records.recordUserInteraction(
      taskId,
      call,
      input,
      outcome.response,
      outcome.result,
    );
    return { result: outcome.result };
  }

  /**
   * A view for the conversation: checked by what draws it, re-aimed while it
   * does not draw, and shown only as the source that was checked.
   */
  async #showView(
    taskId: string,
    call: AssembledToolCall,
    given: {
      readonly args: unknown;
      readonly inspection: AllowedInspection;
      readonly view: NonNullable<AllowedInspection["view"]>;
      readonly controller: AbortController;
      readonly quietRetriesLeft: number;
      readonly round: RoundEvidence;
      readonly specialistRunId: string | undefined;
    },
  ): Promise<ToolCallOutcome> {
    const { view, controller, quietRetriesLeft, round, specialistRunId } =
      given;
    const owner = "built-in";
    let { args, inspection } = given;
    let checked = await this.#deps.views.validate(view.kind, view.source);
    controller.signal.throwIfAborted();
    for (
      let attempt = 0;
      !checked.ok && attempt < maximumRepairAttempts;
      attempt += 1
    ) {
      const repair = await this.#repair.repair(taskId, call, {
        proposed: args,
        owner,
        refusal: { ok: false, reason: checked.reason, correctable: true },
        round,
        signal: controller.signal,
      });
      if (
        !repair ||
        repair.inspection.requiresApproval !== false ||
        !repair.inspection.view
      )
        break;
      const repairedView = repair.inspection.view;
      args = repair.arguments;
      call.arguments = JSON.stringify(repair.arguments);
      inspection = repair.inspection;
      checked = await this.#deps.views.validate(
        repairedView.kind,
        repairedView.source,
      );
    }
    if (!checked.ok) {
      await this.#audit(taskId, call.name, "quiet-retry", checked.reason, {
        before: args,
      });
      return {
        result: {
          ok: false,
          reason: `The view was not shown because it could not be validated: ${checked.reason}`,
        },
        quiet: quietRetriesLeft > 0,
      };
    }

    const presentation: PresentedAction = {
      title: inspection.action,
      description:
        inspection.detail ?? "Add a reviewable view to this conversation.",
    };
    const actionId = this.#records.nextActionId(taskId);
    await this.#records.recordToolAction(taskId, actionId, {
      inspection,
      presentation,
      status: "running",
      call,
      approval: {
        by: "no-approval-needed",
        at: this.#deps.now().toISOString(),
        reason: "Inert conversation view.",
      },
      ...(specialistRunId ? { specialistRunId } : {}),
      readOnly: true,
    });
    let result: ToolInvocationResult;
    try {
      result = await this.#deps.capabilities.execute(
        taskId,
        "built-in",
        call.name,
        args,
        { signal: controller.signal },
      );
    } catch {
      result = {
        ok: false,
        reason: "The requested view failed while it was being prepared.",
      };
    }
    if (
      result.ok &&
      (!result.view ||
        JSON.stringify(result.view) !== JSON.stringify(inspection.view))
    )
      result = {
        ok: false,
        reason: "The produced view did not match the validated source.",
      };
    await this.#records.finishToolAction(taskId, call, actionId, {
      inspection,
      presentation,
      status: outcomeStatus(result),
      reason: result.ok ? undefined : result.reason,
      result,
    });
    return { result };
  }

  /**
   * Writing the record must never cost the person their turn, so a failure here
   * is caught — but it is not swallowed: an audit log that has silently stopped
   * recording is worse than none, so the next snapshot says so.
   */
  async #audit(
    taskId: string,
    toolName: string,
    kind: "quiet-retry" | "repair-applied" | "repair-rejected",
    reason: string,
    extra: {
      readonly cause?: RepairRejection;
      readonly before?: unknown;
      readonly after?: unknown;
    } = {},
  ): Promise<void> {
    try {
      await this.#deps.audit.record({
        at: this.#deps.now().toISOString(),
        taskId,
        toolName,
        kind,
        reason: evidenceText(reason, auditedArguments),
        ...(extra.cause ? { cause: extra.cause } : {}),
        ...(extra.before !== undefined
          ? { before: evidenceText(extra.before, auditedArguments) }
          : {}),
        ...(extra.after !== undefined
          ? { after: evidenceText(extra.after, auditedArguments) }
          : {}),
      });
    } catch {
      const notice =
        "Corrections could not be written to the audit log. Work continued; the record is incomplete.";
      this.#deps.host.reportIssue(notice);
    }
  }

  async recordFailedProposal(
    taskId: string,
    call: AssembledToolCall,
    {
      description,
      reason,
      specialistRunId,
      status = "failed",
      answer = { ok: false, reason },
    }: {
      readonly description: string;
      readonly reason: string;
      readonly specialistRunId?: string | undefined;
      readonly status?: "failed" | "blocked";
      /** What the model was answered; the reason alone when nothing more was said. */
      readonly answer?: unknown;
    },
  ): Promise<void> {
    // The call as it was made, so the record can be unfolded to what was asked
    // and what came back. Nothing about the tool is known here, and no target
    // is invented for it. A connector's tool is named without its routing.
    const inspection = {
      ok: true as const,
      action: this.#records.humanizeIdentifier(readableToolName(call.name)),
      target: "",
      command: `${call.name}(${call.arguments.trim() || "{}"})`,
    };
    const presentation = { title: inspection.action, description };
    await this.#records.recordToolAction(
      taskId,
      this.#records.nextActionId(taskId),
      {
        inspection,
        presentation,
        status,
        reason,
        call,
        ...(status === "blocked"
          ? {
              approval: {
                by: "blocked" as const,
                at: this.#deps.now().toISOString(),
                reason,
              },
            }
          : {}),
        ...(specialistRunId ? { specialistRunId } : {}),
        evidence: evidenceText(answer),
      },
    );
  }

  #inspectTool(
    taskId: string,
    owner: ToolOwner,
    name: string,
    args: unknown,
  ): Promise<ToolCallInspection> {
    return this.#deps.capabilities.inspect(taskId, owner, name, args);
  }
}
