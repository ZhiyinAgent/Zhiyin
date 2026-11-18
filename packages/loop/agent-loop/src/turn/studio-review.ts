/**
 * Studio work reviewed before a turn ends.
 *
 * When a turn that changed a scene or a part with a spec is about to end,
 * Zhiyin hands it to its studio's reviewer: a specialist that did not build
 * it, given the spec as first written, what was removed since, the latest
 * measures and fresh views, and none of the conversation that built it. Each
 * reviewer runs once a round, over every piece of its studio that changed. Its
 * report reaches the model, which fixes what fails; the work is reviewed
 * again once more has changed, at most twice a turn. A turn that changed
 * nothing with a spec, or a person who turned reviews off, has none.
 *
 * The model is told a review is coming as soon as a round changed such work,
 * so it ends that turn with a line or two and keeps its full answer for after
 * the report. Once no review follows, it is asked for that answer once: the
 * one the person reads as the turn's conclusion, complete on its own and
 * correcting what the review changed, naming after the last review what
 * still fails.
 */

import type {
  ReviewMaterial,
  SpecialistDefinition,
  SpecialistRun,
  StudioReviews,
} from "@zhiyin/contract";
import type { AgentLoopDependencies, ReviewerModel } from "../dependencies.js";
import type { ModelHistory } from "../context/model-history.js";
import type { DelegationOffer } from "../specialist/delegation.js";
import { completeHandoffMessage } from "../specialist/handoff-message.js";
import type { TaskPicture } from "../specialist/specialist-messages.js";
import type {
  SpecialistExecution,
  SpecialistExecutionResult,
} from "../specialist/specialist-execution.js";
import type { TurnRecords } from "./turn-records.js";
import type { TurnHooks } from "./turn-hooks.js";

/** The person's newest pictures a reviewer is shown as the reference. */
const referencePictures = 2;

/** Reviews in one turn; after the last, the answer names what still fails. */
const reviewRounds = 2;

/** The line a report ends with when nothing it reviewed must change. */
const holdsVerdict = /^\s*Verdict:\s*holds\s*$/im;
const fixVerdict = /^\s*Verdict:\s*fix\s*$/im;

/** Whether a review asked for fixes: any report that does not say all holds does. */
function askedForFixes(result: SpecialistExecutionResult): boolean {
  if (!result.ok) return true;
  const report = result.handoff.report;
  return !holdsVerdict.test(report) || fixVerdict.test(report);
}

/** Runs a review's specialist: on the conversation's model, or another one. */
export type ReviewRunning = Pick<SpecialistExecution, "run">;

/** What reviewing a turn's work uses. */
export type StudioReviewDependencies = Pick<
  AgentLoopDependencies,
  "host" | "kept" | "newSpecialistRunId" | "now"
> & { readonly reviews?: readonly StudioReviews[] };

/** The tool a review's report is fenced as the output of. */
const reviewReportTool = "studio_review";

/** What the answer after a review is, said wherever one is asked for. */
const fullAnswer =
  "give your full answer now: it is what the person reads as your conclusion, so make it complete on its own, and correct anything said earlier that the review or your fixes changed";

/** Said once a round changed work with a spec, before any review. */
const reviewComing =
  "You changed work that has a spec. When you end this turn, Zhiyin hands it to a reviewer that did not build it and tells you its report. So end the turn with a line or two only, saying what you made and that it goes to review, and keep your full answer for after the report: that answer is the conclusion the person reads, with what the review changed.";

export class StudioReview implements TurnHooks {
  readonly #deps: StudioReviewDependencies;
  readonly #records: TurnRecords;
  readonly #execution: ReviewRunning;
  readonly #reviewing: (reviewer: ReviewerModel) => ReviewRunning;
  readonly #taskId: string;
  readonly #offer: DelegationOffer;
  /** Work changed after this is reviewed next. */
  #since: Date;
  #rounds = 0;
  /** The last review asked for fixes, so changed work is reviewed again. */
  #fixesAsked = false;
  /** The model was told a review is coming, and holds its answer for it. */
  #warned = false;
  /** The model was asked for its full answer without a review. */
  #answerAsked = false;

