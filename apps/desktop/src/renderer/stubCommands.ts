/**
 * The core's commands as the window's tests stand them in: each answers
 * plainly and does nothing. A test replaces the commands it watches.
 */

import type { CoreApi } from "@zhiyin/contract";

/** The list shipped with the version under test, with updates on. */
const stubModelList = {
  source: "shipped",
  version: 1,
  published: "2026-10-22",
  updates: true,
} as const;

/** Every command the window may reach for, doing nothing. */
export const stubCommands: CoreApi = {
  frontendReady: async () => {},
  createTask: async () => "task-1",
  selectTask: async () => {},
  openTask: async () => {},
  resendTask: async () => {},
  renameTask: async () => {},
  deleteTask: async () => {},
  sendMessage: async () => {},
  keepPaste: async () => ({ status: "refused", reason: "Not kept here." }),
  setContextBudget: async () => {},
  setDefaultContextBudget: async () => {},
  memory: async () => undefined,
  changeMemory: async () => ({ ok: false, reason: "Not kept here." }),
  setConversationMemory: async () => {},
  setNotifications: async () => {},
  setStudioReviews: async () => {},
  setReviewerModel: async () => {},
  reviewerModelSettings: async () => null,
  setWorkPauses: async () => {},
  undoBudget: async () => null,
  setUndoBudget: async (bytes) => ({
    budgetBytes: bytes,
    usedBytes: 0,
    chosen: true,
  }),
  openDataFolder: async () => {},
  openMemoryFolder: async () => {},
  showInFolder: async () => {},
  setAppearance: async () => {},
  setLook: async () => {},
  setSpelling: async () => {},
  keepPicture: async () => ({
    status: "refused" as const,
    reason: "Not in this test.",
  }),
  condenseNow: async () => {},
  openAttachment: async () => {},
  previewRewind: async () => {
    throw new Error("No rewind preview configured for this test.");
  },
  commitRewind: async () => ({ files: [] }),
  previewUndo: async () => {
    throw new Error("No undo preview configured for this test.");
  },
  commitUndo: async () => ({ files: [] }),
  compareDocument: async () => ({ after: [] }),
  interruptTask: async () => {},
  answerNow: async () => false,
  sendNow: async () => false,
  takeBackMessage: async () => {},
  runningCommands: async () => [],
  commandOutput: async () => undefined,
  stopCommand: async () => {},
  resolveApproval: async () => {},
  revokeConversationPermission: async () => {},
  resolveUserInput: async () => {},
  setComponentEnabled: async () => {},
  componentContent: async () => undefined,
  overrideComponent: async () => {},
  resetComponent: async () => {},
  installToolchain: async () => {},
  cancelToolchainInstall: async () => {},
  dimWindowControls: async () => {},
  setPluginEnabled: async () => {},
  installPlugin: async () => ({ status: "cancelled" }),
  updatePlugin: async () => ({ status: "cancelled" }),
  rollbackPlugin: async () => {},
  removePlugin: async () => {},
  createPlugin: async () => {},
  savePluginContents: async () => {},
  editablePluginContents: async () => undefined,
  setMcpServerToolEnabled: async () => {},
  setMcpServerToolTreatment: async () => {},
  testMcpConnection: async () => ({ ok: false, reason: "Not configured." }),
  saveMcpServerToken: async () => {},
  clearMcpServerToken: async () => {},
  signInToMcpServer: async () => ({ status: "cancelled" }),
  cancelMcpSignIn: async () => {},
  refreshConnections: async () => {},
  checkMcpConnection: async () => {
    throw new Error("Not configured.");
  },
  shellAvailability: async () => ({ available: true }),
  recheckShell: async () => ({ available: true }),
  settleSavedConversations: async () => ({ done: 0, failed: 0 }),
  openExternalUrl: async () => {},
  openAnswerLink: async () => {},
  driveBrowser: async () => {},
  watchBrowser: async () => {},
  lookAtScene: async () => {},
  partModel: async () => undefined,
  chooseWorkspaceView: async () => {},
  showDocument: async () => ({ ok: true }),
  closeDocument: async () => {},
  drawDocumentPage: async () => ({ ok: false, reason: "Not drawn here." }),
  openDocument: async () => {},
  showDocumentInFolder: async () => {},
  listProviders: async () => [],
  saveProviderApiKey: async () => ({ status: "accepted" as const }),
  clearProviderApiKey: async () => {},
  listModels: async () => ({ status: "ready" as const, models: [] }),
  listModelProviders: async () => ({
    status: "unavailable" as const,
    reason: "not in this test",
  }),
  selectModel: async () => {},
  modelList: async () => stubModelList,
  checkModelList: async () => stubModelList,
  setModelListUpdates: async () => stubModelList,
  // As a copy run from its source: it does not update itself.
  appUpdate: async () => {
    throw new Error("This copy of Zhiyin does not update itself.");
  },
  checkForAppUpdate: async () => {
    throw new Error("This copy of Zhiyin does not update itself.");
  },
  setAppUpdateChecks: async () => {
    throw new Error("This copy of Zhiyin does not update itself.");
  },
  restartToUpdate: async () => {
    throw new Error("This copy of Zhiyin does not update itself.");
  },
  previewArtifact: async () => ({
    status: "missing",
    path: "",
    reason: "Not available in this test.",
  }),
  exportArtifact: async () => ({ status: "cancelled" }),
  exportView: async () => ({ status: "cancelled" }),
  exportConversation: async () => ({ status: "cancelled" }),
  onAppEvent: () => () => {},
  onViewCheck: () => () => {},
  answerViewCheck: async () => {},
};
