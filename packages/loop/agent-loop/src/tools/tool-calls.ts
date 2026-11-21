import type {
  ActionApproval,
  ConversationPermission,
  ToolCallInspection,
  ToolInvocationResult,
  ToolOwner,
  ToolSpec,
} from "@zhiyin/contract";
import type { CorrectionEntry } from "@zhiyin/corrections-log";
import { sameValue } from "../canonical.js";
import { toolPlaying } from "./tool-roles.js";
import { evidenceText } from "../context/evidence.js";
import { type CallInput, CallInputs, type InputReading } from "./call-input.js";
import { describeInvocation, readableToolName } from "./invocation.js";
import { correctableByModel, refusal, unknownTool } from "./refusals.js";
import { besideConversation } from "./document-reads.js";
import type { AgentLoopDependencies } from "../dependencies.js";
import type { TurnRecords } from "../turn/turn-records.js";
import { isOwnDefect } from "../turn/turn-recovery.js";
import type { AuxiliaryWork } from "../auxiliary/auxiliary-work.js";
import type { TurnWaits } from "../turn/turn-waits.js";
import {
  maximumQuietRetries,
  type AssembledToolCall,
  type PresentedAction,
  type RoundTools,
} from "../turn/turn-shared.js";
import type { SelfDescription } from "../context/self-description.js";
import { factsLabel } from "../context/task-guidance.js";
import {
  approvalRecord,
  decideToolPermission,
  type ToolPermissionDependencies,
} from "./tool-permission.js";
import { contentDigest, fileStanding } from "./content-digest.js";
import { conversationMarks } from "./conversation-facts.js";
import { changesFiles, changesNothing } from "./declared-effects.js";
import { ActionBackup } from "./action-backup.js";
import {
  confirmedReach,
  keepAccessGrant,
  withGrantCard,
} from "./reach-confirmation.js";
import {
  declined,
  notRun,
  type Decided,
  type RecordedAction,
} from "./unrun-calls.js";
import { humanizeIdentifier } from "../turn/timeline.js";

/** What answering the model's calls uses. */
export type ToolCallsDependencies = Pick<
  AgentLoopDependencies,
  | "corrections"
  | "capabilities"
  | "grants"
  | "host"
  | "newApprovalId"
  | "now"
  | "recordDefect"
  | "backups"
  | "runs"
  | "views"
  | "workspace"
> &
  ToolPermissionDependencies;

/** A call its tool looked at and did not refuse. */
type AllowedInspection = Extract<ToolCallInspection, { readonly ok: true }>;

/**
 * What a tool call produced, and whether the person was ever told about it. A
 * quiet outcome was answered to the model alone: no action record, no
 * permission request, nothing in the transcript.
 */
export type ToolCallOutcome = {
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
  /** The person answered the call themselves: declined it, or replied to it. */
  readonly fromPerson?: boolean;
};

/** Bounded so a refused edit's arguments cannot fill the corrections log. */
const loggedArguments = 2_000;

/**
 * How many of a tool's calls in a row the model has now had refused, this one
 * included: one more than the quiet answers the tool has used since it last
 * ran.
 */
const refusedInRow = (quietRetriesLeft: number): number =>
  maximumQuietRetries - quietRetriesLeft + 1;

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
 * One tool call from proposal to result: inspection, a quiet answer to the
 * model when the refusal allows one, the permission decision, the file
 * backup, execution, and the record of it.
 */
export class ToolCalls {
  readonly #deps: ToolCallsDependencies;
  readonly #records: TurnRecords;
  readonly #auxiliary: AuxiliaryWork;
  readonly #waits: TurnWaits;
  /** Reading what the model streamed as a call's input. */
  readonly #inputs: CallInputs;