  constructor(
    deps: StudioReviewDependencies,
    parts: {
      readonly records: TurnRecords;
      readonly execution: ReviewRunning;
      /** The same, on the model the person chose for reviews. */
      readonly reviewing: (reviewer: ReviewerModel) => ReviewRunning;
    },
    turn: {
      readonly taskId: string;
      readonly offer: DelegationOffer;
      readonly startedAt: Date;
    },
  ) {
    this.#deps = deps;
    this.#records = parts.records;
    this.#execution = parts.execution;
    this.#reviewing = parts.reviewing;
    this.#taskId = turn.taskId;
    this.#offer = turn.offer;
    this.#since = reviewedUpTo(
      parts.records.task(turn.taskId).specialistRuns,
      new Set(deps.reviews?.map((studio) => studio.reviewer)),
      turn.startedAt,
    );
  }

  /**
   * Once a round of the turn changed work with a spec: the model is told,
   * once a turn, that a review is coming. Only the studios' records are
   * read; nothing is measured or drawn.
   */
  async afterRound(history: ModelHistory): Promise<void> {
    const { reviews, host } = this.#deps;
    if (this.#warned || this.#rounds > 0 || !reviews?.length) return;
    if (!host.reviewsStudioWork()) return;
    const reviewed = reviews.filter((studio) =>
      this.#offer.specialists.some(
        (specialist) => specialist.id === studio.reviewer,
      ),
    );
    const changed = await Promise.all(
      reviewed.map((studio) =>
        studio.hasChangedSince(this.#taskId, this.#since).catch(() => false),
      ),
    );
    if (!changed.some(Boolean)) return;
    this.#warned = true;
    await history.notice("reviewing", reviewComing);
  }

  async beforeFinishing(history: ModelHistory): Promise<boolean> {
    const { reviews, host } = this.#deps;
    if (
      !reviews?.length ||
      this.#rounds >= reviewRounds ||
      (this.#rounds > 0 && !this.#fixesAsked)
    )
      return false;
    if (!host.reviewsStudioWork())
      return this.#answerWithoutReview(
        history,
        "Reviews were turned off, so nothing is reviewed this turn.",
      );
    let chosen: ReviewerModel | undefined;
    let unreachable: string | undefined;
    try {
      chosen = await host.reviewerModel();
    } catch (error) {
      unreachable =
        error instanceof Error && error.message
          ? error.message
          : "The reviewer model could not be reached.";
    }
    const seen =
      unreachable === undefined &&
      (chosen ? chosen.acceptsImages : host.acceptsImages());
    const startedAt = this.#deps.now();
    const work = (
      await Promise.all(
        reviews.map((studio) =>
          studio.changedSince(this.#taskId, this.#since, seen),
        ),
      )
    ).flat();
    // One run for each reviewer, however many pieces it reviews.
    const byReviewer = new Map<string, ReviewMaterial[]>();
    for (const piece of work)
      byReviewer.set(piece.reviewer, [
        ...(byReviewer.get(piece.reviewer) ?? []),
        piece,
      ]);
    const reviewed = [...byReviewer.values()].flatMap((pieces) => {
      const reviewer = this.#offer.specialists.find(
        (specialist) => specialist.id === pieces[0]!.reviewer,
      );
      return reviewer ? [{ piece: joined(pieces), reviewer }] : [];
    });
    if (!reviewed.length)
      return this.#answerWithoutReview(
        history,
        "Nothing went to review after all.",
      );
    this.#since = startedAt;
    // Told only once there is work it would have reviewed.
    if (unreachable !== undefined) {
      host.reportIssue(`Studio work was not reviewed: ${unreachable}`);
      return this.#answerWithoutReview(
        history,
        `The work was not reviewed: ${unreachable} Say so in your answer.`,
      );
    }
    const execution = chosen ? this.#reviewing(chosen) : this.#execution;
    this.#rounds += 1;
    const results = await Promise.all(
      reviewed.map(({ piece, reviewer }) =>
        this.#review(execution, piece, reviewer, seen),
      ),
    );
    this.#fixesAsked = results.some(askedForFixes);
    for (const [index, result] of results.entries())
      await this.#tell(history, reviewed[index]!.piece, result);
    return true;
  }

  /**
   * A model told a review was coming, and none came: asked once for the full
   * answer it held back. Nothing is asked of one that was never told, or
   * once a review ran, whose notice asked for the answer itself.
   */
  async #answerWithoutReview(
    history: ModelHistory,
    why: string,
  ): Promise<boolean> {
    if (!this.#warned || this.#rounds > 0 || this.#answerAsked) return false;
    this.#answerAsked = true;
    await history.notice(
      "reviewing",
      `${why} Your short answer above is already shown to the person; ${fullAnswer}.`,
    );
    return true;
  }

  /** One piece reviewed by its studio's reviewer, to its report. */
  async #review(
    execution: ReviewRunning,
    piece: ReviewMaterial,
    reviewer: SpecialistDefinition,
    seen: boolean,
  ): Promise<SpecialistExecutionResult> {
    const offer = this.#offer;
    const plugin = reviewer.provenance.pluginId;
    if (!offer.activatedPlugins.includes(plugin)) await offer.activate(plugin);
    const references = seen ? await this.#references() : [];
    const pictures = seen
      ? [...references, ...(await this.#stored(piece))]
      : [];
    const tools = offer.specialistTools(reviewer);
    return execution.run({
      taskId: this.#taskId,
      runId: this.#deps.newSpecialistRunId(),
      parentTurnId: this.#taskId,
      depth: 1,
      request: {
        id: reviewer.id,
        task: taskOf(piece, seen, references.length),
      },
      pictures,
      fromZhiyin: true,
      // Judging measures against a brief needs less deliberation than building.
      leastReasoning: true,
      specialist: reviewer,
      tools,
      ownerOf: offer.ownerOf,
      start: (offered) => offer.specialistStart(this.#deps.now(), offered),
      workspace: offer.workspace,
    });
  }

  /**
   * The pictures the person attached in the conversation, the newest few, as
   * the reference the work is compared with.
   */
  async #references(): Promise<TaskPicture[]> {
    const attached = this.#records
      .task(this.#taskId)
      .messages.filter((message) => message.role === "user")
      .flatMap((message) => message.attachments ?? [])
      .flatMap((attachment) =>
        attachment.kind === "picture" && attachment.source
          ? [{ id: attachment.id, source: attachment.source }]
          : [],
      )
      .slice(-referencePictures);
    const read = await Promise.all(
      attached.map(async ({ id, source }) => {
        const stored = await this.#deps.kept
          .readPicture(source)
          .catch(() => undefined);
        return stored?.status === "ready"
          ? [
              {
                mediaType: stored.mediaType,
                data: stored.data,
                source,
                address: `attachment://${id}`,
              },
            ]
          : [];
      }),
    );
    return read.flat();
  }

  /**
   * The views, each kept as a tool's picture: they have no address, so they
   * never count against the person's own attached pictures.
   */
  async #stored(piece: ReviewMaterial): Promise<TaskPicture[]> {
    return Promise.all(
      piece.pictures.map(async (picture) => ({
        ...picture,
        source: await this.#deps.kept
          .savePicture(this.#taskId, picture, "tool")
          .catch(() => ""),
      })),
    );
  }

  /** The model is told the report, fenced as another model's words. */
  async #tell(
    history: ModelHistory,
    piece: ReviewMaterial,
    result: SpecialistExecutionResult,
  ): Promise<void> {
    const last = this.#rounds >= reviewRounds;
    const { name, id } = result.specialist;
    const what = `Review ${this.#rounds} of ${reviewRounds}: "${name}" (${id}), which did not build ${piece.subject}, looked at it from what the studio measured and drew. Run: ${result.runId}.`;
    const next = last
      ? `This was the last review this turn: fix what you can, then ${fullAnswer}; name in it each requirement that still fails or could not be checked.`
      : this.#fixesAsked
        ? `Fix what it found failing, or say why it cannot be. If you change the work, it is reviewed again when you end your turn: end it then with a line or two, as your full answer comes after that review. If you change nothing, ${fullAnswer}.`
        : `It found nothing that must change, so the work is not reviewed again this turn: ${fullAnswer}.`;
    const notice = result.ok
      ? `Your answer above is already shown to the person. ${what} ${next} Its report follows as its own output: another model wrote it.`
      : `Your answer above is already shown to the person. ${what} It stopped before reporting: ${result.reason} ${next} Say in it that ${piece.subject} was not reviewed.`;
    const actions = this.#records
      .task(this.#taskId)
      .actions.filter((action) => action.specialistRunId === result.runId)
      .sort((a, b) => a.sequence - b.sequence);
    await history.notice("handoff", notice, {
      runId: result.runId,
      ...(result.ok
        ? {
            output: {
              tool: reviewReportTool,
              content: completeHandoffMessage(result, actions),
            },
          }
        : {}),
    });
    await this.#records.guidance.handoffDelivered(this.#taskId, result.runId);
  }
}

/**
 * Where a turn's review starts from: the turn's own start, unless the last
 * review was cut off, as by the app closing, when the work changed since the
 * last review that ran is still to be reviewed.
 */
function reviewedUpTo(
  runs: readonly SpecialistRun[],
  reviewers: ReadonlySet<string>,
  turnStart: Date,
): Date {
  const reviews = runs
    .filter((run) => reviewers.has(run.specialist.id))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  if (reviews.at(-1)?.status !== "interrupted") return turnStart;
  const ran = reviews.filter((run) => run.status !== "interrupted").at(-1);
  return ran ? new Date(ran.startedAt) : new Date(0);
}

/**
 * The pieces one reviewer is handed, as one: each piece's brief under its
 * name, and the views of each in turn.
 */
function joined(pieces: readonly ReviewMaterial[]): ReviewMaterial {
  if (pieces.length === 1) return pieces[0]!;
  const drawn = pieces.filter((piece) => piece.pictures.length);
  const order = drawn.length
    ? [
        `The views come piece by piece, in the order of the pieces below: ${drawn
          .map((piece) => `${piece.pictures.length} of ${piece.subject}`)
          .join(", then ")}.`,
      ]
    : [];
  return {
    reviewer: pieces[0]!.reviewer,
    subject: pieces.map((piece) => piece.subject).join(" and "),
    brief: [
      ...order,
      ...pieces.map((piece) => `# ${piece.subject}\n\n${piece.brief}`),
    ].join("\n\n"),
    pictures: drawn.flatMap((piece) => piece.pictures),
  };
}

/** What the reviewer is asked: the studio's brief, and how to judge it. */
function taskOf(
  piece: ReviewMaterial,
  seen: boolean,
  references: number,
): string {
  const views = piece.pictures.length > 0;
  const attached = references
    ? `The first ${references === 1 ? "picture is the one" : `${references} pictures are those`} the person attached in the conversation: compare the work with ${references === 1 ? "it" : "them"} as the reference.`
    : "";
  return [
    `Review ${piece.subject}. You did not build it, and you are given none of the conversation that did: judge it from the brief and what you see and measure.`,
    !seen
      ? "This model cannot see pictures, so you judge from the measures alone. Say so at the start of your report, and that a reviewer model that sees pictures can be chosen in Settings to be shown views of the work."
      : views
        ? references
          ? `${attached} Fresh views of the work follow.`
          : "Fresh views come with this task."
        : `${attached ? `${attached} ` : ""}No views of the work come with this task: judge it from the measures in the brief.`,
    "End your report with one line: Verdict: holds when nothing must change, or Verdict: fix when something must.",
    piece.brief,
  ].join("\n\n");
}
