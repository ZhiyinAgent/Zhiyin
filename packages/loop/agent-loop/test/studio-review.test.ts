/**
 * Studio work with a spec is reviewed before the turn ends: by its studio's
 * reviewer, which is handed the studio's brief and views and none of the
 * conversation, and whose report the model is told. The work is reviewed
 * again once it changed, at most three times a turn.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { ReviewMaterial, ToolCallInspection } from "@zhiyin/contract";
import type { ModelMessage, ModelRequest } from "@zhiyin/model-client";
import { FileSessions } from "@zhiyin/session";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  loopAndHost,
  pluginOffering,
  pluginsOffering,
  stubDependencies,
} from "./support.js";

type Main = (request: number, sent: ModelRequest) => "build" | "answer";

function studio(options: {
  /** What the main model does at each of its requests. */
  readonly main: Main;
  /** What the reviewer reports at each review. */
  readonly reports?: readonly string[];
  readonly acceptsImages?: boolean;
  readonly reviewsOff?: boolean;
  /** The person attaches a picture with the request. */
  readonly reference?: boolean;
  /** Another model the person chose for reviews, or one that cannot be reached. */
  readonly reviewer?: { readonly acceptsImages: boolean } | "unreachable";
  /** What the studio hands over once the work changed; one scene with a view by default. */
  readonly pieces?: (pictures: boolean) => readonly ReviewMaterial[];
  /**
   * The work changed in an earlier turn, whose review is saved as the given
   * status: "interrupted" when the app closed during it.
   */
  readonly earlier?: "interrupted" | "completed";
}) {
  const base = stubDependencies(() => {});
  const mainRequests: ModelRequest[] = [];
  const reviewerRequests: (readonly ModelMessage[])[] = [];
  /** The reasoning each reviewer request asked for. */
  const reviewerReasoning: ModelRequest["reasoning"][] = [];
  /** Reviewer requests the conversation's model was sent. */
  const onConversationModel: (readonly ModelMessage[])[] = [];
  const reviewerAnswer = (request: ModelRequest) => {
    reviewerRequests.push([...request.messages]);
    reviewerReasoning.push(request.reasoning);
    return {
      kind: "toolCallDelta" as const,
      index: 0,
      callId: `finish-${reviewerRequests.length}`,
      name: "finish_specialist",
      argumentsDelta: JSON.stringify({
        report:
          options.reports?.[reviewerRequests.length - 1] ??
          "The top fails: 1.0 m wide.",
      }),
    };
  };
  const chosen = typeof options.reviewer === "object";
  const asked: { since: Date; pictures: boolean }[] = [];
  // An earlier turn changed the work an hour before this one starts.
  let changedAt: Date | undefined = options.earlier
    ? new Date(Date.UTC(2026, 10, 7, 3, 0, 0))
    : undefined;
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 10, 7, 4, 0, tick++));
  const reviews = {
    reviewer: "studio/reviewer",
    hasChangedSince: async (_conversation: string, since: Date) =>
      changedAt !== undefined && changedAt > since,
    changedSince: async (
      _conversation: string,
      since: Date,
      pictures: boolean,
    ): Promise<readonly ReviewMaterial[]> => {
      asked.push({ since, pictures });
      if (!(changedAt && changedAt > since)) return [];
      if (options.pieces) return options.pieces(pictures);
      return [
        {
          reviewer: "studio/reviewer",
          subject: "the scene table.blend",
          brief: "## Spec\n- legs: 4 (holds)\n- top: 1.2 m wide (fails: 1.0 m)",
          pictures: pictures ? [{ mediaType: "image/png", data: "VIEW" }] : [],
        },
      ];
    },
  };
  const { host } = loopAndHost({
    ...base,
    now,
    leastReasoning: { enabled: true, effort: "low" },
    acceptsImages: options.acceptsImages ?? true,
    kept: {
      ...base.kept,
      claimDrafts: async (_conversation: string, ids: readonly string[]) =>
        ids.map((id) => ({
          kind: "picture" as const,
          id,
          name: `${id}.png`,
          mediaType: "image/png",
          bytes: 3,
          source: `pasted-pictures/${id}`,
        })),
      readPicture: async (source: string) =>
        source === "pasted-pictures/sketch"
          ? { status: "ready" as const, mediaType: "image/png", data: "SKETCH" }
          : { status: "missing" as const, reason: "Gone." },
    },
    reviews: [reviews],
    plugins: pluginsOffering([
      pluginOffering({
        name: "studio",
        specialists: [
          {
            id: "reviewer",
            name: "Scene reviewer",
            description: "Reviews a scene against its spec.",
            instructions: "Judge each requirement.",
            access: "read",
          },
        ],
      }),
    ]),
    tools: {
      list: () => [
        {
          name: "build",
          description: "Change the scene.",
          inputSchema: { type: "object" },
          reportsState: true as const,
        },
      ],
      inspect: async (): Promise<ToolCallInspection> => ({
        ok: true,
        action: "Change the scene",
        target: "table.blend",
        command: "build()",
      }),
      execute: async () => {
        changedAt = now();
        return { ok: true as const, value: "Built." };
      },
    },
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Allowed." }),
    },
    model: {
      ...base.model,
      send: async function* (request: ModelRequest) {
        const text = JSON.stringify(request.messages);
        if (text.includes("You are the Scene reviewer specialist")) {
          if (chosen) onConversationModel.push([...request.messages]);
          else yield reviewerAnswer(request);
        } else {
          mainRequests.push(request);
          const step = options.main(mainRequests.length, request);
          if (step === "build")
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: `build-${mainRequests.length}`,
              name: "build",
              argumentsDelta: "{}",
            };
          else
            yield { kind: "textDelta" as const, text: "The table is built." };
        }
        yield { kind: "done" as const };
      },
    },
  });
  if (options.reviewsOff) host.reviews = false;
  const reviewer = options.reviewer;
  if (reviewer === "unreachable")
    host.reviewer = async () => {
      throw new Error("The reviewer model's provider has no key.");
    };
  else if (reviewer)
    host.reviewer = async () => ({
      client: {
        ...base.model,
        send: async function* (request: ModelRequest) {
          yield reviewerAnswer(request);
          yield { kind: "done" as const };
        },
      },
      acceptsImages: reviewer.acceptsImages,
      leastReasoning: undefined,
      reasoningControls: undefined,
      modelWindow: { model: "reviewer-model" },
    });
  return {
    loop: host.app,
    host,
    mainRequests,
    reviewerRequests,
    reviewerReasoning,
    onConversationModel,
    asked,
  };
}

