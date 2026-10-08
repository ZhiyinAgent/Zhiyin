import type {
  ArtifactExport,
  ArtifactPreview,
  ConversationFormat,
} from "./artifacts.js";
import type {
  BrowserIntent,
  ConversationBrowserState,
} from "./browser-state.js";
import type { CommandOutput, RunningCommand } from "./command-jobs.js";
import type { ContextBudgetChoice } from "./context-budget.js";
import type { CoreInfo } from "./core-info.js";
import type {
  ConversationDocumentState,
  ConversationWorkspaceView,
  DocumentCommands,
} from "./documents.js";
import type { SavedConversationsOutcome } from "./history.js";
import type { SpellingChoice } from "./spelling.js";
import type {
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
  McpSignInOutcome,
} from "./mcp-state.js";
import type { PasteOutcome, PictureToKeep, SendMessage } from "./messages.js";
import type {
  ApiKeySaveOutcome,
  ModelCatalog,
  ModelProviderList,
  ProviderSettings,
} from "./models.js";
import type { StoredPicture } from "./pictures.js";
import type {
  AuthoredPluginContents,
  ComponentContent,
  ComponentContentDraft,
  PluginSourceOutcome,
  PluginState,
} from "./plugin-state.js";
import type {
  DocumentComparison,
  RewindCommitResult,
  RewindPreview,
  UndoPreview,
} from "./rewind.js";
import type { WorkspaceTask } from "./task.js";
import type { ToolInvocationResult } from "./tool-invocation.js";
import type { ShellAvailability } from "./tools.js";
import type { ProviderUsage, UsageState } from "./usage-state.js";
import type { UserInputResponse } from "./user-input.js";
import type { ViewCheckOutcome, ViewCheckRequest } from "./views.js";
import type { TaskChange, WorkspaceChange } from "./window-changes.js";
import type { Appearance, WorkspaceSnapshot } from "./workspace-snapshot.js";

/** A page of the app. */
export type AppSurface = "thread" | "library" | "usage" | "settings";

/** What the core tells the window, on one stream rather than one per feature. */
export type AppEvent =
  | { readonly kind: "coreReady"; readonly data: CoreInfo }
  | { readonly kind: "workspaceSnapshot"; readonly data: WorkspaceSnapshot }
  /** Sent once a window has the workspace whole: only what changed in it. */
  | { readonly kind: "workspaceChanged"; readonly data: WorkspaceChange }
  /** A conversation sent whole. Its changes are numbered again from here. */
  | { readonly kind: "taskChanged"; readonly data: WorkspaceTask }
  | { readonly kind: "taskUpdated"; readonly data: TaskChange }
  | {
      readonly kind: "taskRemoved";
      readonly data: {
        readonly taskId: string;
        readonly selectedTaskId: string | null;
      };
    }
  | {
      readonly kind: "taskSelectionChanged";
      readonly data: { readonly taskId: string | null };
    }
  | {
      readonly kind: "mcpServersChanged";
      readonly data: readonly McpServerState[];
    }
  | {
      readonly kind: "pluginsChanged";
      readonly data: readonly PluginState[];
    }
  | {
      readonly kind: "browserChanged";
      readonly data: ConversationBrowserState;
    }
  | {
      readonly kind: "documentChanged";
      readonly data: ConversationDocumentState;
    }
  | {
      /** What the space beside a conversation shows now. */
      readonly kind: "workspaceViewChanged";
      readonly data: ConversationWorkspaceView;
    }
  | {
      /** A conversation's commands running as jobs, as they now stand. */
      readonly kind: "commandsChanged";
      readonly data: {
        readonly taskId: string;
        readonly commands: readonly RunningCommand[];
      };
    }
  | { readonly kind: "usageRecorded"; readonly data: ProviderUsage }
  | { readonly kind: "usageChanged"; readonly data: UsageState }
  | {
      readonly kind: "providerSettingsChanged";
      readonly data: ProviderSettings;
    }
  | {
      readonly kind: "toolActivity";
      readonly data: {
        readonly taskId: string;
        readonly callId: string;
        readonly toolName: string;
        readonly status:
          "approved" | "denied" | "completed" | "reported" | "failed";
        readonly result?: ToolInvocationResult;
      };
    };

