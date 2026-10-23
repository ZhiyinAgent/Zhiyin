import { describe, expect, it } from "vitest";
import {
  ALLOWED_EXTERNAL_URLS,
  COMMAND_CHANNELS,
  type BrowserIntent,
  type CommandName,
  type Commands,
  type SceneIntent,
} from "@zhiyin/contract";
import { validateCommand } from "../src/validation.js";

/**
 * One call of every command, typed as the command itself is. A command the
 * bridge gains has no call here until one is written, and a call that no
 * longer fits its command's type stops compiling; so what is let through below
 * is what the window is able to send.
 */
const calls: { readonly [Name in CommandName]: Parameters<Commands[Name]> } = {
  configureProfile: [["research", "software-engineering"]],
  recoverHistory: ["recover"],
  settleSavedConversations: ["update"],
  chooseWorkspace: [],
  useRecentWorkspace: ["C:/work/launch"],
  frontendReady: [],
  openDataFolder: [],
  showInFolder: ["C:/data/damaged-history"],
  createTask: [],
  selectTask: ["task-1"],
  openTask: ["task-1"],
  selectNothing: [],
  resendTask: ["task-1"],
  renameTask: ["task-1", "Plan the launch"],
  deleteTask: ["task-1"],
  dismissIssue: ["One conversation is damaged."],
  sendMessage: [
    "task-1",
    "Plan the launch",
    { enabled: true, effort: "high" },
    ["paste-1"],
    "guidance",
  ],
  keepPaste: ["A long pasted text."],
  keepPicture: [{ name: "chart.png", mediaType: "image/png", data: "AAAA" }],
  setContextBudget: ["task-1", "medium"],
  setDefaultContextBudget: ["ultra"],
  setPersonalInstructions: ["Answer briefly."],
  setNotifications: [true],
  setWorkPauses: [{ rounds: 50, minutes: 30, dollars: 10, yuan: 70 }],
  setAppearance: ["system"],
  setSpelling: [{ enabled: true, languages: ["en-GB", "fr"] }],
  condenseNow: ["task-1"],
  openAttachment: [null, "paste-1"],
  previewRewind: ["task-1", "message-1"],
  commitRewind: ["task-1", "rewind-1", "restore"],
  previewUndo: ["task-1", "message-1"],
  commitUndo: ["task-1", "undo-1"],
  compareDocument: ["task-1", "message-1", "report.pdf"],
  interruptTask: ["task-1"],
  answerNow: ["task-1"],
  sendNow: ["task-1"],
  takeBackMessage: ["task-1", "message-1"],
  runningCommands: ["task-1"],
  commandOutput: ["task-1", "job-1"],
  stopCommand: ["task-1", "job-1"],
  resolveApproval: ["task-1", "approval-1", "deny", "Not that folder."],
  revokeConversationPermission: ["task-1", "permission-1"],
  resolveUserInput: [
    "task-1",
    "input-1",
    { answers: [{ questionId: "question-1", answerIds: ["answer-1"] }] },
  ],
  setPluginEnabled: ["research", true],
  setComponentEnabled: ["research/reader", false],
  componentContent: ["research/reader"],
  overrideComponent: [
    "research/reader",
    { name: "Reader", description: "Reads.", instructions: "Read it." },
  ],
  resetComponent: ["research/reader"],
  installToolchain: ["blender"],
  cancelToolchainInstall: ["blender"],
  dimWindowControls: [true],
  installPlugin: [],
  updatePlugin: ["research"],
  rollbackPlugin: ["research"],
  removePlugin: ["research"],
  createPlugin: ["Launch notes", "Notes for a launch."],
  savePluginContents: [
    "launch-notes",
    {
      displayName: "Launch notes",
      description: "Notes for a launch.",
      skills: [{ id: "plan", description: "Plans.", instructions: "Plan." }],
      specialists: [
        {
          id: "reader",
          name: "Reader",
          description: "Reads.",
          instructions: "Read it.",
          access: "read",
          tools: ["read_file"],
        },
      ],
      mcpServers: [
        {
          id: "tracker",
          name: "Tracker",
          description: "The issue tracker.",
          url: "https://tracker.example/mcp",
          access: "Reads and files issues.",
          dataDestination: "tracker.example",
        },
      ],
    },
  ],
  editablePluginContents: ["launch-notes"],
  setMcpServerToolEnabled: ["tracker", "file_issue", false],
  testMcpConnection: [
    {
      id: "tracker",
      name: "Tracker",
      url: "https://tracker.example/mcp",
      enabled: true,
      disabledTools: ["file_issue"],
    },
    "a-token",
  ],
  saveMcpServerToken: ["tracker", "a-token"],
  clearMcpServerToken: ["tracker"],
  signInToMcpServer: ["tracker"],
  cancelMcpSignIn: ["tracker"],
  refreshConnections: [],
  checkMcpConnection: ["tracker"],
  shellAvailability: [],
  recheckShell: [],
  openExternalUrl: [ALLOWED_EXTERNAL_URLS[0]],
  driveBrowser: [{ kind: "navigate", url: "https://example.com" }],
  watchBrowser: ["task-1", { width: 900, height: 560 }],
  lookAtScene: [{ kind: "turn", yaw: 15, pitch: -5 }],
  chooseWorkspaceView: ["task-1", "scene"],
  showDocument: ["task-1", "report.pdf", 3],
  closeDocument: ["task-1"],
  drawDocumentPage: ["task-1", "revision-1", 1, 1200],
  openDocument: ["task-1", "report.pdf"],
  showDocumentInFolder: ["task-1", "report.pdf"],
  listProviders: [],
  saveProviderApiKey: ["a-key", { provider: "deepseek", region: "global" }],
  clearProviderApiKey: [{ provider: "deepseek" }],
  listModels: [{ provider: "deepseek" }],
  listModelProviders: ["z-ai/glm-5.3", { provider: "openrouter" }],
  selectModel: ["z-ai/glm-5.3", ["z-ai"], { provider: "openrouter" }],
  modelList: [],
  checkModelList: [],
  setModelListUpdates: [false],
  previewArtifact: ["task-1", "plan.md"],
  readPicture: ["picture-1.png"],
  exportArtifact: ["task-1", "plan.md"],
  exportView: ["task-1", "view-1", "<svg></svg>"],
  exportConversation: ["task-1", "html"],
  answerViewCheck: ["check-1", { ok: false, reason: "The diagram is empty." }],
};

