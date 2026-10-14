/**
 * Every feature a turn reaches, answering plainly and reaching nothing: what
 * the loop's own tests start from, and what the core's tests build on when
 * they run the loop inside the app. Exported as `@zhiyin/agent-loop/testing`.
 */

import type { AppEvent } from "@zhiyin/contract";
import type { CapabilityMembers } from "@zhiyin/capabilities";
import type { PluginView, Plugins } from "@zhiyin/plugins";
import type { RewindPlanner } from "@zhiyin/conversation-rewind";
import type { Recovery } from "@zhiyin/recovery";
import type { ModelEvent } from "@zhiyin/model-client";
import type { AgentLoopDependencies } from "../src/index.js";

/**
 * The loop's dependencies with each group's members given separately, so a
 * test can replace one of them and still exercise the real joining.
 */
export type TurnStubs = Omit<
  AgentLoopDependencies,
  "capabilities" | "rewind" | "host"
> &
  CapabilityMembers & {
    readonly rewind: RewindPlanner;
    readonly recovery: Recovery;
    readonly emit: (event: AppEvent) => void;
    readonly newTaskId: () => string;
  };

/**
 * Every feature the turn reaches, answering plainly and reaching nothing. There
 * is no 3D studio: a test that needs one adds its own.
 */
export function stubDependencies(
  emit: (event: AppEvent) => void,
  modelEvents: readonly ModelEvent[] = [{ kind: "done" }],
): Omit<TurnStubs, "scenes"> {
  let approvalNumber = 0;
  let messageNumber = 0;
  let actionNumber = 0;
  let keptNumber = 0;
  const browser = {
    refresh: async () => {},
    availability: async () => ({
      available: false as const,
      reason: "No browser in this fixture",
    }),
    state: () => ({
      status: "closed" as const,
      url: "",
      title: "",
      loading: false,
    }),
    lastFrame: () => undefined,
    automation: () => undefined,
    markAgentAction: () => {},
    onAgentAction: () => () => {},
    onState: () => () => {},
    onFrame: () => () => {},
    open: async () => {},
    navigate: async () => {},
    back: async () => {},
    forward: async () => {},
    reload: async () => {},
    click: async () => {},
    typeText: async () => {},
    pressKey: async () => {},
    scroll: async () => {},
    close: async () => {},
  };
  return {
    emit,
    permissions: { decide: async () => ({ outcome: "deny", reason: "stub" }) },
    tools: {
      list: () => [],
      inspect: async () => ({ ok: false, reason: "stub" }),
      execute: async () => ({ ok: false, reason: "stub" }),
    },
    mcp: {
      manage: async () => [],
      states: async () => [],
      check: async () => {
        throw new Error("stub");
      },
      retryFailed: async () => {},
      builtInIds: () => [],
      setToolEnabled: async () => {},
      test: async () => ({ ok: false, reason: "stub" }),
      saveToken: async () => {},
      clearToken: async () => {},
      signIn: async () => ({ status: "failed", reason: "stub" }),
      availableTools: async () => [],
      inspect: async () => ({ ok: false, reason: "stub" }),
      execute: async () => ({ ok: false, reason: "stub" }),
      shutdownScope: async () => {},
      shutdownAll: async () => {},
    },
    plugins: pluginsOffering([]),
    toolchains: {
      state: async () => ({ status: "ready", version: "stub" }),
      install: async () => {},
      executable: async () => undefined,
    },
    connectionToolchains: {},
    sessions: {
      loadWorkspace: async () => undefined,
      // Answered from whatever `loadWorkspace` a test gives, so a test states
      // the saved history once, whole, and the core reads it lazily as it
      // would from disk.
      async loadIndex() {
        const saved = await this.loadWorkspace();
        return (
          saved && {
            ...saved,
            conversations:
              saved.conversations ??
              saved.tasks.map((task) => ({
                id: task.id,
                title: task.title,
                titleSource: task.titleSource,
                updatedAt: task.updatedAt,
                updatedLabel: task.updatedLabel,
              })),
          }
        );
      },
      async openConversation(id: string) {
        const task = (await this.loadWorkspace())?.tasks.find(
          (item) => item.id === id,
        );
        if (!task) throw new Error("No such conversation is saved.");
        return { task, lost: false };
      },
      saveWorkspace: async () => {},
      savePicture: async () => "picture-1",
      readPicture: async () => ({
        status: "missing" as const,
        reason: "This picture is no longer stored with the conversation.",
      }),
      keep: async (
        _kind: string,
        _conversationId: string | undefined,
        source: { text: string } | { file: string },
      ) => ({
        status: "kept" as const,
        id: `kept-${++keptNumber}`,
        bytes: "text" in source ? Buffer.byteLength(source.text) : 0,
      }),
      locate: async () => ({
        status: "missing" as const,
        reason: "This output is no longer stored with the conversation.",
      }),
      keepPicture: async () => ({
        status: "kept" as const,
        id: `kept-${++keptNumber}`,
        bytes: 0,
      }),
      readAttachedPicture: async () => ({
        status: "missing" as const,
        reason: "This picture is no longer stored with the conversation.",
      }),
      updateConversations: async () => ({ updated: [], failed: 0 }),
      recycleOutdatedConversations: async () => ({ recycled: [], failed: 0 }),
      claimDrafts: async () => [],
      forgetConversation: async () => {},
      lastRead: async () => undefined,
      noteRead: async () => {},
      inspectDamage: async () => ({ kind: "unreadable" as const }),
      preserveDamaged: async () => "damaged-history/workspace.json",
      startAfresh: async () => {},
      recoverReadable: async () => ({
        recovered: 0,
        discarded: 0,
        kept: "damaged-history/workspace.json",
      }),
    },
    model: {
      send: async function* () {
        for (const event of modelEvents) yield event;
      },
      settings: async () => ({
        model: "z-ai/glm-5.3-flash",
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        credential: { status: "missing", source: "none" },
      }),
      setApiKey: async () => ({ status: "accepted" }),
      clearApiKey: async () => {},
      models: async () => ({ status: "ready", models: [] }),
      modelProviders: async (model) => ({
        status: "ready",
        model,
        providers: [],
      }),
      selectModel: async () => {},
    },
    workspace: {
      describeWorkspace: async () => ({
        rootName: "workspace",
        entries: [],
        truncated: false,
      }),
      workspaceRoot: () => undefined,
    },
    audit: {
      record: async () => {},
      read: async () => [],
    },
    artifacts: {
      record: (existing) => existing,
      preview: async () => ({
        status: "missing",
        path: "",
        reason: "No workspace in this test.",
      }),
      exportTo: async () => ({ status: "cancelled" }),
      exportView: async () => ({ status: "cancelled" }),
    },
    views: { validate: async () => ({ ok: true }) },
    rewind: {
      plan: () => ({ ok: false, reason: "stub" }),
      apply: () => ({ ok: false, reason: "stub" }),
      planUndo: () => ({ ok: false, reason: "stub" }),
      applyUndo: () => ({ ok: false, reason: "stub" }),
    },
    recovery: {
      prepare: async (actionId, _workspaceRoot, changes) => ({
        actionId,
        files: changes.map((change) => ({
          path: change.path,
          status: "protected" as const,
        })),
      }),
      validate: async () => ({ ok: true }),
      commit: async () => {},
      discard: async () => {},
      review: async (id, workspaceRoot) => ({
        id,
        workspaceRoot,
        files: [],
        targets: [],
      }),
      restore: async () => ({ files: [] }),
      versions: async () => ({
        ok: false,
        reason: "No versions in this test.",
      }),
      cleanup: async () => {},
      forgetConversation: async () => {},
    },
    guidanceModel: {
      send: async function* () {
        yield { kind: "done" };
      },
    },
    browsers: {
      browser: () => browser,
      close: async () => browser.close(),
      forget: async () => browser.close(),
      closeAll: async () => browser.close(),
    },
    newTaskId: () => "task-1",
    newMessageId: () => `message-${++messageNumber}`,
    newActionId: () => `${++actionNumber}`,
    newSpecialistRunId: () => `specialist-${++actionNumber}`,
    newApprovalId: () => `approval-${++approvalNumber}`,
    newUserInputId: () => `input-${++approvalNumber}`,
    now: () => new Date("2026-09-02T19:00:00.000Z"),
  };
}

/** A plugin store that offers exactly these plugins and refuses every change. */
export function pluginsOffering(views: readonly PluginView[]): Plugins {
  const refuse = async (): Promise<never> => {
    throw new Error("The loop's tests change no plugin.");
  };
  return {
    list: async () => views,
    damaged: async () => [],
    builtInNames: async () => views.map((view) => view.manifest.name),
    setEnabled: refuse,
    setComponentEnabled: refuse,
    overrideComponent: refuse,
    resetComponent: refuse,
    install: refuse,
    update: refuse,
    rollback: refuse,
    remove: refuse,
    create: refuse,
    saveContents: refuse,
  };
}