async function made(options: Parameters<typeof studio>[0]) {
  const made = studio(options);
  const taskId = await made.loop.createTask();
  if (options.earlier) {
    const saved = made.loop.snapshot().tasks[0]!;
    made.loop.restore([
      {
        ...saved,
        specialistRuns: [
          {
            id: "earlier-review",
            specialist: {
              id: "studio/reviewer",
              name: "Scene reviewer",
              description: "Reviews a scene against its spec.",
              instructions: "Judge each requirement.",
              access: "read",
              provenance: { source: "plugin", pluginId: "studio" },
            },
            task: "Review the scene table.blend.",
            depth: 1,
            sequence: 1,
            status: options.earlier,
            startedAt: "2026-11-07T03:00:30.000Z",
            finishedAt: "2026-11-07T03:05:00.000Z",
            actionIds: [],
            ...(options.earlier === "completed"
              ? { handoff: { report: "All hold.\n\nVerdict: holds" } }
              : { reason: "The app closed before this specialist completed." }),
            handoffDelivered: true,
          },
        ],
      },
    ]);
  }
  await made.loop.start(
    taskId,
    "Make a table, 1.2 m wide",
    undefined,
    options.reference ? ["sketch"] : undefined,
  );
  return { ...made, task: made.loop.snapshot().tasks[0]! };
}

const reviewNotices = (request: ModelRequest | undefined) =>
  (request?.messages ?? []).flatMap((message) =>
    typeof message.content === "string" &&
    message.content.startsWith('<zhiyin-notice kind="handoff">Your answer')
      ? [message.content]
      : [],
  );

/** The notices of one kind a request carried. */
const notices = (request: ModelRequest | undefined, kind: string) =>
  (request?.messages ?? []).flatMap((message) =>
    typeof message.content === "string" &&
    message.content.startsWith(`<zhiyin-notice kind="${kind}">`)
      ? [message.content]
      : [],
  );

/** Builds, answers; and after each review, builds again and answers. */
const buildsAfterEachReview: Main = (request) =>
  request % 2 === 1 ? "build" : "answer";

