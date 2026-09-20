import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolOwner,
} from "@zhiyin/contract";
import { VisibleError } from "@zhiyin/contract";
import type { RepairRejection } from "@zhiyin/audit";
import type { FileBackup } from "@zhiyin/rewind";
import { evidenceText } from "./evidence.js";
import { ToolCallRepair, maximumRepairAttempts } from "./tool-repair.js";
import type { AgentLoopDependencies } from "./index.js";
import type { TurnRecords } from "./turn-records.js";
import type { AuxiliaryWork } from "./auxiliary-work.js";
import type { TurnWaits } from "./turn-waits.js";
import type { AssembledToolCall, PresentedAction } from "./turn-shared.js";

/**
 * What a tool call produced, and whether the person was ever told about it. A
 * quiet outcome was answered to the model alone: no action record, no
 * permission request, nothing in the transcript.
 */
type ToolCallOutcome = {
  readonly result: ToolInvocationResult;
  readonly quiet?: boolean;
  /**
   * The action this call was written down as, when it was written down at all.
   * Carried so that what happens to a picture after the record is made — being
   * scaled to fit the model — can be added to the same record.
   */
  readonly actionId?: string;
  /**
   * Set when a small model re-aimed the call before it ran. The transcript is
   * rewritten to match, so the model is left holding what actually happened
   * rather than the draft it first wrote.
   */
  readonly repairedArguments?: string;
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
  readonly #turn: {
    interruptIfCurrent(
      taskId: string,
      controller: AbortController,
      reason?: string,
    ): Promise<void>;
  };

  constructor(
    deps: AgentLoopDependencies,
    parts: {
      readonly records: TurnRecords;
      readonly auxiliary: AuxiliaryWork;
      readonly waits: TurnWaits;
    },
    turn: {
      interruptIfCurrent(
        taskId: string,
        controller: AbortController,
        reason?: string,
      ): Promise<void>;
    },
  ) {
    this.#deps = deps;
    this.#records = parts.records;
    this.#auxiliary = parts.auxiliary;
    this.#waits = parts.waits;
    this.#turn = turn;
    this.#repair = new ToolCallRepair({
      deps,
      records: parts.records,
      auxiliary: parts.auxiliary,
      inspect: (taskId, owner, name, args) =>
        this.#inspectTool(taskId, owner, name, args),
      audit: (taskId, toolName, kind, reason, extra) =>
        this.#audit(taskId, toolName, kind, reason, extra),
    });
  }

  async runToolCall(
    taskId: string,
    call: AssembledToolCall,
    proposedArguments: unknown,
    owner: ToolOwner | undefined,
    controller: AbortController,
    quietRetriesLeft: number,
  ): Promise<ToolCallOutcome> {
    if (!owner) {
      const result = {
        ok: false as const,
        reason: `The tool “${call.name}” is not available.`,
      };
      await this.recordFailedProposal(
        taskId,
        call,
        "Zhiyin requested a capability that is not connected.",
        result.reason,
        controller.signal,
      );
      return { result };
    }

    let args = proposedArguments;
    let repairedArguments: string | undefined;
    let inspection = await this.#inspectTool(taskId, owner, call.name, args);
    controller.signal.throwIfAborted();

    // Before the main model is troubled with it, a small model is given the
    // refusal and the last few observations and allowed to re-aim the call.
    if (!inspection.ok && inspection.correctable) {
      const repair = await this.#repair.repair(
        taskId,
        call,
        args,
        owner,
        inspection,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      if (repair) {
        args = repair.arguments;
        repairedArguments = JSON.stringify(repair.arguments);
        inspection = repair.inspection;
      }
    }

    if (!inspection.ok) {
      const result = { ok: false as const, reason: inspection.reason };
      // The tool says the model can fix this itself, and the model has tries
      // left: answer it and leave the person out of it entirely.
      if (inspection.correctable && quietRetriesLeft > 0) {
        await this.#audit(taskId, call.name, "quiet-retry", inspection.reason, {
          before: args,
        });
        return {
          result,
          quiet: true,
          ...(repairedArguments ? { repairedArguments } : {}),
        };
      }
      await this.recordFailedProposal(
        taskId,
        call,
        "The requested action could not be inspected.",
        result.reason,
        controller.signal,
      );
      return { result, ...(repairedArguments ? { repairedArguments } : {}) };
    }

    if (
      owner === "built-in" &&
      inspection.requiresApproval === false &&
      inspection.input
    ) {
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
        inspection.input,
        (response) => complete(call.name, args, response),
        controller.signal,
      );
      if (outcome.kind === "cancelled")
        return {
          result: { ok: false, reason: "The task was cancelled." },
          ...(repairedArguments ? { repairedArguments } : {}),
        };
      await this.#records.recordUserInteraction(
        taskId,
        call,
        inspection.input,
        outcome.response,
        outcome.result,
      );
      this.#records.emitToolActivity(taskId, call, "completed", outcome.result);
      return {
        result: outcome.result,
        ...(repairedArguments ? { repairedArguments } : {}),
      };
    }

    if (
      owner === "built-in" &&
      inspection.requiresApproval === false &&
      inspection.view
    ) {
      let checked = await this.#deps.views.validate(
        inspection.view.kind,
        inspection.view.source,
      );
      controller.signal.throwIfAborted();
      for (
        let attempt = 0;
        !checked.ok && attempt < maximumRepairAttempts;
        attempt += 1
      ) {
        const repair = await this.#repair.repair(
          taskId,
          call,
          args,
          owner,
          { ok: false, reason: checked.reason, correctable: true },
          controller.signal,
        );
        if (
          !repair ||
          repair.inspection.requiresApproval !== false ||
          !repair.inspection.view
        )
          break;
        const repairedView = repair.inspection.view;
        args = repair.arguments;
        repairedArguments = JSON.stringify(repair.arguments);
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
          ...(repairedArguments ? { repairedArguments } : {}),
        };
      }

      const presentation: PresentedAction = {
        title: inspection.action,
        description:
          inspection.detail ?? "Add a reviewable view to this conversation.",
      };
      const actionId = this.#records.nextActionId(taskId);
      await this.#records.recordToolAction(
        taskId,
        actionId,
        inspection,
        presentation,
        "running",
        undefined,
        call,
        "No approval: inert conversation view.",
      );
      let result: ToolInvocationResult;
      try {
        result = await this.#deps.capabilities.execute(
          taskId,
          "built-in",
          call.name,
          args,
          controller.signal,
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
      await this.#records.finishToolAction(
        taskId,
        call,
        actionId,
        inspection,
        presentation,
        outcomeStatus(result),
        result.ok ? undefined : result.reason,
        result,
      );
      this.#records.emitToolActivity(
        taskId,
        call,
        outcomeStatus(result),
        result,
      );
      return { result, ...(repairedArguments ? { repairedArguments } : {}) };
    }

    const presentation = await this.#auxiliary.presentAction(
      taskId,
      inspection,
      controller.signal,
    );
    controller.signal.throwIfAborted();

    const actionId = this.#records.nextActionId(taskId);
    let backup: FileBackup | undefined;
    if (
      owner === "built-in" &&
      inspection.access === "change" &&
      inspection.scope === "workspace" &&
      inspection.changes?.length
    )
      backup = await this.#deps.rewind.backUp(
        actionId,
        this.#deps.workspace.workspaceRoot(),
        inspection.changes,
      );

    const permission = await this.#deps.permissions.decide({
      kind: "tool",
      owner,
      name: call.name,
      arguments: args,
      action: inspection.action,
      target: inspection.target,
      command: inspection.command,
      // Forwarded exactly as the implementation declared them. The loop does
      // not decide what an action does or where it reaches, and does not
      // supply a default for either: an absent declaration must reach the
      // engine absent, so the engine's conservative reading of silence holds.
      ...(inspection.access ? { access: inspection.access } : {}),
      ...(inspection.scope ? { scope: inspection.scope } : {}),
    });
    controller.signal.throwIfAborted();
    let decision: "allow" | "deny" | "cancelled";
    if (permission.outcome === "ask") {
      decision = await this.#waits.waitForApproval(
        taskId,
        inspection,
        presentation,
        backup,
        controller.signal,
        call,
      );
    } else {
      decision = permission.outcome;
    }
    if (decision === "cancelled") {
      if (backup) await this.#deps.rewind.discardBackup(actionId);
      return {
        result: { ok: false, reason: "The task was cancelled." },
        ...(repairedArguments ? { repairedArguments } : {}),
      };
    }
    if (decision === "deny") {
      if (backup) await this.#deps.rewind.discardBackup(actionId);
      const userDenied = permission.outcome === "ask";
      const reason = userDenied
        ? "The action was denied. No further work ran."
        : permission.reason;
      const result = {
        ok: false as const,
        reason,
      };
      this.#records.emitToolActivity(taskId, call, "denied", result);
      await this.#records.recordToolAction(
        taskId,
        actionId,
        inspection,
        presentation,
        userDenied ? "denied" : "blocked",
        reason,
      );
      if (userDenied) {
        controller.abort();
        await this.#turn.interruptIfCurrent(taskId, controller, reason);
        return { result, ...(repairedArguments ? { repairedArguments } : {}) };
      }
      await this.#records.showWorking(
        taskId,
        undefined,
        this.#records.visibleSteps(taskId),
      );
      return { result, ...(repairedArguments ? { repairedArguments } : {}) };
    }

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
    ) {
      if (backup) await this.#deps.rewind.discardBackup(actionId);
      throw new VisibleError(
        "This action changed while awaiting approval. Request it again before continuing.",
      );
    }
    if (backup?.files.some((file) => file.status === "protected")) {
      const valid = await this.#deps.rewind.checkBackup(actionId);
      if (!valid.ok) {
        await this.#deps.rewind.discardBackup(actionId);
        throw new VisibleError(
          `${valid.reason} Request the action again before continuing.`,
        );
      }
    }
    this.#records.emitToolActivity(taskId, call, "approved");
    await this.#records.recordToolAction(
      taskId,
      actionId,
      inspection,
      presentation,
      "running",
      undefined,
      call,
      permission.reason,
    );
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
        controller.signal,
        inspection.identity,
      );
    } catch {
      result = {
        ok: false,
        reason: "The requested action failed while it was running.",
      };
    }
    if (backup) await this.#deps.rewind.completeBackup(actionId);
    if (owner === "mcp" && !result.ok)
      await this.#deps.host.refreshConnections();
    if (!controller.signal.aborted) {
      await this.#records.finishToolAction(
        taskId,
        call,
        actionId,
        inspection,
        presentation,
        outcomeStatus(result),
        result.ok ? undefined : result.reason,
        result,
      );
      await this.#auxiliary.evaluateActionCriterion(
        taskId,
        presentation,
        inspection,
        result,
        controller.signal,
      );
      this.#records.emitToolActivity(
        taskId,
        call,
        outcomeStatus(result),
        result,
      );
    }
    return {
      result,
      actionId,
      ...(repairedArguments ? { repairedArguments } : {}),
    };
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
    description: string,
    reason: string,
    signal: AbortSignal,
  ): Promise<void> {
    const inspection = {
      ok: true as const,
      action: this.#records.humanizeIdentifier(call.name),
      target: "Unavailable",
      command: call.name,
    };
    const presentation = await this.#auxiliary.presentAction(
      taskId,
      inspection,
      signal,
      {
        title: inspection.action,
        description,
      },
    );
    await this.#records.recordToolAction(
      taskId,
      this.#records.nextActionId(taskId),
      inspection,
      presentation,
      "failed",
      reason,
    );
    this.#records.emitToolActivity(taskId, call, "failed", {
      ok: false,
      reason,
    });
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
