/**
 * Whether studio work is reviewed before a turn ends, and on which model, as
 * the person sets it in Settings: on, on the conversation's model, until they
 * change it, saved with their other choices, and what every turn after it
 * follows.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  CHANNEL,
  type ProviderSettings,
  type ProviderTarget,
  type ToolCallInspection,
} from "@zhiyin/contract";
import type {
  ModelClient,
  ModelEvent,
  ModelRequest,
  ProviderDirectory,
} from "@zhiyin/model-client";
import { FileSessions } from "@zhiyin/session";
import { TemporaryFolders } from "@zhiyin/test-support";
import { Core } from "../../src/index.js";
import {
  calls,
  loopFrom,
  pluginStore,
  pluginView,
  storedIn,
  stubDependencies,
} from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/** An app whose model changes the scene once and answers; `asked` counts the studio's look-ups. */
async function building(root: string) {
  const deps = stubDependencies(() => {});
  const asked = { times: 0 };
  const app = loopFrom({
    ...deps,
    ...storedIn(new FileSessions(root)),
    reviews: [
      {
        reviewer: "studio/reviewer",
        hasChangedSince: async () => false,
        changedSince: async () => {
          asked.times += 1;
          return [];
        },
      },
    ],
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Allowed." }),
    },
    tools: {
      list: () => [
        {
          name: "build",
          description: "Change the scene.",
          inputSchema: { type: "object" },
        },
      ],
      inspect: async (): Promise<ToolCallInspection> => ({
        ok: true,
        action: "Change the scene",
        target: "scene",
        command: "build({})",
      }),
      execute: async () => ({ ok: true, value: "Built." }),
    },
    model: { ...deps.model, send: calls(["build", {}], "answer") },
  });
  await app.initialize();
  return { app, asked };
}

const reviewerPrompt = "You are the Scene reviewer specialist";

/** The reviewer's one request: its report. */
async function* reports(): AsyncGenerator<ModelEvent> {
  yield {
    kind: "toolCallDelta",
    index: 0,
    callId: "finish",
    name: "finish_specialist",
    argumentsDelta: JSON.stringify({ report: "Every requirement holds." }),
  };
  yield { kind: "done" };
}

const pages = {
  keys: "https://lab.test/keys",
  billing: "https://lab.test/billing",
};

/**
 * An app whose model changes a scene with a spec, and whose studio reviewer
 * answers wherever it is sent: `sent` names the model each review went to.
 * Each provider's account holds a key unless `keyless`.
 */
async function reviewed(
  root: string,
  sent: string[],
  options: { readonly keyless?: boolean } = {},
) {
  const deps = stubDependencies(() => {});
  // Each turn builds, answers, and answers again after its review.
  const conversation = calls(
    ["build", {}],
    "answer",
    "answer",
    ["build", {}],
    "answer",
    "answer",
  );
  let changed = 0;
  const directory: ProviderDirectory = {
    list: async () => [],
    for: () => {
      throw new Error("This test sets no provider up.");
    },
    withModel: (target: ProviderTarget, value) =>
      ({
        send: () => {
          sent.push(`${target.provider}:${value.model}`);
          return reports();
        },
        settings: async (): Promise<ProviderSettings> => ({
          provider: { id: target.provider, name: "Review Lab", pages },
          model: value.model,
          providers: [...value.providers],
          endpoint: "https://lab.test/v1",
          credential: options.keyless
            ? { status: "missing", source: "none" }
            : { status: "configured", source: "credentialStore" },
          acceptsImages: false,
        }),
      }) as unknown as ModelClient,
  };
  const app = loopFrom({
    ...deps,
    ...storedIn(new FileSessions(root)),
    modelProviders: directory,
    reviews: [
      {
        reviewer: "studio/reviewer",
        // The scene changed since the last look once it was built again.
        hasChangedSince: async () => changed > 0,
        changedSince: async () =>
          changed-- > 0
            ? [
                {
                  reviewer: "studio/reviewer",
                  subject: "the scene table.blend",
                  brief: "- R1 (count), holds",
                  pictures: [],
                },
              ]
            : [],
      },
    ],
    plugins: pluginStore([
      {
        ...pluginView({ name: "studio" }),
        specialists: [
          {
            id: "studio/reviewer",
            name: "Scene reviewer",
            description: "Reviews a scene against its spec.",
            instructions: "Judge each requirement.",
            access: "read",
            enabled: true,
          },
        ],
      },
    ]),
    permissions: {
      decide: async () => ({ outcome: "allow" as const, reason: "Allowed." }),
    },
    tools: {
      list: () => [
        {
          name: "build",
          description: "Change the scene.",
          inputSchema: { type: "object" },
        },
      ],
      inspect: async (): Promise<ToolCallInspection> => ({
        ok: true,
        action: "Change the scene",
        target: "scene",
        command: "build({})",
      }),
      execute: async () => {
        changed = 1;
        return { ok: true, value: "Built." };
      },
    },
    model: {
      ...deps.model,
      send: (request: ModelRequest) => {
        if (JSON.stringify(request.messages).includes(reviewerPrompt)) {
          sent.push("conversation");
          return reports();
        }
        return conversation(request);
      },
    },
  });
  await app.initialize();
  return app;
}