describe("studio work with a spec, as the turn ends", () => {
  it("is reviewed from the studio's brief and views, without the conversation, and the model is told the report", async () => {
    const { reviewerRequests, mainRequests, task } = await made({
      main: (request) => (request === 1 ? "build" : "answer"),
    });

    // Build, answer, then the answer after the review: three requests.
    expect(mainRequests).toHaveLength(3);
    const sent = JSON.stringify(reviewerRequests[0]);
    expect(sent).toContain(
      "Zhiyin hands you this task: Review the scene table.blend.",
    );
    expect(sent).toContain("top: 1.2 m wide (fails: 1.0 m)");
    expect(sent).not.toContain("Make a table");
    expect(sent).not.toContain("The table is built.");
    expect(
      reviewerRequests[0]?.some(
        (message) =>
          typeof message.content !== "string" &&
          message.content.some(
            (part) => part.kind === "image" && part.data === "VIEW",
          ),
      ),
    ).toBe(true);

    const [notice] = reviewNotices(mainRequests[2]);
    expect(notice).toContain(
      'Review 1 of 2: "Scene reviewer" (studio/reviewer), which did not build the scene table.blend',
    );
    expect(notice).toContain("The top fails: 1.0 m wide.");
    expect(task.specialistRuns).toMatchObject([
      {
        specialist: { id: "studio/reviewer" },
        status: "completed",
        handoff: { report: "The top fails: 1.0 m wide." },
        handoffDelivered: true,
      },
    ]);
  });

  it("is reviewed again once it changed after a review that asked for fixes, and at most twice, the last asking the answer to name what still fails", async () => {
    const { reviewerRequests, mainRequests } = await made({
      main: buildsAfterEachReview,
      reports: [
        "The top fails: 1.0 m wide.\n\nVerdict: fix",
        "The top still fails.\n\nVerdict: fix",
      ],
    });

    expect(reviewerRequests).toHaveLength(2);
    // Build and answer three times: the third build is never reviewed.
    expect(mainRequests).toHaveLength(6);
    const last = reviewNotices(mainRequests[4]).at(-1);
    expect(last).toContain("Review 2 of 2");
    expect(last).toContain(
      "This was the last review this turn: fix what you can, then give your full answer now: it is what the person reads as your conclusion, so make it complete on its own, and correct anything said earlier that the review or your fixes changed; name in it each requirement that still fails",
    );
    // A review that asked for fixes, with one to come, holds the answer back.
    expect(reviewNotices(mainRequests[2])[0]).toContain(
      "If you change the work, it is reviewed again when you end your turn: end it then with a line or two, as your full answer comes after that review. If you change nothing, give your full answer now",
    );
  });

  it("tells the model a review is coming once a round changed the work, once a turn, so it holds its full answer for after the report", async () => {
    const { mainRequests } = await made({
      main: (request) => (request <= 2 ? "build" : "answer"),
      reports: ["Every requirement holds.\n\nVerdict: holds"],
    });

    // Two builds, an answer, then the answer after the review.
    expect(mainRequests).toHaveLength(4);
    expect(notices(mainRequests[0], "reviewing")).toEqual([]);
    const told = notices(mainRequests[3], "reviewing");
    expect(told).toHaveLength(1);
    expect(told[0]).toContain(
      "When you end this turn, Zhiyin hands it to a reviewer that did not build it and tells you its report. So end the turn with a line or two only",
    );
    // The answer after a review that found nothing is the full one.
    expect(reviewNotices(mainRequests[3])[0]).toContain(
      "It found nothing that must change, so the work is not reviewed again this turn: give your full answer now: it is what the person reads as your conclusion",
    );
  });

  it("tells the model nothing of a review when the person turned reviews off", async () => {
    const { mainRequests } = await made({
      reviewsOff: true,
      main: (request) => (request === 1 ? "build" : "answer"),
    });

    expect(notices(mainRequests[1], "reviewing")).toEqual([]);
  });

  it("is not reviewed again after a review that found nothing to fix, though the work changed after it", async () => {
    const { reviewerRequests, mainRequests } = await made({
      main: buildsAfterEachReview,
      reports: ["Every requirement holds.\n\nVerdict: holds"],
    });

    expect(reviewerRequests).toHaveLength(1);
    // Build, answer, then build and answer after the review, never reviewed.
    expect(mainRequests).toHaveLength(4);
  });

  it("is reviewed again after a report that gives no verdict, as one asking for fixes", async () => {
    const { reviewerRequests } = await made({
      main: buildsAfterEachReview,
      reports: ["The top fails: 1.0 m wide."],
    });

    expect(reviewerRequests).toHaveLength(2);
  });

  it("asks the reviewer to end its report with its verdict, and to reason no more than the model's least", async () => {
    const { reviewerRequests, reviewerReasoning, mainRequests } = await made({
      main: (request) => (request === 1 ? "build" : "answer"),
    });

    expect(JSON.stringify(reviewerRequests[0])).toContain(
      "End your report with one line: Verdict: holds when nothing must change, or Verdict: fix when something must.",
    );
    expect(reviewerReasoning).toEqual([{ enabled: true, effort: "low" }]);
    expect(mainRequests.map((request) => request.reasoning)).not.toContainEqual(
      { enabled: true, effort: "low" },
    );
  });

  it("is not reviewed again when nothing changed after the review", async () => {
    const { reviewerRequests, mainRequests } = await made({
      main: (request) => (request === 1 ? "build" : "answer"),
    });

    expect(reviewerRequests).toHaveLength(1);
    expect(mainRequests).toHaveLength(3);
  });

  it("is judged from the measures alone on a model that cannot see pictures, which the reviewer is told", async () => {
    const { reviewerRequests, asked } = await made({
      acceptsImages: false,
      main: (request) => (request === 1 ? "build" : "answer"),
    });

    expect(asked[0]?.pictures).toBe(false);
    const sent = JSON.stringify(reviewerRequests[0]);
    expect(sent).toContain(
      "This model cannot see pictures, so you judge from the measures alone.",
    );
    expect(sent).not.toContain("VIEW");
  });

  it("is reviewed in one run for every piece its studio changed, each piece's brief and views in turn, and the model told one report", async () => {
    const { reviewerRequests, mainRequests, task } = await made({
      main: (request) => (request === 1 ? "build" : "answer"),
      pieces: () => [
        {
          reviewer: "studio/reviewer",
          subject: "the scene table.blend",
          brief: "## Spec\n- top: 1.2 m wide (fails: 1.0 m)",
          pictures: [{ mediaType: "image/png", data: "TABLE" }],
        },
        {
          reviewer: "studio/reviewer",
          subject: "the scene chair.blend",
          brief: "## Spec\n- seat: 45 cm high (holds)",
          pictures: [{ mediaType: "image/png", data: "CHAIR" }],
        },
      ],
    });

    expect(reviewerRequests).toHaveLength(1);
    const sent = JSON.stringify(reviewerRequests[0]);
    expect(sent).toContain(
      "Zhiyin hands you this task: Review the scene table.blend and the scene chair.blend.",
    );
    expect(sent).toContain("top: 1.2 m wide (fails: 1.0 m)");
    expect(sent).toContain("seat: 45 cm high (holds)");
    const images = (reviewerRequests[0] ?? []).flatMap((message) =>
      typeof message.content === "string"
        ? []
        : message.content.flatMap((part) =>
            part.kind === "image" ? [part.data] : [],
          ),
    );
    expect(images).toEqual(["TABLE", "CHAIR"]);
    expect(sent).toContain(
      "The views come piece by piece, in the order of the pieces below: 1 of the scene table.blend, then 1 of the scene chair.blend.",
    );
    expect(reviewNotices(mainRequests[2])).toHaveLength(1);
    expect(reviewNotices(mainRequests[2])[0]).toContain(
      "which did not build the scene table.blend and the scene chair.blend",
    );
    expect(task.specialistRuns).toHaveLength(1);
  });

  it("is told that no views come when its studio drew none, though its model sees pictures", async () => {
    const { reviewerRequests } = await made({
      main: (request) => (request === 1 ? "build" : "answer"),
      pieces: () => [
        {
          reviewer: "studio/reviewer",
          subject: "the scene table.blend",
          brief:
            "## Spec\n- top: 1.2 m wide (fails: 1.0 m)\n\nThis scene is no longer the one open, so it is judged from these measures alone; say so in your report.",
          pictures: [],
        },
      ],
    });

    const sent = JSON.stringify(reviewerRequests[0]);
    expect(sent).not.toContain("Fresh views come with this task");
    expect(sent).toContain(
      "No views of the work come with this task: judge it from the measures in the brief.",
    );
  });

  it("is compared with the picture the person attached, shown before the views", async () => {
    const { reviewerRequests } = await made({
      reference: true,
      main: (request) => (request === 1 ? "build" : "answer"),
    });

    const task = reviewerRequests[0]?.find(
      (message) =>
        typeof message.content !== "string" &&
        JSON.stringify(message.content).includes("Zhiyin hands you this task"),
    );
    const parts =
      typeof task?.content === "string" ? [] : (task?.content ?? []);
    expect(
      parts.flatMap((part) => (part.kind === "image" ? [part.data] : [])),
    ).toEqual(["SKETCH", "VIEW"]);
    expect(JSON.stringify(parts)).toContain(
      "The first picture is the one the person attached in the conversation: compare the work with it as the reference.",
    );
  });

  it("is not reviewed when the person turned reviews off", async () => {
    const { reviewerRequests, mainRequests } = await made({
      reviewsOff: true,
      main: (request) => (request === 1 ? "build" : "answer"),
    });

    expect(reviewerRequests).toHaveLength(0);
    expect(mainRequests).toHaveLength(2);
  });

  it("runs on the model the person chose for reviews, never sending the review to the conversation's model", async () => {
    const { reviewerRequests, onConversationModel, mainRequests, task } =
      await made({
        reviewer: { acceptsImages: true },
        main: (request) => (request === 1 ? "build" : "answer"),
      });

    expect(onConversationModel).toHaveLength(0);
    expect(reviewerRequests).toHaveLength(1);
    expect(JSON.stringify(reviewerRequests[0])).toContain("VIEW");
    expect(reviewNotices(mainRequests[2])[0]).toContain(
      "The top fails: 1.0 m wide.",
    );
    expect(task.specialistRuns).toMatchObject([{ status: "completed" }]);
  });

  it("is judged from the measures alone when the model chosen for reviews cannot see pictures, though the conversation's can, and names the setting", async () => {
    const { reviewerRequests, asked } = await made({
      acceptsImages: true,
      reviewer: { acceptsImages: false },
      main: (request) => (request === 1 ? "build" : "answer"),
    });

    expect(asked[0]?.pictures).toBe(false);
    const sent = JSON.stringify(reviewerRequests[0]);
    expect(sent).not.toContain("VIEW");
    expect(sent).toContain(
      "a reviewer model that sees pictures can be chosen in Settings",
    );
  });

  it("is not reviewed when the model chosen for reviews cannot be reached, and the person is told why", async () => {
    const { reviewerRequests, onConversationModel, mainRequests, host } =
      await made({
        reviewer: "unreachable",
        main: (request) => (request === 1 ? "build" : "answer"),
      });

    expect(reviewerRequests).toHaveLength(0);
    expect(onConversationModel).toHaveLength(0);
    expect(host.issues).toEqual([
      "Studio work was not reviewed: The reviewer model's provider has no key.",
    ]);
    // Told a review was coming, the model held its answer: it is asked for
    // it once, saying why no review came.
    expect(mainRequests).toHaveLength(3);
    expect(notices(mainRequests[2], "reviewing").at(-1)).toContain(
      "The work was not reviewed: The reviewer model's provider has no key. Say so in your answer.",
    );
  });

  it("tells the person nothing of an unreachable reviewer model in a turn that changed nothing", async () => {
    const { host, mainRequests } = await made({
      reviewer: "unreachable",
      main: () => "answer",
    });

    expect(mainRequests).toHaveLength(1);
    expect(host.issues).toEqual([]);
  });

  it("is reviewed as the next turn ends when the app closed during its review, though that turn changed nothing", async () => {
    const { reviewerRequests, mainRequests } = await made({
      earlier: "interrupted",
      main: () => "answer",
    });

    expect(reviewerRequests).toHaveLength(1);
    expect(JSON.stringify(reviewerRequests[0])).toContain(
      "Review the scene table.blend.",
    );
    expect(reviewNotices(mainRequests[1])).toHaveLength(1);
  });

  it("is not reviewed again in a later turn that changed nothing once its review completed", async () => {
    const { reviewerRequests, mainRequests } = await made({
      earlier: "completed",
      main: () => "answer",
    });

    expect(reviewerRequests).toHaveLength(0);
    expect(mainRequests).toHaveLength(1);
  });

  it("asks for no review in a turn that changed nothing", async () => {
    const { reviewerRequests, mainRequests } = await made({
      main: () => "answer",
    });

    expect(reviewerRequests).toHaveLength(0);
    expect(mainRequests).toHaveLength(1);
  });
});

