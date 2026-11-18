import type { CoreApi } from "./core-api.js";

/**
 * Every command channel and nothing else; the two event channels travel the
 * other way. The preload bridge offers exactly these and the main process
 * forwards exactly these, so a command is added in one place.
 */
export const COMMAND_CHANNELS = {
  configureProfile: "zhiyin:configure-profile",
  recoverHistory: "zhiyin:recover-history",
  settleSavedConversations: "zhiyin:settle-saved-conversations",
  chooseWorkspace: "zhiyin:choose-workspace",
  useRecentWorkspace: "zhiyin:use-recent-workspace",
  frontendReady: "zhiyin:frontend-ready",
  openDataFolder: "zhiyin:open-data-folder",
  openMemoryFolder: "zhiyin:open-memory-folder",
  showInFolder: "zhiyin:show-in-folder",
  createTask: "zhiyin:create-task",
  selectTask: "zhiyin:select-task",
  openTask: "zhiyin:open-task",
  selectNothing: "zhiyin:select-nothing",
  resendTask: "zhiyin:resend-task",
  renameTask: "zhiyin:rename-task",
  deleteTask: "zhiyin:delete-task",
  dismissIssue: "zhiyin:dismiss-issue",
  sendMessage: "zhiyin:send-message",
  keepPaste: "zhiyin:keep-paste",
  keepPicture: "zhiyin:keep-picture",
  setContextBudget: "zhiyin:set-context-budget",
  setDefaultContextBudget: "zhiyin:set-default-context-budget",
  memory: "zhiyin:memory",
  changeMemory: "zhiyin:change-memory",
  setConversationMemory: "zhiyin:set-conversation-memory",
  setNotifications: "zhiyin:set-notifications",
  setStudioReviews: "zhiyin:set-studio-reviews",
  setReviewerModel: "zhiyin:set-reviewer-model",
  reviewerModelSettings: "zhiyin:reviewer-model-settings",
  setWorkPauses: "zhiyin:set-work-pauses",
  setAppearance: "zhiyin:set-appearance",
  setLook: "zhiyin:set-look",
  setSpelling: "zhiyin:set-spelling",
  condenseNow: "zhiyin:condense-now",
  openAttachment: "zhiyin:open-attachment",
  previewRewind: "zhiyin:preview-rewind",
  commitRewind: "zhiyin:commit-rewind",
  previewUndo: "zhiyin:preview-undo",
  commitUndo: "zhiyin:commit-undo",
  compareDocument: "zhiyin:compare-document",
  interruptTask: "zhiyin:interrupt-task",
  answerNow: "zhiyin:answer-now",
  sendNow: "zhiyin:send-now",
  takeBackMessage: "zhiyin:take-back-message",
  runningCommands: "zhiyin:running-commands",
  commandOutput: "zhiyin:command-output",
  stopCommand: "zhiyin:stop-command",
  resolveApproval: "zhiyin:resolve-approval",
  revokeConversationPermission: "zhiyin:revoke-conversation-permission",
  resolveUserInput: "zhiyin:resolve-user-input",
  setPluginEnabled: "zhiyin:set-plugin-enabled",
  setComponentEnabled: "zhiyin:set-component-enabled",
  componentContent: "zhiyin:component-content",
  overrideComponent: "zhiyin:override-component",
  resetComponent: "zhiyin:reset-component",
  installToolchain: "zhiyin:install-toolchain",
  cancelToolchainInstall: "zhiyin:cancel-toolchain-install",
  dimWindowControls: "zhiyin:dim-window-controls",
  installPlugin: "zhiyin:install-plugin",
  updatePlugin: "zhiyin:update-plugin",
  rollbackPlugin: "zhiyin:rollback-plugin",
  removePlugin: "zhiyin:remove-plugin",
  createPlugin: "zhiyin:create-plugin",
  savePluginContents: "zhiyin:save-plugin-contents",
  editablePluginContents: "zhiyin:editable-plugin-contents",
  setMcpServerToolEnabled: "zhiyin:set-mcp-server-tool-enabled",
  setMcpServerToolTreatment: "zhiyin:set-mcp-server-tool-treatment",
  testMcpConnection: "zhiyin:test-mcp-connection",
  saveMcpServerToken: "zhiyin:save-mcp-server-token",
  clearMcpServerToken: "zhiyin:clear-mcp-server-token",
  signInToMcpServer: "zhiyin:sign-in-to-mcp-server",
  cancelMcpSignIn: "zhiyin:cancel-mcp-sign-in",
  refreshConnections: "zhiyin:refresh-connections",
  checkMcpConnection: "zhiyin:check-mcp-connection",
  shellAvailability: "zhiyin:shell-availability",
  recheckShell: "zhiyin:recheck-shell",
  openExternalUrl: "zhiyin:open-external-url",
  openAnswerLink: "zhiyin:open-answer-link",
  driveBrowser: "zhiyin:drive-browser",
  watchBrowser: "zhiyin:watch-browser",
  lookAtScene: "zhiyin:look-at-scene",
  partModel: "zhiyin:part-model",
  chooseWorkspaceView: "zhiyin:choose-workspace-view",
  showDocument: "zhiyin:show-document",
  closeDocument: "zhiyin:close-document",
  drawDocumentPage: "zhiyin:draw-document-page",
  openDocument: "zhiyin:open-document",
  showDocumentInFolder: "zhiyin:show-document-in-folder",
  listProviders: "zhiyin:list-providers",
  saveProviderApiKey: "zhiyin:save-provider-api-key",
  clearProviderApiKey: "zhiyin:clear-provider-api-key",
  listModels: "zhiyin:list-models",
  listModelProviders: "zhiyin:list-model-providers",
  selectModel: "zhiyin:select-model",
  modelList: "zhiyin:model-list",
  checkModelList: "zhiyin:check-model-list",
  setModelListUpdates: "zhiyin:set-model-list-updates",
  appUpdate: "zhiyin:app-update",
  checkForAppUpdate: "zhiyin:check-for-app-update",
  setAppUpdateChecks: "zhiyin:set-app-update-checks",
  restartToUpdate: "zhiyin:restart-to-update",
  previewArtifact: "zhiyin:preview-artifact",
  readPicture: "zhiyin:read-picture",
  exportArtifact: "zhiyin:export-artifact",
  exportView: "zhiyin:export-view",
  exportConversation: "zhiyin:export-conversation",
  answerViewCheck: "zhiyin:answer-view-check",
} as const;

/** IPC channel names. Shared so the two sides cannot disagree about them. */
export const CHANNEL = {
  ...COMMAND_CHANNELS,
  appEvent: "zhiyin:app-event",
  viewCheck: "zhiyin:view-check",
} as const;

/** A command the window can send, named as the channel it travels on. */
export type CommandName = keyof typeof COMMAND_CHANNELS;

/**
 * Every command, as the bridge offers it.
 *
 * The channel list and the bridge's interface are one vocabulary rather than
 * two lists kept in step by hand: a channel with no method here stops the
 * build, and so does a method with no channel — which would otherwise reach
 * the window as `undefined` and fail when someone pressed it.
 */
export type Commands = {
  [Name in CommandName]-?: NonNullable<CoreApi[Name]>;
};

type NothingLeft<Left extends never> = Left;

/** The other direction: a command on the bridge that travels on no channel. */
export type EveryCommandHasAChannel = NothingLeft<
  Exclude<keyof CoreApi, CommandName | "onAppEvent" | "onViewCheck">
>;

/** The property the preload bridge is exposed under on `window`. */
export const BRIDGE_KEY = "zhiyin";