const reviewLab = {
  provider: "review-lab",
  model: "lab-reviewer",
  providers: [],
};

function coreFor(app: Awaited<ReturnType<typeof building>>["app"]) {
  return new Core({
    workspace: app,
    dataFolder: "C:/data",
    ownership: { claim: async () => {}, release: async () => {} },
    viewChecks: { answer: () => {}, abandon: () => {} },
    commands: {
      shellAvailability: () => ({ available: true }),
      recheckShell: () => ({ available: true }),
      runningCommands: () => [],
      commandOutput: async () => undefined,
      stopCommandForPerson: async () => {},
      onCommandsChanged: () => {},
    },
    chooseFolder: async () => undefined,
    chooseSaveLocation: async () => undefined,
    openExternal: async () => {},
    openPath: async () => {},
    showInFolder: async () => {},
    version: "1.0.0",
  });
}

describe("reviewing studio work", () => {
  it("is on until the person turns it off, which holds across a restart and for every turn after", async () => {
    const root = await folders.make("zhiyin-reviews-");
    const before = await building(root);
    const first = await before.app.createTask();
    await before.app.start(first, "Make a table");
    expect(before.asked.times).toBe(1);
    expect(before.app.snapshot().studioReviews).toBeUndefined();

    await coreFor(before.app).receive(CHANNEL.setStudioReviews, [false]);
    await before.app.shutdown();

    const { app, asked } = await building(root);
    expect(app.snapshot().studioReviews).toBe("off");
    const taskId = await app.createTask();
    await app.start(taskId, "Make a chair");
    expect(asked.times).toBe(0);
  });

  it("runs on the model the person chose for reviews, which holds across a restart, and on the conversation's again once cleared", async () => {
    const root = await folders.make("zhiyin-reviews-");
    const sent: string[] = [];
    const before = await reviewed(root, sent);
    await coreFor(before).receive(CHANNEL.setReviewerModel, [reviewLab]);
    expect(before.snapshot().reviewerModel).toEqual(reviewLab);
    await before.shutdown();

    const app = await reviewed(root, sent);
    expect(app.snapshot().reviewerModel).toEqual(reviewLab);
    await app.start(await app.createTask(), "Make a table");
    expect(sent).toEqual(["review-lab:lab-reviewer"]);

    await coreFor(app).receive(CHANNEL.setReviewerModel, [null]);
    expect(app.snapshot().reviewerModel).toBeUndefined();
    await app.start(await app.createTask(), "Make a chair");
    expect(sent).toEqual(["review-lab:lab-reviewer", "conversation"]);
  });

  it("answers the window with the settings of the model chosen for reviews, and nothing while none is", async () => {
    const app = await reviewed(await folders.make("zhiyin-reviews-"), []);
    const core = coreFor(app);

    expect(await core.receive(CHANNEL.reviewerModelSettings, [])).toBeNull();
    await core.receive(CHANNEL.setReviewerModel, [reviewLab]);
    expect(await core.receive(CHANNEL.reviewerModelSettings, [])).toMatchObject(
      {
        provider: { id: "review-lab", name: "Review Lab" },
        model: "lab-reviewer",
      },
    );
  });

  it("is not reviewed when the model chosen for reviews has no key, and the person is told so", async () => {
    const sent: string[] = [];
    const app = await reviewed(await folders.make("zhiyin-reviews-"), sent, {
      keyless: true,
    });
    await coreFor(app).receive(CHANNEL.setReviewerModel, [reviewLab]);

    await app.start(await app.createTask(), "Make a table");

    expect(sent).toEqual([]);
    expect(app.snapshot().issues).toContainEqual(
      expect.objectContaining({
        message:
          "Studio work was not reviewed: Review Lab has no key for the model chosen for reviews. Add one on the Model page, or review on the conversation's model.",
      }),
    );
  });

  it("takes as the model for reviews only a provider, a model and its upstreams, or nothing", async () => {
    const app = await reviewed(await folders.make("zhiyin-reviews-"), []);
    const core = coreFor(app);

    for (const refused of [
      [],
      [{ provider: "review-lab" }],
      [{ ...reviewLab, model: "" }],
      [{ ...reviewLab, providers: "any" }],
      [{ ...reviewLab, extra: true }],
      [reviewLab, reviewLab],
    ])
      await expect(
        core.receive(CHANNEL.setReviewerModel, refused),
      ).rejects.toThrow();
    await core.receive(CHANNEL.setReviewerModel, [
      { ...reviewLab, region: "mainland" },
    ]);
    expect(app.snapshot().reviewerModel).toEqual({
      ...reviewLab,
      region: "mainland",
    });
  });

  it("is set from the window with a yes or no, and nothing else", async () => {
    const { app } = await building(await folders.make("zhiyin-reviews-"));
    const core = coreFor(app);

    for (const refused of [[], ["off"], [0], [true, true]])
      await expect(
        core.receive(CHANNEL.setStudioReviews, refused),
      ).rejects.toThrow();
    await core.receive(CHANNEL.setStudioReviews, [false]);
    expect(app.snapshot().studioReviews).toBe("off");
    await core.receive(CHANNEL.setStudioReviews, [true]);
    expect(app.snapshot().studioReviews).toBeUndefined();
  });
});
