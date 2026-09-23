/**
 * The stubs every test of the app behind the window starts from: the core's
 * workspace and the agent loop, built together the way the app builds them.
 *
 * Every dependency is a stub. That is the point: if either ever needs a real
 * filesystem, subprocess or network connection to be constructed, something
 * concrete has leaked into a dependency that should be an interface.
 */

import type { AppEvent } from "@zhiyin/contract";
import {
  ComposedCapabilities,
  type CapabilityMembers,
} from "@zhiyin/capabilities";
import type { RewindPlanner } from "@zhiyin/conversation-rewind";
import type { Recovery } from "@zhiyin/recovery";
import { ComposedRewind } from "@zhiyin/rewind";
import { AgentLoop, type AgentLoopDependencies } from "@zhiyin/agent-loop";
import type { PluginView, Plugins } from "@zhiyin/plugins";
import { Workspace, type WorkspaceDependencies } from "../../src/workspace.js";
import type { ModelEvent } from "@zhiyin/model-client";

export async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition was not reached.");
}

export function currentApprovalId(loop: TestApp, taskId: string): string {
  const phase = loop.snapshot().tasks.find((task) => task.id === taskId)?.phase;
  if (phase?.kind !== "approval") throw new Error("No active approval.");
  return phase.prompt.id;
}

/**
 * What a loop test supplies: the loop's dependencies, with each group's members
 * given separately so a test can replace one of them — the built-in tools, say,
 * or file recovery — and still exercise the real joining between them.
 */
export type LoopTestDependencies = Omit<
  AgentLoopDependencies,
  "capabilities" | "rewind" | "host"
> &
  Omit<WorkspaceDependencies, "capabilities" | "rewind"> &
  CapabilityMembers & {
    readonly rewind: RewindPlanner;
    readonly recovery: Recovery;
  };

export function loopFrom({
  tools,
  mcp,
  plugins,
  toolchains,
  connectionToolchains,
  rewind,
  recovery,
  ...dependencies
}: LoopTestDependencies): TestApp {
  const shared = {
    ...dependencies,
    capabilities: new ComposedCapabilities({
      tools,
      mcp,
      plugins,
      toolchains,
      connectionToolchains,
      browsers: dependencies.browsers,
    }),
    rewind: new ComposedRewind({ conversation: rewind, recovery }),
  };
  return appFrom(
    new Workspace(shared, (host) => new AgentLoop({ ...shared, host })),
  );
}

/** The app as a test drives it: the workspace, with a turn's own commands beside it. */
export type TestApp = Workspace &
  Pick<AgentLoop, "start" | "cancel" | "resolveApproval" | "resolveUserInput">;

const turnCommands = new Set([
  "start",
  "cancel",
  "resolveApproval",
  "resolveUserInput",
]);

/** One object with both halves' commands, each bound to the half that owns it. */
function appFrom(workspace: Workspace): TestApp {
  return new Proxy(workspace, {
    get(target, key) {
      const owner =
        typeof key === "string" && turnCommands.has(key)
          ? target.turns
          : target;
      const value: unknown = Reflect.get(owner, key);
      return typeof value === "function" ? value.bind(owner) : value;
    },
  }) as TestApp;
}