  constructor(
    deps: ToolCallsDependencies,
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
    this.#inputs = new CallInputs({
      logCorrection: (taskId, toolName, kind, reason, extra) =>
        this.#logCorrection(taskId, toolName, kind, reason, extra),
      fail: (taskId, call, reason, tools, specialistRunId) =>
        this.recordFailedProposal(taskId, call, {
          description: "The requested action used invalid input.",
          reason,
          specialistRunId,
          tools,
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
      answerTokens,
    }: {
      readonly proposedArguments: unknown;
      /** Absent for a tool nobody offers. */
      readonly owner: ToolOwner | undefined;
      readonly controller: AbortController;
      readonly quietRetriesLeft: number;
      readonly round: RoundTools;
      readonly said?: SelfDescription;
      readonly specialistRunId?: string;
      /**
       * How much of its answer the model can be shown whole, so a tool that
       * reads in pages returns a page that is not cut after it counts as read.
       */
      readonly answerTokens: number;
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
        tools: round.tools,
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
    const { args } = checked;
    const reached = await this.#reached(
      taskId,
      owner,
      call,
      args,
      checked.inspection,
      controller.signal,
    );
    if (!reached)
      return { result: { ok: false, reason: "The task was cancelled." } };
    const inspection = reached;

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
    // waited for (ADR 0014).
    const facts = factsLabel(inspection.action, inspection.target);
    // The approval keeps this heading: a label landing later adds only its
    // description, shown as the model's.
    const asked: PresentedAction =
      inspection.presentation ??
      (said.purpose
        ? { ...facts, description: said.purpose, byModel: true }
        : facts);
    let presentation = asked;
    const labelled =
      inspection.presentation || said.purpose
        ? undefined
        : this.#auxiliary.labelAction(taskId, inspection, controller.signal);

    const actionId = this.#records.nextActionId(taskId);
    void labelled
      ?.then(async (label) => {
        if (!label) return;
        presentation = {
          title: asked.title,
          description: label.description,
          byModel: true,
        };
        await this.#records.describeAction(taskId, actionId, label.description);
      })
      .catch(() => undefined);
    const backups = await ActionBackup.prepare(this.#deps, {
      actionId,
      taskId,
      folder: () => this.#deps.workspace.workspaceRoot(taskId),
      owner,
      inspection,
    });
    const decided = backups.decided(inspection);

    const checkedPermission = await decideToolPermission({
      deps: this.#deps,
      records: this.#records,
      waits: this.#waits,
      taskId,
      owner,
      call,
      args,
      inspection: decided,
      presentation: asked,
      backup: backups.files,
      signal: controller.signal,
      labelled,
    });
    const { permission, decision } = checkedPermission;
    // What every record of this action holds, whatever becomes of it, with
    // its heading as it stands when it is written.
    const recorded = (): RecordedAction => ({
      inspection,
      presentation,
      call,
      ...(specialistRunId ? { specialistRunId } : {}),
      readOnly: changesNothing(owner, inspection),
    });
    if (decision === "cancelled") {
      await backups.discard();
      return {
        result: { ok: false, reason: "The task was cancelled." },
      };
    }
    const unrecorded = { records: this.#records, now: this.#deps.now };
    if (typeof decision === "object" && decision.kind === "deny")
      return declined(unrecorded, taskId, actionId, {
        permission,
        decision,
        backups,
        recorded,
      });

    const why = await this.#whyNotRun(taskId, call, {
      owner,
      args,
      inspection,
      backups,
      signal: controller.signal,
    });
    if (why)
      return notRun(unrecorded, taskId, actionId, why, {
        decided: checkedPermission,
        backups,
        recorded,
      });
    const approval = await this.#approval(taskId, checkedPermission);
    return this.#run(taskId, call, {
      actionId,
      owner,
      args,
      inspection,
      decided,
      approval,
      backups,
      recorded,
      controller,
      answerTokens,
      specialistRunId,
    });
  }

  /**
   * A built-in call as it is decided, once what sealed-off commands reach is
   * settled (ADR 0029): a grant the conversation has outgrown is confirmed
   * first, and a call whose reach that changed is looked at again; a request
   * for a website says what it lets out now. Nothing when the turn was
   * cancelled meanwhile.
   */
  async #reached(
    taskId: string,
    owner: ToolOwner,
    call: AssembledToolCall,
    args: unknown,
    inspection: AllowedInspection,
    signal: AbortSignal,
  ): Promise<AllowedInspection | undefined> {
    if (owner !== "built-in") return inspection;
    const context = {
      deps: this.#deps,
      records: this.#records,
      waits: this.#waits,
    };
    const confirmed = await confirmedReach(context, taskId, inspection, signal);
    if (confirmed === "cancelled") return undefined;
    const current =
      confirmed === "changed"
        ? await this.#inspectTool(taskId, owner, call.name, args)
        : inspection;
    return withGrantCard(context, taskId, current.ok ? current : inspection);
  }

  /**
   * Why an approved call may no longer run, if it may not: it no longer
   * looks as it did when approved, its backup broke, or the folder a
   * sealed-off program runs in could not be kept just before it runs, which
   * it was let run on.
   */
  async #whyNotRun(
    taskId: string,
    call: AssembledToolCall,
    approved: {
      readonly owner: ToolOwner;
      readonly args: unknown;
      readonly inspection: AllowedInspection;
      readonly backups: ActionBackup;
      readonly signal: AbortSignal;
    },
  ): Promise<string | undefined> {
    const { inspection, backups } = approved;
    const looked = await this.#inspectTool(
      taskId,
      approved.owner,
      call.name,
      approved.args,
    );
    // A website's card, as it was shown.
    const current =
      looked.ok && approved.owner === "built-in"
        ? await withGrantCard(
            { deps: this.#deps, records: this.#records, waits: this.#waits },
            taskId,
            looked,
          )
        : looked;
    approved.signal.throwIfAborted();
    if (!current.ok || !sameValue(current, inspection))
      return `${inspection.target || "Its target"} changed while this action waited for approval, so it was not run.`;
    const broken = await backups.broken();
    if (broken) return `${broken} It was not run.`;
    const unstarted = await backups.start(
      inspection.effects?.runs === "sealed",
    );
    return unstarted
      ? `Zhiyin could not back up the folder before the script: ${unstarted} It was not run.`
      : undefined;
  }

  /** The approval an action runs under, keeping the grant the person chose. */
  async #approval(taskId: string, decided: Decided): Promise<ActionApproval> {
    const { decision, candidate, files } = decided;
    const chosen =
      decision === "allow-conversation"
        ? candidate
        : decision === "allow-file"
          ? files?.file
          : decision === "allow-folder"
            ? files?.folder
            : undefined;
    const appliedRule = chosen
      ? await this.#keepGrant(taskId, chosen)
      : decided.appliedRule;
    return approvalRecord(
      decided.permission,
      decision,
      appliedRule,
      this.#deps.now().toISOString(),
    );
  }

  /** Runs an approved action, with its record kept from start to end. */
  async #run(
    taskId: string,
    call: AssembledToolCall,
    {
      actionId,
      owner,
      args,
      inspection,
      decided,
      approval,
      backups,
      recorded,
      controller,
      answerTokens,
      specialistRunId,
    }: {
      readonly actionId: string;
      readonly owner: ToolOwner;
      readonly args: unknown;
      readonly inspection: AllowedInspection;
      /** The inspection as the backup decided it, whose file grants renew. */
      readonly decided: AllowedInspection;
      readonly approval: ActionApproval;
      readonly backups: ActionBackup;
      readonly recorded: () => RecordedAction;
      readonly controller: AbortController;
      readonly answerTokens: number;
      readonly specialistRunId: string | undefined;
    },
  ): Promise<ToolCallOutcome> {
    await this.#records.recordToolAction(taskId, actionId, {
      ...recorded(),
      status: "running",
      approval,
      marks: conversationMarks(owner, inspection),
      ...(backups.files ? { recovery: { files: backups.files.files } } : {}),
      folder: this.#deps.workspace.workspaceRoot(taskId),
    });
    await this.#records.progress.tool(
      taskId,
      call,
      inspection,
      recorded().presentation,
      "active",
    );
    let result = await this.#execute(taskId, owner, call.name, args, {
      controller,
      identity: inspection.identity,
      answerTokens,
    });
    result = await backups.finish(result);
    if (result.ok) await this.#renewFileGrants(taskId, owner, decided);
    // What the person allowed sealed-off commands, for the conversation.
    if (result.ok && owner === "built-in")
      await keepAccessGrant(
        { deps: this.#deps, records: this.#records, waits: this.#waits },
        taskId,
        inspection,
      );
    if (owner === "mcp" && !result.ok)
      await this.#deps.host.refreshConnections();
    // The document beside the conversation (ADR 0019): the main agent's
    // own, never a specialist's, which is not offered close_document at all.
    if (owner === "built-in" && !specialistRunId && !controller.signal.aborted)
      result = await besideConversation(
        this.#deps.host,
        taskId,
        inspection,
        result,
      );
    // Its heading as it stands now: a label may have landed while it ran.
    const { presentation } = recorded();
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
      ...(changesFiles(inspection) && result.ok ? { changed: true } : {}),
    };
  }

  /**
   * The grant the person chose, kept for the conversation. A file given
   * again, after a change elsewhere made it ask, keeps one grant: the one it
   * had, renewed.
   */
  async #keepGrant(
    taskId: string,
    chosen: Omit<ConversationPermission, "id" | "at">,
  ): Promise<ConversationPermission> {
    const earlier = chosen.file
      ? this.#records
          .task(taskId)
          .conversationPermissions.find(
            (rule) => rule.kind === chosen.kind && rule.file === chosen.file,
          )
      : undefined;
    const kept: ConversationPermission = {
      ...chosen,
      id: earlier?.id ?? this.#deps.newApprovalId(),
      at: this.#deps.now().toISOString(),
    };
    if (earlier) await this.#records.grants.update(taskId, kept);
    else await this.#records.grants.grant(taskId, kept);
    return kept;
  }

  /**
   * Runs the approved call through its tool. A tool answers its failures; one
   * that throws is kept for whoever looks into it, and the model is told only
   * that the action failed.
   */
  async #execute(
    taskId: string,
    owner: ToolOwner,
    name: string,
    args: unknown,
    run: {
      readonly controller: AbortController;
      readonly identity: AllowedInspection["identity"];
      readonly answerTokens: number;
    },
  ): Promise<ToolInvocationResult> {
    const { controller } = run;
    try {
      controller.signal.throwIfAborted();
      return await this.#deps.capabilities.execute(taskId, owner, name, args, {
        signal: controller.signal,
        identity: run.identity,
        answerTokens: run.answerTokens,
      });
    } catch (error) {
      if (!controller.signal.aborted && isOwnDefect(error))
        this.#deps.recordDefect?.({ taskId, error });
      return {
        ok: false,
        reason: "The requested action failed while it was running.",
      };
    }
  }

  /**
   * A file allowed for the conversation is allowed as this conversation
   * leaves it, whichever grant let the call run: a change made elsewhere
   * since asks again.
   */
  async #renewFileGrants(
    taskId: string,
    owner: ToolOwner,
    decided: AllowedInspection,
  ): Promise<void> {
    for (const granted of this.#deps.grants.fileGrantsChangedBy(
      this.#records.task(taskId).conversationPermissions,
      owner,
      decided,
    )) {
      const rule = { ...granted };
      delete rule.digest;
      delete rule.standing;
      // A file too large to copy is known again by its size and time of
      // change, which reading it whole at every call would cost.
      const known =
        granted.kind === "uncopied-file"
          ? { standing: await fileStanding(granted.file!) }
          : { digest: await contentDigest(granted.file!) };
      await this.#records.grants.update(taskId, {
        ...rule,
        ...(known.standing ? { standing: known.standing } : {}),
        ...(known.digest ? { digest: known.digest } : {}),
      });
    }
  }

  /**
   * What a call would do, as the tool that owns it says. A call the tool
   * refuses is answered here: one it refuses as fixable to the model alone
   * while the model has tries left, and any other on the record.
   */
  async #inspected(
    taskId: string,
    call: AssembledToolCall,
    {
      proposedArguments: args,
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
      readonly round: RoundTools;
      readonly specialistRunId: string | undefined;
    },
  ): Promise<
    | { readonly args: unknown; readonly inspection: AllowedInspection }
    | { readonly settled: ToolCallOutcome }
  > {
    const inspection = await this.#inspectTool(taskId, owner, call.name, args);
    controller.signal.throwIfAborted();

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
        await this.#logCorrection(
          taskId,
          call.name,
          "quiet-retry",
          inspection.reason,
          {
            before: args,
            inRow: refusedInRow(quietRetriesLeft),
          },
        );
        return { settled: { result, quiet: true } };
      }
      await this.recordFailedProposal(taskId, call, {
        description: "The requested action could not be inspected.",
        reason: result.reason,
        specialistRunId,
        status: "failed",
        answer: result,
        tools: round.tools,
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
    return { result: outcome.result, fromPerson: true };
  }

  /**
   * A view for the conversation: checked by what draws it, and shown only as
   * the source that was checked.
   */
  async #showView(
    taskId: string,
    call: AssembledToolCall,
    {
      args,
      inspection,
      view,
      controller,
      quietRetriesLeft,
      round,
      specialistRunId,
    }: {
      readonly args: unknown;
      readonly inspection: AllowedInspection;
      readonly view: NonNullable<AllowedInspection["view"]>;
      readonly controller: AbortController;
      readonly quietRetriesLeft: number;
      readonly round: RoundTools;
      readonly specialistRunId: string | undefined;
    },
  ): Promise<ToolCallOutcome> {
    // A view saved to a file asks the window for its drawing as one too.
    const checked = view.saveTo
      ? await this.#deps.views.validate(view.kind, view.source, { file: true })
      : await this.#deps.views.validate(view.kind, view.source);
    controller.signal.throwIfAborted();
    if (!checked.ok) {
      const result = {
        ok: false as const,
        reason: `The view was not shown because it could not be validated: ${checked.reason}`,
      };
      // Quiet while the tool's quiet tries last; past them the person sees
      // the failure on the record (ADR 0009).
      if (quietRetriesLeft > 0) {
        await this.#logCorrection(
          taskId,
          call.name,
          "quiet-retry",
          checked.reason,
          {
            before: args,
            inRow: refusedInRow(quietRetriesLeft),
          },
        );
        return { result, quiet: true };
      }
      await this.recordFailedProposal(taskId, call, {
        description: "The requested view could not be validated.",
        reason: result.reason,
        specialistRunId,
        status: "failed",
        answer: result,
        tools: round.tools,
      });
      return { result };
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
    if (result.ok && (!result.view || !sameValue(result.view, inspection.view)))
      result = {
        ok: false,
        reason: "The produced view did not match the validated source.",
      };
    // What the window decided when it drew the view, said with the answer,
    // and a picture of it for a model that takes pictures.
    if (result.ok && checked.drawn)
      result = {
        ...result,
        value: {
          ...(result.value as Record<string, unknown>),
          drawn: checked.drawn.facts,
        },
        ...(checked.drawn.picture ? { images: [checked.drawn.picture] } : {}),
      };
    await this.#records.finishToolAction(taskId, call, actionId, {
      inspection,
      presentation,
      status: outcomeStatus(result),
      reason: result.ok ? undefined : result.reason,
      result,
    });
    const saveTo = inspection.view?.saveTo;
    if (result.ok && saveTo)
      result = {
        ...result,
        value: {
          ...(result.value as Record<string, unknown>),
          saved: await this.#saveDrawing(taskId, call, {
            path: saveTo,
            svg: checked.drawn?.svg,
            title: inspection.view?.title ?? "",
            controller,
            round,
            specialistRunId,
          }),
        },
      };
    return { result };
  }

  /**
   * A shown view's drawing written to the file its call named, as a
   * write_file call of its own: the same permission, approval, backup and
   * rewind as any write, over the exact bytes the window drew (ADR 0003).
   * Says what became of the file.
   */
  async #saveDrawing(
    taskId: string,
    call: AssembledToolCall,
    given: {
      readonly path: string;
      readonly svg: string | undefined;
      readonly title: string;
      readonly controller: AbortController;
      readonly round: RoundTools;
      readonly specialistRunId: string | undefined;
    },
  ): Promise<string> {
    const { path, svg } = given;
    const unsaved = (why: string) =>
      `The drawing was not saved to ${path}: ${why}`;
    if (!svg) return unsaved("the window gave no drawing of it.");
    const fileWriter = toolPlaying(given.round.tools, "writes-file");
    if (!fileWriter)
      return unsaved("no tool that writes files is offered here.");
    const args = { path, content: svg };
    // A refused path goes back to the model in the tool's own words, and
    // leaves nothing on the record.
    const inspected = await this.#inspectTool(
      taskId,
      "built-in",
      fileWriter,
      args,
    );
    if (!inspected.ok) return unsaved(inspected.reason);
    const outcome = await this.runToolCall(
      taskId,
      {
        index: call.index,
        callId: `${call.callId}-save`,
        name: fileWriter,
        arguments: JSON.stringify(args),
      },
      {
        proposedArguments: args,
        owner: "built-in",
        controller: given.controller,
        quietRetriesLeft: 0,
        round: given.round,
        said: { purpose: `Save the drawing “${given.title}” as a file.` },
        ...(given.specialistRunId
          ? { specialistRunId: given.specialistRunId }
          : {}),
        answerTokens: 1_000,
      },
    );
    if (!outcome.result.ok) return unsaved(outcome.result.reason);
    const kilobytes = Math.max(
      1,
      Math.round(new TextEncoder().encode(svg).length / 1024),
    );
    return `Saved the drawing to ${path} (${kilobytes} KB).`;
  }

  /**
   * Writing the record must never cost the person their turn, so a failure here
   * is caught — but it is not swallowed: a corrections log that has silently stopped
   * recording is worse than none, so the next snapshot says so.
   */
  async #logCorrection(
    taskId: string,
    toolName: string,
    kind: CorrectionEntry["kind"],
    reason: string,
    extra: {
      readonly before?: unknown;
      readonly after?: unknown;
      readonly inRow?: number;
    } = {},
  ): Promise<void> {
    try {
      await this.#deps.corrections.record({
        at: this.#deps.now().toISOString(),
        taskId,
        toolName,
        kind,
        reason: evidenceText(reason, loggedArguments),
        ...(extra.before !== undefined
          ? { before: evidenceText(extra.before, loggedArguments) }
          : {}),
        ...(extra.after !== undefined
          ? { after: evidenceText(extra.after, loggedArguments) }
          : {}),
        ...(extra.inRow !== undefined ? { inRow: extra.inRow } : {}),
      });
    } catch {
      const notice =
        "A correction to the agent's work could not be saved to the corrections log. Work continued; the log is incomplete.";
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
      tools = [],
    }: {
      readonly description: string;
      readonly reason: string;
      readonly specialistRunId?: string | undefined;
      readonly status?: "failed" | "blocked";
      /** What the model was answered; the reason alone when nothing more was said. */
      readonly answer?: unknown;
      /** The tools offered, which name a connection's tool by its own name. */
      readonly tools?: readonly ToolSpec[];
    },
  ): Promise<void> {
    // The call as it was made, so the record can be unfolded to what was asked
    // and what came back. Nothing about the tool is known here, and no target
    // is invented for it. A connector's tool is named without its routing.
    const named = readableToolName(call.name, tools);
    const inspection = {
      ok: true as const,
      action: humanizeIdentifier(named),
      target: "",
      command: `${call.name}(${call.arguments.trim() || "{}"})`,
      invocation: describeInvocation(named, call.arguments),
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