describe("the pictures a review comes with", () => {
  const folders = new TemporaryFolders();
  afterEach(() => folders.removeAll());

  it("name the person's reference by an address the reviewer can compare it by, and Zhiyin's views by none", async () => {
    // The conversation's kept items as the application keeps them, and a
    // comparing tool that reads a picture's address as the app's
    // compare_pictures does: through the conversation's attached pictures.
    const sessions = new FileSessions(await folders.make("zhiyin-review-"));
    await sessions.claim();
    const sketch = await sessions.keepPicture({
      name: "sketch.png",
      mediaType: "image/png",
      data: "SKETCH",
    });
    if (sketch.status !== "kept") throw new Error(sketch.reason);
    const base = stubDependencies(() => {});
    let changed = false;
    const compared: string[] = [];
    const told: string[] = [];
    let reviewerRound = 0;
    const { host } = loopAndHost({
      ...base,
      acceptsImages: true,
      kept: sessions,
      reviews: [
        {
          reviewer: "studio/reviewer",
          hasChangedSince: async () => changed,
          changedSince: async () =>
            changed
              ? [
                  {
                    reviewer: "studio/reviewer",
                    subject: "the scene table.blend",
                    brief: "## Spec\n- top: 1.2 m wide (holds)",
                    pictures: [{ mediaType: "image/png", data: "VIEW" }],
                  },
                ]
              : [],
        },
      ],
      plugins: pluginsOffering([
        pluginOffering({
          name: "studio",
          specialists: [
            {
              id: "reviewer",
              name: "Scene reviewer",
              description: "Reviews a scene against its spec.",
              instructions: "Compare the work with the reference.",
              access: "read",
            },
          ],
        }),
      ]),
      tools: {
        list: () => [
          {
            name: "build",
            description: "Change the scene.",
            inputSchema: { type: "object" },
            reportsState: true as const,
          },
          {
            name: "compare_pictures",
            description: "Compare two pictures.",
            inputSchema: { type: "object" },
            access: "read" as const,
          },
        ],
        inspect: async (name): Promise<ToolCallInspection> => ({
          ok: true,
          action: name,
          target: "table.blend",
          command: name,
        }),
        execute: async (name, args, _signal, conversationId) => {
          if (name === "build") {
            changed = true;
            return { ok: true as const, value: "Built." };
          }
          const { first, second } = args as Record<string, string>;
          const read = await Promise.all(
            [first, second].map((address) =>
              sessions.readAttachedPicture(
                conversationId ?? "",
                (address ?? "").replace("attachment://", ""),
              ),
            ),
          );
          for (const picture of read)
            if (picture.status !== "ready")
              return { ok: false as const, reason: picture.reason };
          compared.push(
            read
              .map((picture) =>
                picture.status === "ready" ? picture.data : "",
              )
              .join(" with "),
          );
          return { ok: true as const, value: "Alike." };
        },
      },
      permissions: {
        decide: async () => ({ outcome: "allow" as const, reason: "Allowed." }),
      },
      model: {
        ...base.model,
        send: async function* (request: ModelRequest) {
          const text = JSON.stringify(request.messages);
          if (text.includes("You are the Scene reviewer specialist")) {
            reviewerRound += 1;
            if (reviewerRound === 1) told.push(text);
            const addresses = text.match(/attachment:\/\/[A-Za-z0-9._-]+/g);
            yield reviewerRound === 1
              ? {
                  kind: "toolCallDelta" as const,
                  index: 0,
                  callId: "compare-1",
                  name: "compare_pictures",
                  argumentsDelta: JSON.stringify({
                    first: addresses?.[0] ?? "attachment://reference",
                    second: addresses?.[0] ?? "attachment://reference",
                  }),
                }
              : {
                  kind: "toolCallDelta" as const,
                  index: 0,
                  callId: "finish-1",
                  name: "finish_specialist",
                  argumentsDelta: JSON.stringify({
                    report: "Alike.\n\nVerdict: holds",
                  }),
                };
          } else if (!changed)
            yield {
              kind: "toolCallDelta" as const,
              index: 0,
              callId: "build-1",
              name: "build",
              argumentsDelta: "{}",
            };
          else yield { kind: "textDelta" as const, text: "Built." };
          yield { kind: "done" as const };
        },
      },
    });
    const taskId = await host.app.createTask();

    await host.app.start(taskId, "Make a table like this", undefined, [
      sketch.id,
    ]);

    expect(compared).toEqual(["SKETCH with SKETCH"]);
    expect(told.join("")).toContain(
      `name the person's by its address (picture 1: attachment://${sketch.id}); the others have none, so compare a render saved in the workspace by its path instead.`,
    );
    await sessions.release();
  });
});
