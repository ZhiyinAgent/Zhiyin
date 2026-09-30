import type { ArtifactExport, ArtifactPreview } from "./artifacts.js";
import type {
  BrowserIntent,
  ConversationBrowserState,
} from "./browser-state.js";
import type { ContextBudgetChoice } from "./context-budget.js";
import type { CoreInfo } from "./core-info.js";
import type {
  McpConnectionTestOutcome,
  McpServerDefinition,
  McpServerState,
} from "./mcp-state.js";
import type { PasteOutcome, SendMessage } from "./messages.js";
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
import type { RewindCommitResult, RewindPreview } from "./rewind.js";
import type { WorkspaceTask } from "./task.js";
import type { ToolInvocationResult } from "./tool-invocation.js";
import type { ShellAvailability } from "./tools.js";
import type {
  EvidenceState,
  ProviderUsage,
  UsageState,
} from "./usage-state.js";
import type { UserInputResponse } from "./user-input.js";
import type { ViewCheckOutcome, ViewCheckRequest } from "./views.js";
import type { WorkspaceSnapshot } from "./workspace-snapshot.js";

/** A page of the app. */
export type AppSurface =
  "thread" | "library" | "usage" | "evidence" | "settings";

export type AppEvent =
  | { readonly kind: "coreReady"; readonly data: CoreInfo }
  | { readonly kind: "workspaceSnapshot"; readonly data: WorkspaceSnapshot }
  | { readonly kind: "taskChanged"; readonly data: WorkspaceTask }
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
export interface CoreApi {
  configureProfile?(interests: readonly string[]): Promise<void>;
  /**
   * Answers the damaged-history question. `recover` keeps the conversations
   * that could be read; `startFresh` begins again, with the damaged file still
   * kept aside.
   */
  recoverHistory?(choice: "recover" | "startFresh"): Promise<void>;
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

  /** Reads private local correction and recovery retention information. */
  readEvidence(): Promise<EvidenceState>;

  /** Deletes one class of retained private evidence. */
  clearEvidence(kind: "corrections" | "recovery"): Promise<EvidenceState>;

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
   * snapshot that arrives for any other reason. Optional so a renderer built
   * against an older core keeps working.
   */
  selectNothing?(): Promise<void>;

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

  /** How full a conversation may grow before it is condensed. */
  setContextBudget(taskId: string, budget: ContextBudgetChoice): Promise<void>;

  /** The budget every conversation without its own choice follows. */
  setDefaultContextBudget(budget: ContextBudgetChoice): Promise<void>;
  setPersonalInstructions(text: string): Promise<void>;

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

  /** Stop the active turn for a task and all work it owns. */
  interruptTask(taskId: string): Promise<void>;

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

  /** Forget the stored access token for one MCP server. */
  clearMcpServerToken(id: string): Promise<void>;

  /**
   * Re-checks every connection's status now, built-in and configured alike —
   * for a built-in, this is what notices a fixed prerequisite (git installed,
   * a browser now present) without waiting for an unrelated action to happen
   * to trigger a refresh.
   */
  refreshConnections(): Promise<void>;

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

  /** Subscribe to the event stream. Returns an unsubscribe function. */
  onAppEvent(handler: (event: AppEvent) => void): () => void;

  /**
   * Answer a question the core asked. The core cannot know whether a view is
   * drawable, because only the surface holding the drawing library can, so this
   * is the one place the renderer replies rather than requests (ADR 0017).
   */
  answerViewCheck(requestId: string, outcome: ViewCheckOutcome): Promise<void>;

  /** Subscribe to view checks the core asks for. Returns an unsubscribe. */
  onViewCheck(handler: (request: ViewCheckRequest) => void): () => void;
}