const browserIntents: {
  readonly [Kind in BrowserIntent["kind"]]: BrowserIntent;
} = {
  open: { kind: "open", url: "https://example.com" },
  close: { kind: "close" },
  navigate: { kind: "navigate", url: "https://example.com" },
  back: { kind: "back" },
  forward: { kind: "forward" },
  reload: { kind: "reload" },
  click: { kind: "click", x: 10, y: 20 },
  type: { kind: "type", text: "launch" },
  key: { kind: "key", key: "Enter" },
  scroll: { kind: "scroll", x: 10, y: 20, deltaY: -120 },
};

const sceneIntents: { readonly [Kind in SceneIntent["kind"]]: SceneIntent } = {
  view: { kind: "view", view: "overview" },
  turn: { kind: "turn", yaw: 15, pitch: -5 },
  zoom: { kind: "zoom", factor: 1.2 },
  reset: { kind: "reset" },
  size: { kind: "size", width: 1280, height: 720 },
};

function allowed(name: CommandName, args: readonly unknown[]): boolean {
  try {
    validateCommand(COMMAND_CHANNELS[name], args);
    return true;
  } catch {
    return false;
  }
}

describe("the shape a command's arguments are held to", () => {
  it.each(Object.keys(calls) as CommandName[])(
    "lets through a call of %s as its type describes it",
    (name) => {
      expect(allowed(name, calls[name])).toBe(true);
    },
  );

  it("lets through every kind of step in the agent's browser, and no other", () => {
    for (const intent of Object.values(browserIntents))
      expect(allowed("driveBrowser", [intent])).toBe(true);
    expect(allowed("driveBrowser", [{ kind: "download" }])).toBe(false);
  });

  it("lets through every way of looking at a 3D scene, and no other", () => {
    for (const intent of Object.values(sceneIntents))
      expect(allowed("lookAtScene", [intent])).toBe(true);
    expect(allowed("lookAtScene", [{ kind: "spin" }])).toBe(false);
  });

  it("refuses a choice its command does not offer", () => {
    for (const [name, args] of [
      ["setAppearance", ["sepia"]],
      ["setDefaultContextBudget", ["huge"]],
      ["chooseWorkspaceView", ["task-1", "terminal"]],
      ["commitRewind", ["task-1", "rewind-1", "discard"]],
      ["exportConversation", ["task-1", "pdf"]],
      ["resolveApproval", ["task-1", "approval-1", "always"]],
      ["recoverHistory", ["forget"]],
      ["settleSavedConversations", ["delete"]],
      ["lookAtScene", [{ kind: "view", view: "inside" }]],
    ] as const)
      expect(allowed(name, args)).toBe(false);
  });
});
