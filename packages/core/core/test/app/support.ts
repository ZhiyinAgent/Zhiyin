/**
 * The stubs every test of the app behind the window starts from: the core's
 * workspace and the agent loop, built together the way the app builds them.
 *
 * Every dependency is a stub. That is the point: if either ever needs a real
 * filesystem, subprocess or network connection to be constructed, something
 * concrete has leaked into a dependency that should be an interface.
 */

import type {
  AppEvent,
  DocumentPanelState,
  DocumentPlace,
} from "@zhiyin/contract";
import {
  ComposedCapabilities,
  type CapabilityMembers,
} from "@zhiyin/capabilities";
import type { RewindPlanner } from "@zhiyin/rewind-planner";
import { RunBackups, type Recovery } from "@zhiyin/recovery";
import { ComposedRewind, type RewindJournal } from "@zhiyin/rewind";
import { AgentLoop, type AgentLoopDependencies } from "@zhiyin/agent-loop";
import {
  jobsWith,
  stubDependencies as turnStubs,
} from "@zhiyin/agent-loop/testing";
import type { PluginView } from "@zhiyin/plugins";
import { pluginStore } from "@zhiyin/plugins/testing";
import type { FileSessions } from "@zhiyin/session";
import {
  fakeHistoryRepair,
  fakeHistoryUpdates,
  fakeSessions,
} from "@zhiyin/session/testing";
import { fakeUsage } from "@zhiyin/usage/testing";
import { fakeConversationExport } from "@zhiyin/conversation-export/testing";
import {
  Workspace,
  type DocumentViewerPort,
  type WorkspaceDependencies,
} from "../../src/workspace.js";
import type { ModelEvent, ModelRequest } from "@zhiyin/model-client";
import { fakeModel } from "@zhiyin/model-client/testing";
import { watched } from "@zhiyin/test-support";

export { until } from "@zhiyin/test-support";

/**
 * Each dependency, watched: the app changes nothing but by calling one of
 * them or hearing back from one, its announcements to the window included,
 * so each such moment wakes the waits of the test.
 */
function watchedEach<T extends object>(dependencies: T): T {
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, value]) => [
      name,
      typeof value === "function" ||
      (typeof value === "object" && value !== null && !Array.isArray(value))
        ? watched(value as object)
        : value,
    ]),
  ) as T;
}

/** One request of a model test: a call by its tool's name, or an answer. */
export type ModelStep = readonly [string, Record<string, unknown>] | "answer";

/**
 * A model that makes each call in turn, one a request, then answers. A step
 * that is `"answer"` answers there, ending that turn, before the calls after it.
 * Told a change was never checked, it answers again and the turn ends, without
 * taking a step.
 */
export function calls(...steps: readonly ModelStep[]) {
  let request = 0;
  const answered: readonly ModelEvent[] = [
    { kind: "textDelta", text: "Done" },
    { kind: "done" },
  ];
  return fakeModel((sent): readonly ModelEvent[] => {
    if (toldToVerify(sent)) return answered;
    const step = steps[request];
    request += 1;
    if (!step || step === "answer") return answered;
    return [
      {
        kind: "toolCallDelta",
        index: 0,
        callId: `call-${request}`,
        name: step[0],
        argumentsDelta: JSON.stringify(step[1]),
      },
      { kind: "done" },
    ];
  }).send;
}

