import type { AppEvent } from "@zhiyin/contract";
import type { WorkspaceAction } from "./workspaceState.js";

/**
 * What an event from the core does to the window's state. The events that
 * carry the workspace or a conversation do nothing here: the window's copy of
 * the workspace takes those. Every kind is named, so a new one stops the build
 * until it is given its place.
 */
export function actionFor(event: AppEvent): WorkspaceAction | undefined {
  switch (event.kind) {
    case "coreReady":
      return { type: "connected" };
    case "taskRemoved":
      return { type: "taskRemoved", ...event.data };
    case "taskSelectionChanged":
      return { type: "selectionReceived", taskId: event.data.taskId };
    case "mcpServersChanged":
      return { type: "mcpServersReceived", servers: event.data };
    case "pluginsChanged":
      return { type: "pluginsReceived", plugins: event.data };
    case "browserChanged":
      return {
        type: "browserChanged",
        taskId: event.data.taskId,
        browser: event.data.browser,
      };
    case "sceneChanged":
      return {
        type: "sceneChanged",
        taskId: event.data.taskId,
        scene: event.data.scene,
      };
    case "documentChanged":
      return {
        type: "documentChanged",
        taskId: event.data.taskId,
        document: event.data.document,
      };
    case "workspaceViewChanged":
      return { type: "workspaceViewChanged", ...event.data };
    case "commandsChanged":
      return { type: "commandsChanged", ...event.data };
    case "usageChanged":
      return { type: "usageReceived", usage: event.data };
    case "providerSettingsChanged":
      return { type: "providerReceived", provider: event.data };
    case "workspaceSnapshot":
    case "workspaceChanged":
    case "taskChanged":
    case "taskUpdated":
      return undefined;
    default: {
      const unnamed: never = event;
      return unnamed;
    }
  }
}