/**
 * The whole surface the renderer is given. The preload bridge exposes exactly
 * this and nothing else — no Node, no Electron, no filesystem.
 */
export interface CoreApi extends DocumentCommands {
  configureProfile?(interests: readonly string[]): Promise<void>;
  /**
   * Answers the damaged-history question. `recover` keeps the conversations
   * that could be read; `startFresh` begins again, with the damaged file still
   * kept aside.
   */
  recoverHistory?(choice: "recover" | "startFresh"): Promise<void>;
  /**
   * Answers the question about conversations an older version saved: `update`
   * brings each to the current format, `recycle` moves each to the Recycle
   * Bin. One that cannot be is left as it was. ADR 0022.
   */
  settleSavedConversations?(
    choice: "update" | "recycle",
  ): Promise<SavedConversationsOutcome>;
  chooseWorkspace?(): Promise<void>;
  /**
   * Return to a folder already worked in. The path must come from
   * `recentWorkspaces`; anything else is rejected by the core, so the
   * renderer can never name a folder a person did not once choose in a dialog.
   */
  useRecentWorkspace?(path: string): Promise<void>;
  /**
   * The renderer announcing it has mounted and is listening. A handshake rather
   * than the core emitting at startup, which would race the window attaching
   * its listener.
   */
  frontendReady(): Promise<void>;

  /** Opens the folder where Zhiyin keeps its data. ADR 0019. */
  openDataFolder(): Promise<void>;

  /**
   * Shows a file Zhiyin kept, such as the copy of a damaged conversation,
   * selected in its folder. Only a path inside the data folder is shown, or a
   * conversation this session exported where the person chose.
   */
  showInFolder(path: string): Promise<void>;

  /** Create and select an empty task. The returned id is core-owned. */
  createTask(): Promise<string>;

  /** Select a task that already exists in the authoritative snapshot. */
  selectTask(taskId: string): Promise<void>;

  /**
   * Open no conversation at all — the empty page a new one is started from.
   *
   * The core has to be told. Every snapshot it sends carries which
   * conversation is open, so a window showing a blank page while the core
   * still believes the last one is open is thrown back into it by the next
   * snapshot that arrives for any other reason.
   */
  selectNothing?(): Promise<void>;

  /**
   * Send one conversation whole again, for a window that missed one of its
   * changes. Nothing is sent for a conversation that is not open.
   */
  resendTask(taskId: string): Promise<void>;

  renameTask(taskId: string, title: string): Promise<void>;

  deleteTask(taskId: string): Promise<void>;

  /** Stop showing a reported issue, named by its message. */
  dismissIssue?(message: string): Promise<void>;

  /**
   * Start a model turn for a task. Streaming progress arrives as events.
   * `attachments` names pastes `keepPaste` kept; a message may be only those.
   */
  sendMessage: SendMessage;

  /** Keeps a long paste as a draft attachment, so the composer never holds it. */
  keepPaste(text: string): Promise<PasteOutcome>;

  /**
   * Keeps a picture for the next message, as `keepPaste` keeps a text. Refused
   * when the chosen model cannot see pictures, or the picture is not one.
   */
  keepPicture(picture: PictureToKeep): Promise<PasteOutcome>;

  /** How full a conversation may grow before it is condensed. */
  setContextBudget(taskId: string, budget: ContextBudgetChoice): Promise<void>;

  /** The budget every conversation without its own choice follows. */
  setDefaultContextBudget(budget: ContextBudgetChoice): Promise<void>;
  setPersonalInstructions(text: string): Promise<void>;
  /** Whether Zhiyin may notify the person outside its window. */
  setNotifications(enabled: boolean): Promise<void>;

  /** Paints the window light, dark, or as Windows is set. */
  setAppearance(appearance: Appearance): Promise<void>;

  /** Turns spelling on or off, and chooses the languages it checks. */
  setSpelling(choice: SpellingChoice): Promise<void>;

