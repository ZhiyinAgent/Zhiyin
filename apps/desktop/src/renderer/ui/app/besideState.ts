import type {
  BrowserPanelState,
  DocumentPanelState,
  PartsPanelState,
  RunningCommand,
  ScenePanelState,
  ThreeDContent,
  WorkspaceSnapshot,
  WorkspaceView,
} from "@zhiyin/contract";

/**
 * What is beside one conversation, as the core last said: its browser,
 * document, 3D scene and parts, which of them shows beside it, and its
 * commands running as jobs. The core decides all of it (ADR 0019); the window
 * only draws it.
 */
export type Beside = {
  readonly browser: BrowserPanelState;
  readonly document: DocumentPanelState;
  readonly scene: ScenePanelState;
  /** The parts it built last, if it built any. */
  readonly parts?: PartsPanelState;
  /** Which of them shows beside it. */
  readonly view: WorkspaceView;
  /** What its 3D view shows, while the core says. */
  readonly threeD?: ThreeDContent;
  readonly commands: readonly RunningCommand[];
};

/** Each conversation's `Beside`, by its id. */
export type BesideConversations = Readonly<Record<string, Beside>>;

/** What the core says of one conversation's surroundings. */
export type BesideAction =
  | { type: "browserChanged"; taskId: string; browser: BrowserPanelState }
  | { type: "documentChanged"; taskId: string; document: DocumentPanelState }
  | { type: "sceneChanged"; taskId: string; scene: ScenePanelState }
  | { type: "partsChanged"; taskId: string; parts: PartsPanelState | null }
  | {
      type: "workspaceViewChanged";
      taskId: string;
      view: WorkspaceView;
      threeD?: ThreeDContent;
    }
  | {
      type: "commandsChanged";
      taskId: string;
      commands: readonly RunningCommand[];
    };

const closedBrowser: BrowserPanelState = {
  status: "closed",
  url: "",
  title: "",
  loading: false,
};

/** Beside a new conversation, or one the core has said nothing of. */
export const nothingBeside: Beside = {
  browser: closedBrowser,
  document: { status: "closed", documents: [] },
  scene: { status: "closed", view: "overview", working: false },
  view: "conversation",
  commands: [],
};

/** What is beside this conversation; nothing when there is none. */
export function besideOf(
  beside: BesideConversations,
  taskId: string | null | undefined,
): Beside {
  return (taskId && beside[taskId]) || nothingBeside;
}

/** What is beside the selected conversation. */
export function selectedBeside(state: {
  readonly beside: BesideConversations;
  readonly selectedTaskId: string | null;
}): Beside {
  return besideOf(state.beside, state.selectedTaskId);
}

/** The conversation's record with what the core said changed. */
function changed(
  beside: BesideConversations,
  taskId: string,
  change: (current: Beside) => Beside,
): BesideConversations {
  return { ...beside, [taskId]: change(besideOf(beside, taskId)) };
}

/** The record with these optional fields set, or left out when absent. */
function withOptional(
  record: Beside,
  parts: PartsPanelState | null | undefined,
  threeD: ThreeDContent | undefined,
): Beside {
  return {
    browser: record.browser,
    document: record.document,
    scene: record.scene,
    view: record.view,
    commands: record.commands,
    ...(parts ? { parts } : {}),
    ...(threeD ? { threeD } : {}),
  };
}

/** Every conversation's surroundings after one thing the core said. */
export function besideAfter(
  beside: BesideConversations,
  action: BesideAction,
): BesideConversations {
  switch (action.type) {
    case "browserChanged":
      return changed(beside, action.taskId, (current) => ({
        ...current,
        browser: action.browser,
      }));
    case "documentChanged":
      return changed(beside, action.taskId, (current) => ({
        ...current,
        document: action.document,
      }));
    case "sceneChanged":
      return changed(beside, action.taskId, (current) => ({
        ...current,
        scene: action.scene,
      }));
    case "partsChanged":
      return changed(beside, action.taskId, (current) =>
        withOptional(current, action.parts, current.threeD),
      );
    case "workspaceViewChanged":
      return changed(beside, action.taskId, (current) =>
        withOptional(
          { ...current, view: action.view },
          current.parts,
          action.threeD,
        ),
      );
    case "commandsChanged":
      return changed(beside, action.taskId, (current) => ({
        ...current,
        commands: action.commands,
      }));
  }
}

/**
 * Every conversation's surroundings once the snapshot arrived: the selected
 * conversation's are as the snapshot says, keeping its running commands,
 * which the snapshot does not carry.
 */
export function besideHydrated(
  beside: BesideConversations,
  snapshot: WorkspaceSnapshot,
): BesideConversations {
  const taskId = snapshot.selectedTaskId;
  if (!taskId) return beside;
  return changed(beside, taskId, (current) =>
    withOptional(
      {
        ...current,
        browser: snapshot.browser ?? closedBrowser,
        document: snapshot.document ?? nothingBeside.document,
        scene: snapshot.scene ?? nothingBeside.scene,
        view: snapshot.workspaceView ?? "conversation",
      },
      snapshot.parts,
      snapshot.threeD,
    ),
  );
}

/** Every conversation's surroundings with a deleted one's forgotten. */
export function besideWithout(
  beside: BesideConversations,
  taskId: string,
): BesideConversations {
  return Object.fromEntries(
    Object.entries(beside).filter(([item]) => item !== taskId),
  );
}