export function stubDependencies(
  emit: (event: AppEvent) => void,
  modelEvents: readonly ModelEvent[] = [{ kind: "done" }],
): LoopTestDependencies {
  let approvalNumber = 0;
  let messageNumber = 0;
  let actionNumber = 0;
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
    permissions: { decide: async () => ({ outcome: "deny", reason: "stub" }) },
    tools: {
      list: () => [],
      inspect: async () => ({ ok: false, reason: "stub" }),
      execute: async () => ({ ok: false, reason: "stub" }),
    },
    mcp: {
      manage: async () => [],
      retryFailed: async () => {},
      builtInIds: () => [],
      setToolEnabled: async () => {},
      test: async () => ({ ok: false, reason: "stub" }),
      saveToken: async () => {},
      clearToken: async () => {},
      availableTools: async () => [],
      inspect: async () => ({ ok: false, reason: "stub" }),
      execute: async () => ({ ok: false, reason: "stub" }),
      shutdownScope: async () => {},
      shutdownAll: async () => {},
    },
    plugins: pluginStore([]),
    toolchains: {
      state: async () => ({ status: "ready", version: "stub" }),
      install: async () => {},
      executable: async () => undefined,
    },
    connectionToolchains: {},
    usage: {
      record: async () => {},
      state: async () => ({
        status: "unavailable",
        reason: "No usage yet.",
      }),
    },
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
                ...(task.titleSource ? { titleSource: task.titleSource } : {}),
                ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
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
      list: async () => [],
      undo: async () => {},
      savePicture: async () => "picture-1",
      readPicture: async () => ({
        status: "missing" as const,
        reason: "This picture is no longer stored with the conversation.",
      }),
      forgetPictures: async () => {},
      inspectDamage: async () => ({ kind: "unreadable" as const }),
      preserveDamaged: async () => "damaged-history/workspace.json",
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
      setApiKey: async () => {},
      clearApiKey: async () => {},
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
      clear: async () => {},
      retentionLimit: () => 5_000,
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
      storage: async () => ({
        usedBytes: 0,
        retainedFiles: 0,
        excludedFiles: 0,
        limits: {
          totalBytes: 256 * 1024 * 1024,
          fileBytes: 10 * 1024 * 1024,
          versionsPerPath: 10,
          maximumAgeDays: 30,
        },
      }),
      clear: async () => {},
      cleanup: async () => {},
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
    newApprovalId: () => `approval-${++approvalNumber}`,
    newUserInputId: () => `input-${++approvalNumber}`,
    now: () => new Date("2026-09-02T19:00:00.000Z"),
    emit,
  };
}

/** A plugin shaped as the app meets it, with everything in it switched on. */
export function pluginView(options: {
  readonly name: string;
  readonly displayName?: string;
  readonly skills?: readonly {
    id: string;
    description: string;
    instructions: string;
  }[];
  readonly enabled?: boolean;
}): PluginView {
  return {
    manifest: {
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: options.name,
      version: "1.0.0",
      description: `The ${options.name} plugin.`,
      author: { name: "Zhiyin" },
      displayName: options.displayName ?? options.name,
      category: "Development",
      defaultPrompts: [],
    },
    provenance: { source: "built-in", sourceId: "shipped" },
    enabled: options.enabled ?? true,
    editing: "override",
    skills: (options.skills ?? []).map((skill) => ({
      ...skill,
      id: `${options.name}/${skill.id}`,
      name: skill.id,
      enabled: true,
    })),
    specialists: [],
    mcpServers: [],
    appConnectors: [],
  };
}

/**
 * A plugin store a test can watch: switches take effect, and a test can make
 * one fail the way a disk does.
 */
export function pluginStore(
  initial: readonly PluginView[],
  options: {
    readonly failSwitch?: (name: string) => boolean;
  } = {},
): Plugins & { readonly enabledPlugins: () => readonly string[] } {
  let views = [...initial];
  const refuse = async (): Promise<never> => {
    throw new Error("This test changes no plugin content.");
  };
  return {
    enabledPlugins: () =>
      views
        .filter((view) => view.enabled)
        .map((view) => view.manifest.name)
        .sort(),
    list: async () => views,
    builtInNames: async () => views.map((view) => view.manifest.name),
    setEnabled: async (name, enabled) => {
      if (options.failSwitch?.(name))
        throw new Error(`${name} could not be saved.`);
      views = views.map((view) =>
        view.manifest.name === name ? { ...view, enabled } : view,
      );
    },
    setComponentEnabled: async (id, enabled) => {
      views = views.map((view) => ({
        ...view,
        skills: view.skills.map((skill) =>
          skill.id === id ? { ...skill, enabled } : skill,
        ),
      }));
    },
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
