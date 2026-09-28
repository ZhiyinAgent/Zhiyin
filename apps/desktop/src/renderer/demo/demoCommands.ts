/**
 * A core for the demo to talk to.
 *
 * The window only ever drives the app through the core's commands, so the demo
 * supplies a core rather than a second way through the shell. What it cannot
 * pretend to do — run a turn, read a file, reach a provider — it says so
 * plainly instead of answering as though it had.
 */

import type { WorkspaceCommands } from "../ui/app/index.js";
import type { DemoAction } from "./demoReducer.js";
import { demoCatalog } from "./fixtures.js";

const notInTheDemo = (what: string) => new Error(`The demo does not ${what}.`);

export function demoCommands(
  dispatch: (action: DemoAction) => void,
): WorkspaceCommands {
  let created = 0;
  return {
    frontendReady: async () => {},
    createTask: async () => {
      created += 1;
      const id = `demo-task-${created}`;
      dispatch({ type: "taskCreated", id });
      return id;
    },
    selectTask: async (id) => dispatch({ type: "taskSelected", id }),
    selectNothing: async () => dispatch({ type: "newTaskStarted" }),
    renameTask: async (taskId, title) =>
      dispatch({ type: "taskRenamed", taskId, title }),
    deleteTask: async (taskId) => dispatch({ type: "taskDeleted", taskId }),
    sendMessage: async (taskId, message) =>
      dispatch({ type: "messageSubmitted", taskId, message }),
    // The demo keeps nothing; a paste is shown as though it were kept.
    keepPaste: async (text) => ({
      status: "kept",
      attachment: {
        kind: "pastedText",
        id: "pasted-demo.txt",
        bytes: new TextEncoder().encode(text).length,
        lines: text.split("\n").length,
      },
    }),
    openAttachment: async () => {},
    setContextBudget: async (taskId, budget) =>
      dispatch({ type: "contextBudgetChosen", taskId, budget }),
    setDefaultContextBudget: async (budget) =>
      dispatch({ type: "defaultContextBudgetChosen", budget }),
    setPersonalInstructions: async (text) =>
      dispatch({ type: "personalInstructionsSaved", text }),
    condenseNow: async () => {},
    interruptTask: async (taskId) =>
      dispatch({ type: "taskInterrupted", taskId }),
    resolveApproval: async (taskId, _requestId, decision) =>
      dispatch({
        type: "approvalResolved",
        taskId,
        allowed: decision === "allow",
      }),
    revokeConversationPermission: async () => {},
    resolveUserInput: async () => {
      throw notInTheDemo("run a task");
    },
    setPluginEnabled: async (id, enabled) =>
      dispatch({ type: "pluginToggled", id, enabled }),
    setComponentEnabled: async (id, enabled) =>
      dispatch({ type: "componentToggled", id, enabled }),
    componentContent: async (id) => ({
      id,
      kind: "skill" as const,
      name: id.slice(id.indexOf("/") + 1),
      description: "Use when changing behavior.",
      instructions: "Write the failing test, then the smallest change.",
      editing: "override" as const,
      shipped: {
        name: id.slice(id.indexOf("/") + 1),
        description: "Use when changing behavior.",
        instructions: "Write the failing test first.",
      },
      shippedChanged: true,
    }),
    overrideComponent: async () => {
      throw notInTheDemo("keep edits");
    },
    resetComponent: async () => {
      throw notInTheDemo("keep edits");
    },
    installToolchain: async () => {
      throw notInTheDemo("download programs");
    },
    installPlugin: async () => ({ status: "cancelled" as const }),
    updatePlugin: async () => ({ status: "cancelled" as const }),
    rollbackPlugin: async () => {},
    removePlugin: async () => {},
    createPlugin: async () => {},
    savePluginContents: async () => {},
    editablePluginContents: async () => ({
      displayName: "Weather Pro",
      description: "Weather tools for planning trips.",
      skills: [
        {
          id: "fetch-forecast",
          description: "Look up a forecast for a place.",
          instructions: "Ask for a location, then call the forecast tool.",
        },
      ],
      specialists: [
        {
          id: "route-planner",
          name: "Route planner",
          description: "Plans routes around bad weather.",
          instructions: "Avoid storms. Prefer scenic routes when clear.",
        },
      ],
      mcpServers: [
        {
          id: "weather-api",
          name: "Weather API",
          description: "Live weather data.",
          url: "https://example.com/mcp",
        },
      ],
    }),
    setMcpServerToolEnabled: async () => {},
    testMcpConnection: async () => ({
      ok: true,
      tools: [
        { name: "search", description: "Search the web.", enabled: true },
      ],
    }),
    saveMcpServerToken: async () => {
      throw notInTheDemo("keep access tokens");
    },
    clearMcpServerToken: async () => {
      throw notInTheDemo("keep access tokens");
    },
    refreshConnections: async () => {},
    shellAvailability: async () => ({ available: true }),
    recheckShell: async () => ({ available: true }),
    openExternalUrl: async () => {
      throw notInTheDemo("open a link");
    },
    driveBrowser: async () => {
      throw notInTheDemo("open a browser");
    },
    chooseWorkspace: async () => {
      throw notInTheDemo("choose a folder");
    },
    useRecentWorkspace: async () => {
      throw notInTheDemo("open a folder");
    },
    configureProfile: async () => {},
    recoverHistory: async () => {},
    saveProviderApiKey: async () => ({ status: "accepted" as const }),
    clearProviderApiKey: async () => {},
    listModels: async () => demoCatalog,
    listModelProviders: async () => ({
      status: "unavailable" as const,
      reason: "The demo does not reach the provider.",
    }),
    selectModel: async () => {},
    previewArtifact: async (_taskId, path) => ({
      status: "missing" as const,
      path,
      reason: "The demo has no files of its own.",
    }),
    exportArtifact: async () => ({ status: "cancelled" as const }),
  };
}