  /** Condenses now, or before the running turn's next request. */
  condenseNow(taskId: string): Promise<void>;

  /** Opens a pasted text in the person's own editor; `taskId` null for a draft. */
  openAttachment(taskId: string | null, id: string): Promise<void>;

  /** Review the exact conversation revision before discarding anything. */
  previewRewind(taskId: string, messageId: string): Promise<RewindPreview>;

  /** Apply only the still-current rewind previously returned by previewRewind. */
  commitRewind(
    taskId: string,
    rewindId: string,
    files: "keep" | "restore",
  ): Promise<RewindCommitResult>;

  /** Review putting back the files one turn changed, keeping the conversation. */
  previewUndo(taskId: string, messageId: string): Promise<UndoPreview>;

  /** Put back exactly the reviewed files, never one changed since. */
  commitUndo(taskId: string, undoId: string): Promise<RewindCommitResult>;

  /**
   * What one turn changed in a PDF, as its words before and after. Refused
   * when no copy was kept before the turn or the PDF has changed since.
   */
  compareDocument(
    taskId: string,
    messageId: string,
    path: string,
  ): Promise<DocumentComparison>;

  /** Stop the active turn for a task and all work it owns. */
  interruptTask(taskId: string): Promise<void>;

  /** A conversation's commands that carried on as jobs and still run. */
  runningCommands(taskId: string): Promise<readonly RunningCommand[]>;
  /** What a running command has printed so far; nothing once it has ended. */
  commandOutput(
    taskId: string,
    jobId: string,
  ): Promise<CommandOutput | undefined>;
  /**
   * Stops a running command with everything it started. The conversation is
   * told at its next request; what the command already did stays done.
   */
  stopCommand(taskId: string, jobId: string): Promise<void>;

  /** Resolve the exact permission request currently blocking a task. */
  resolveApproval(
    taskId: string,
    requestId: string,
    decision: "allow" | "allow-conversation" | "deny",
    reason?: string,
  ): Promise<void>;

  /** Remove a permission previously granted for this conversation. */
  revokeConversationPermission(
    taskId: string,
    permissionId: string,
  ): Promise<void>;

  /** Resolve the exact structured question request currently blocking a task. */
  resolveUserInput(
    taskId: string,
    requestId: string,
    response: UserInputResponse,
  ): Promise<void>;

  setPluginEnabled(id: string, enabled: boolean): Promise<void>;

  /** Turns one skill, specialist, or connector on or off, by its full id. */
  setComponentEnabled(id: string, enabled: boolean): Promise<void>;

  /** A skill's or specialist's full content, or nothing for an unknown id. */
  componentContent(id: string): Promise<ComponentContent | undefined>;

  /** Layers a person's edit over a shipped or imported component. */
  overrideComponent(id: string, content: ComponentContentDraft): Promise<void>;

  /** Returns a component to the content its package ships. */
  resetComponent(id: string): Promise<void>;

  /** Downloads and installs the program an application connector needs. */
  installToolchain(id: string): Promise<void>;

  /** Asks for a local package directory and installs it, or is cancelled. */
  installPlugin(): Promise<PluginSourceOutcome>;
  /** Asks for a local package directory and updates the named plugin to it. */
  updatePlugin(id: string): Promise<PluginSourceOutcome>;
  rollbackPlugin(id: string): Promise<void>;
  removePlugin(id: string): Promise<void>;

  /** Creates an empty plugin, ready for skills, specialists, and connectors. */
  createPlugin(displayName: string, description: string): Promise<void>;
  /** Replaces one plugin's authored skills, specialists, and connectors. */
  savePluginContents(
    id: string,
    contents: AuthoredPluginContents,
  ): Promise<void>;
  /** One plugin's full authored content, for the component-edit form to open on. */
  editablePluginContents(
    id: string,
  ): Promise<AuthoredPluginContents | undefined>;

  setMcpServerToolEnabled(
    id: string,
    toolName: string,
    enabled: boolean,
  ): Promise<void>;