/** The request ends on Zhiyin's notice that a change was never checked. */
export function toldToVerify(sent: ModelRequest | undefined): boolean {
  const last = sent?.messages.at(-1);
  return (
    last?.role === "user" &&
    typeof last.content === "string" &&
    last.content.startsWith('<zhiyin-notice kind="verify">')
  );
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
  "capabilities" | "commands" | "rewind" | "backups" | "runs" | "host"
> &
  Omit<
    WorkspaceDependencies,
    | "capabilityOverview"
    | "pluginManagement"
    | "connectionManagement"
    | "capabilityLifecycle"
    | "commands"
    | "rewind"
  > &
  CapabilityMembers & {
    readonly rewind: RewindPlanner;
    readonly recovery: Recovery;
    /** Where interrupted rewinds are kept; in memory unless a test says. */
    readonly journal?: RewindJournal;
    /** How runs are readied, as the app gives them holds; none unless a test says. */
    readonly runs?: ConstructorParameters<typeof RunBackups>[1];
  };

export function loopFrom({
  tools,
  commands,
  mcp,
  plugins,
  toolchains,
  connectionToolchains,
  rewind,
  recovery,
  journal,
  runs,
  ...dependencies
}: LoopTestDependencies): TestApp {
  const members = watchedEach({
    conversation: rewind,
    recovery,
    ...(journal ? { journal } : {}),
  });
  const capabilities = new ComposedCapabilities(
    watchedEach({
      tools,
      ...(commands ? { commands } : {}),
      mcp,
      plugins,
      toolchains,
      connectionToolchains,
      browsers: dependencies.browsers,
      ...(dependencies.scenes ? { scenes: dependencies.scenes } : {}),
    }),
  );
  const shared = {
    ...watchedEach(dependencies),
    // One group in every role the app takes it in, as the app is composed.
    capabilities,
    capabilityOverview: capabilities,
    pluginManagement: capabilities,
    connectionManagement: capabilities,
    capabilityLifecycle: capabilities,
    commands: capabilities,
    rewind: new ComposedRewind(members),
    backups: members.recovery,
    runs: new RunBackups(members.recovery, runs),
    turnFiles: members.recovery,
  };
  return appFrom(
    new Workspace(shared, (host) => new AgentLoop({ ...shared, host })),
  );
}

/**
 * The app as a test drives it: the workspace, with a turn's own commands
 * beside it, and what the app tells the loop when a job's list changes.
 */
export type TestApp = Workspace &
  Pick<
    AgentLoop,
    | "start"
    | "cancel"
    | "resolveApproval"
    | "resolveUserInput"
    | "commandsChanged"
    | "jobChanged"
    | "askUndoRoom"
    | "shellReach"
  >;

const turnCommands = new Set([
  "start",
  "cancel",
  "resolveApproval",
  "resolveUserInput",
  "commandsChanged",
  "jobChanged",
  "askUndoRoom",
  "shellReach",
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

/**
 * One history on disk in every role the app takes it in, as the app is
 * composed: saving, kept items, repair and updates.
 */
export function storedIn<T extends FileSessions>(
  store: T,
): {
  readonly sessions: T;
  readonly kept: T;
  readonly historyRepair: T;
  readonly historyUpdates: T;
} {
  return {
    sessions: store,
    kept: store,
    historyRepair: store,
    historyUpdates: store,
  };
}

export { jobsWith, pluginStore };

/**
 * The loop's stubs, with what the core adds around them: the history, usage,
 * conversation export, the documents beside each conversation, and a plugin
 * store a test can switch. Each is its owner's fake (ADR 0002), but for the
 * documents, whose port the core declares.
 */

export function stubDependencies(
  emit: (event: AppEvent) => void,
  modelEvents: readonly ModelEvent[] = [{ kind: "done" }],
): LoopTestDependencies {
  let specialistNumber = 0;
  return {
    ...turnStubs(emit, modelEvents),
    sessions: fakeSessions(),
    historyRepair: fakeHistoryRepair(),
    historyUpdates: fakeHistoryUpdates(),
    plugins: pluginStore([]),
    usage: fakeUsage(),
    conversationExport: fakeConversationExport(),
    documents: documentViewerStub(),
    pdfWords: async () => undefined,
    newSpecialistRunId: () => `specialist-${++specialistNumber}`,
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
 * The documents beside each conversation, held in memory: answers as the
 * viewer would, for PDFs and PNGs, without drawing anything. It notes the
 * folder each document was looked for in, and each redraw asked of it.
 */
export function documentViewerStub(): DocumentViewerPort & {
  readonly roots: (string | undefined)[];
  readonly redrawn: string[];
} {
  const states = new Map<string, DocumentPanelState>();
  const listeners: ((taskId: string, state: DocumentPanelState) => void)[] = [];
  const roots: (string | undefined)[] = [];
  const redrawn: string[] = [];
  const closed: DocumentPanelState = { status: "closed", documents: [] };
  const set = (taskId: string, state: DocumentPanelState) => {
    states.set(taskId, state);
    for (const listener of listeners) listener(taskId, state);
  };
  const placeOf = (path: string): DocumentPlace => {
    const cut = path.lastIndexOf("/");
    return {
      path,
      name: path.slice(cut + 1),
      folder: cut < 0 ? "" : path.slice(0, cut),
    };
  };
  const page = { width: 816, height: 1056 };
  let pointings = 0;
  /** Every document here has three pages. */
  const shown = (path: string, pointed?: number): DocumentPanelState => ({
    ...placeOf(path),
    status: "shown",
    documents: [placeOf(path)],
    revision: `revision-of-${path}`,
    kind: "pdf",
    pages: [page, page, page],
    ...(pointed ? { pointed: { page: pointed, count: ++pointings } } : {}),
    openable: true,
  });
  const inside = (path: string) =>
    !path.startsWith("..") && !/^[a-z]:|^[\\/]/i.test(path);
  const isDocument = (path: string) => /\.(pdf|png)$/i.test(path);
  return {
    roots,
    redrawn,
    state: (taskId) => states.get(taskId) ?? closed,
    onChange: (listener) => void listeners.push(listener),
    show: async (taskId, root, path, options = {}) => {
      roots.push(root);
      if (!inside(path))
        return {
          ok: false,
          reason: `${path} is outside the folder this conversation works in, so it is not shown.`,
        };
      if (options.page !== undefined && options.page > 3)
        return {
          ok: false,
          reason: `${placeOf(path).name} has 3 pages, so there is no page ${options.page}.`,
        };
      set(taskId, shown(path, options.page));
      return { ok: true };
    },
    written: async (taskId, root, paths, options = {}) => {
      roots.push(root);
      const documents = paths.filter(isDocument);
      const last = documents.at(-1);
      const now = states.get(taskId) ?? closed;
      if (options.keepShown && now.status !== "closed") {
        const listed = [
          ...[...documents].reverse().map(placeOf),
          ...now.documents,
        ].filter(
          (place, index, all) =>
            all.findIndex((other) => other.path === place.path) === index,
        );
        set(taskId, { ...now, documents: listed });
      } else if (last) set(taskId, shown(last));
      return documents;
    },
    refresh: async (taskId) => void redrawn.push(taskId),
    drawPage: async () => ({
      ok: true,
      data: "data:image/png;base64,",
      width: 816,
      height: 1056,
    }),
    close: (taskId) => set(taskId, closed),
    forget: (taskId) => void states.delete(taskId),
    shutdown: () => {},
    locate: async (_root, path) =>
      inside(path)
        ? { ok: true, path: `C:/work/${path}`, openable: isDocument(path) }
        : {
            ok: false,
            reason: `${path} is outside the folder this conversation works in.`,
          },
  };
}
