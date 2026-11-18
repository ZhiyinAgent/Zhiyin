/**
 * What a test stands in for the 3D studios with: each conversation's Blender
 * scene, opened and changed as the agent's commands would, and the parts its
 * CAD studio built last.
 */

import type {
  PartModel,
  PartsPanelState,
  SceneIntent,
  ScenePanelState,
} from "@zhiyin/contract";

/**
 * Each conversation's 3D scene, which a test opens and changes as the
 * agent's commands would, and the looking the person asked of it.
 */
export function controllableScenes() {
  const made = new Map<string, ReturnType<typeof scene>>();
  const listeners = new Set<
    (taskId: string, made: ReturnType<typeof scene>) => void
  >();
  const forgotten: string[] = [];
  /** What going back asked of the scenes: the conversation, and what stays. */
  const putAway: [string, "file" | "nothing"][] = [];
  function scene() {
    let state: ScenePanelState = {
      status: "closed",
      view: "camera",
      working: false,
    };
    let sequence = 0;
    const states = new Set<(state: ScenePanelState) => void>();
    const publish = (change: Partial<ScenePanelState>) => {
      state = { ...state, ...change };
      states.forEach((listener) => listener(state));
    };
    const picture = () => ({
      preview: {
        data: "",
        width: 640,
        height: 360,
        view: state.view,
        sequence: ++sequence,
      },
    });
    return {
      looked: [] as SceneIntent[],
      state: () => state,
      onState(listener: (state: ScenePanelState) => void) {
        states.add(listener);
        return () => void states.delete(listener);
      },
      look(intent: SceneIntent) {
        this.looked.push(intent);
      },
      /** Blender starting for the agent's first command, with no scene yet. */
      starts() {
        publish({ status: "starting" });
      },
      /** The agent's first command: Blender starts and opens the file. */
      opens(file: string) {
        publish({ status: "starting" });
        publish({ status: "open", file, working: true });
        publish({ working: false, ...picture() });
      },
      /** A later command that changes the scene. */
      changes() {
        publish({ working: true });
        publish({ working: false, ...picture() });
      },
      /** The scene closes, with nothing left to show. */
      stops() {
        state = { status: "closed", view: state.view, working: false };
        states.forEach((listener) => listener(state));
      },
      /** As the studio does on going back: Blender ends, the picture goes. */
      putAway(keep: "file" | "nothing") {
        state = {
          status: "closed",
          view: state.view,
          working: false,
          ...(keep === "file" && state.file ? { file: state.file } : {}),
        };
        states.forEach((listener) => listener(state));
      },
    };
  }
  return {
    forgotten,
    putAway,
    /** The conversation's scene, made as its first 3D command makes it. */
    of(taskId: string) {
      let found = made.get(taskId);
      if (!found) {
        found = scene();
        made.set(taskId, found);
        for (const listener of listeners) listener(taskId, found);
      }
      return found;
    },
    port: {
      existing: (taskId: string) => made.get(taskId),
      onScene(
        listener: (taskId: string, made: ReturnType<typeof scene>) => void,
      ) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      close: async () => {},
      putAway: async (taskId: string, keep: "file" | "nothing") => {
        putAway.push([taskId, keep]);
        made.get(taskId)?.putAway(keep);
      },
      forget: async (taskId: string) => {
        forgotten.push(taskId);
        made.delete(taskId);
      },
      closeAll: async () => {},
    },
  };
}

/** The parts each conversation built last, as the CAD studio keeps them. */
export function controllableParts() {
  const states = new Map<string, PartsPanelState>();
  const listeners = new Set<
    (taskId: string, state: PartsPanelState | undefined) => void
  >();
  const putAway: string[] = [];
  const forgotten: string[] = [];
  let sequence = 0;
  const tell = (taskId: string, state: PartsPanelState | undefined) =>
    listeners.forEach((listener) => listener(taskId, state));
  return {
    putAway,
    forgotten,
    port: {
      state: (taskId: string) => states.get(taskId),
      onChange(
        listener: (taskId: string, state: PartsPanelState | undefined) => void,
      ) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      model: async (
        taskId: string,
        asked: number,
      ): Promise<PartModel | undefined> =>
        states.get(taskId)?.sequence === asked
          ? { sequence: asked, data: new Uint8Array([103, 108, 84, 70]) }
          : undefined,
      putAway: async (taskId: string) => {
        putAway.push(taskId);
        if (states.delete(taskId)) tell(taskId, undefined);
      },
      forget: async (taskId: string) => {
        forgotten.push(taskId);
        states.delete(taskId);
      },
    },
    /** A build in this conversation made these parts. */
    built(taskId: string, ...names: string[]) {
      const state: PartsPanelState = {
        sequence: ++sequence,
        parts: names.map((name) => ({
          name,
          size: [30, 30, 8] as const,
          valid: true,
        })),
      };
      states.set(taskId, state);
      tell(taskId, state);
      return state;
    },
  };
}