  /** A dry run against an endpoint and (optional) token, saving nothing. */
  testMcpConnection(
    server: McpServerDefinition,
    token?: string,
  ): Promise<McpConnectionTestOutcome>;

  /** Store an access token for one MCP server. The token is never read back. */
  saveMcpServerToken(id: string, token: string): Promise<void>;

  /** Forget the stored access token or sign-in for one MCP server. */
  clearMcpServerToken(id: string): Promise<void>;

  /**
   * Signs in to one MCP server through its service's own sign-in, in the
   * person's browser. Answers once they finish, decline, or cancel.
   */
  signInToMcpServer(id: string): Promise<McpSignInOutcome>;

  /** Stops a sign-in still waiting in the browser; nothing of it is kept. */
  cancelMcpSignIn(id: string): Promise<void>;

  /**
   * Re-checks every connection's status now, built-in and configured alike —
   * for a built-in, this is what notices a fixed prerequisite (git installed,
   * a browser now present) without waiting for an unrelated action to happen
   * to trigger a refresh.
   */
  refreshConnections(): Promise<void>;

  /**
   * Reaches one configured connection now and says how it answered. Nothing
   * reaches a connection merely to show it, so this is how a person learns
   * whether one works before a conversation needs it.
   */
  checkMcpConnection(id: string): Promise<McpServerState>;

  /** Whether the shell tool can run here, and why not when it can't. */
  shellAvailability(): Promise<ShellAvailability>;

  /** Re-detects the shell without restarting, so an install just now is picked up. */
  recheckShell(): Promise<ShellAvailability>;

  /**
   * Opens one of a small, known set of external links in the person's own
   * browser — never an arbitrary URL, so nothing rendered from untrusted
   * content can use this to reach somewhere unexpected.
   */
  openExternalUrl(url: string): Promise<void>;

  /** Ask the agent's browser to do one thing. */
  driveBrowser(intent: BrowserIntent): Promise<void>;

  saveProviderApiKey(apiKey: string): Promise<ApiKeySaveOutcome>;

  clearProviderApiKey(): Promise<void>;

  /** The models this account may use, or why the catalogue could not be read. */
  listModels(): Promise<ModelCatalog>;

  /** The upstreams that serve one model, with price and recent behaviour. */
  listModelProviders(model: string): Promise<ModelProviderList>;

  /**
   * Choose the model and the upstreams routing may use, together. They are one
   * command because a provider list belongs to the model it was chosen for;
   * applying them separately would leave a model briefly restricted to
   * upstreams that do not serve it.
   */
  selectModel(model: string, providers: readonly string[]): Promise<void>;

  /** Read a file this task produced, for review inside the app. */
  previewArtifact(taskId: string, path: string): Promise<ArtifactPreview>;
  /** The bytes of a picture an action produced, named by an `image` detail. */
  readPicture?(source: string): Promise<StoredPicture>;

  /**
   * Copy a file this task produced to a destination the person chooses. The
   * chooser lives in the main process; the renderer only asks for the copy.
   */
  exportArtifact(taskId: string, path: string): Promise<ArtifactExport>;

  /** Save a rendered conversation view to a destination the person chooses. */
  exportView(
    taskId: string,
    viewId: string,
    svg: string,
  ): Promise<ArtifactExport>;

  /**
   * Save a conversation as a page to read or a record to analyse, with known
   * credentials removed, where the person chooses.
   */
  exportConversation(
    taskId: string,
    format: ConversationFormat,
  ): Promise<ArtifactExport>;

  /** Subscribe to the event stream. Returns an unsubscribe function. */
  onAppEvent(handler: (event: AppEvent) => void): () => void;

  /**
   * Answer a question the core asked. The core cannot know whether a view is
   * drawable, because only the surface holding the drawing library can, so this
   * is the one place the renderer replies rather than requests (ADR 0003).
   */
  answerViewCheck(requestId: string, outcome: ViewCheckOutcome): Promise<void>;

  /** Subscribe to view checks the core asks for. Returns an unsubscribe. */
  onViewCheck(handler: (request: ViewCheckRequest) => void): () => void;
}
