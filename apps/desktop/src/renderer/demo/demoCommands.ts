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
import { demoDocument, drawSamplePage } from "./fixtures/documents.js";
import {
  demoCatalog,
  demoCheck,
  demoComponentContent,
  type DemoScenario,
} from "./fixtures.js";

const notInTheDemo = (what: string) => new Error(`The demo does not ${what}.`);

/**
 * A build the release conversation left running, printing as it goes — only
 * while that conversation is still at work.
 */
function demoBuild(started: boolean) {
  const command = {
    id: "J1",
    command: "npm run build -- --report",
    explanation:
      "Builds the release and writes a size report, to check it still compiles.",
    startedAt: Date.now() - 185_000,
  };
  let running = started;
  const owns = (taskId: string, jobId?: string) =>
    running && taskId === "release" && (jobId === undefined || jobId === "J1");
  return {
    list: (taskId: string) => (owns(taskId) ? [command] : []),
    output: (taskId: string, jobId: string) => {
      if (!owns(taskId, jobId)) return undefined;
      const done = Math.floor((Date.now() - command.startedAt) / 4_000);
      return {
        stdout: Array.from(
          { length: Math.min(done, 240) },
          (_, index) => `Compiled module ${index + 1} of 240`,
        ).join("\n"),
        stderr: "",
      };
    },
    stop: (taskId: string, jobId: string) => {
      const stopped = owns(taskId, jobId);
      running = running && !stopped;
      return stopped;
    },
  };
}

export function demoCommands(
  dispatch: (action: DemoAction) => void,
  scenario: DemoScenario = "working",
): WorkspaceCommands {
  let created = 0;
  // Each citation clicked points again, as the core counts it.
  let pointedCount = 0;
  const build = demoBuild(scenario === "working");
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
    dismissIssue: async () => undefined,
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
    setNotifications: async (enabled) =>
      dispatch({ type: "notificationsChosen", enabled }),
    setAppearance: async (appearance) =>
      dispatch({ type: "appearanceChosen", appearance }),
    setSpelling: async (choice) => dispatch({ type: "spellingChosen", choice }),
    // A browser cannot open a folder in Windows; the row is there to be seen.
    openDataFolder: async () => {},
    condenseNow: async () => {},
    interruptTask: async (taskId) =>
      dispatch({ type: "taskInterrupted", taskId }),
    runningCommands: async (taskId) => build.list(taskId),
    commandOutput: async (taskId, jobId) => build.output(taskId, jobId),
    stopCommand: async (taskId, jobId) => {
      if (build.stop(taskId, jobId))
        dispatch({ type: "commandsChanged", taskId, commands: [] });
    },
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
    componentContent: demoComponentContent,
    overrideComponent: async () => {
      throw notInTheDemo("keep edits");
    },
    resetComponent: async () => {
      throw notInTheDemo("keep edits");
    },
    installToolchain: async () => {
      throw notInTheDemo("download programs");
    },
    // Stands in for the folder a person would pick: the demo installs one.
    installPlugin: async () => {
      dispatch({ type: "pluginImported" });
      return { status: "applied" as const };
    },
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
    signInToMcpServer: async () => {
      throw notInTheDemo("sign in to a service");
    },
    cancelMcpSignIn: async () => {},
    refreshConnections: async () => {},
    checkMcpConnection: demoCheck,
    shellAvailability: async () => ({ available: true }),
    recheckShell: async () => ({ available: true }),
    openExternalUrl: async () => {
      throw notInTheDemo("open a link");
    },
    driveBrowser: async () => {
      throw notInTheDemo("open a browser");
    },
    chooseWorkspaceView: async (taskId, view) =>
      dispatch({ type: "workspaceViewChanged", taskId, view }),
    showDocument: async (taskId, path, page) => {
      const document = demoDocument(path);
      if (!document)
        return {
          ok: false,
          reason: `${path} is not a PDF or a picture this panel can draw.`,
        };
      const count = document.status === "shown" ? document.pages.length : 1;
      if (page !== undefined && page > count)
        return {
          ok: false,
          reason: `${document.name} has ${count} pages, so there is no page ${page}.`,
        };
      dispatch({
        type: "documentChanged",
        taskId,
        document:
          page === undefined || document.status !== "shown"
            ? document
            : { ...document, pointed: { page, count: ++pointedCount } },
      });
      dispatch({ type: "workspaceViewChanged", taskId, view: "document" });
      return { ok: true };
    },
    closeDocument: async (taskId) =>
      dispatch({ type: "documentClosed", taskId }),
    drawDocumentPage: async (_taskId, revision, page) =>
      drawSamplePage(revision, page),
    openDocument: async () => {
      throw notInTheDemo("open files in other apps");
    },
    showDocumentInFolder: async () => {
      throw notInTheDemo("show files in their folder");
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
    exportConversation: async (_taskId, format) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return {
        status: "saved" as const,
        destination: `C:\\Users\\sam\\Documents\\Conversation.${format}`,
      };
    },
    showInFolder: async () => {},
  };
}
