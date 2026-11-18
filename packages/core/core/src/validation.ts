import {
  ALLOWED_EXTERNAL_URLS,
  attachablePictureTypes,
  CHANNEL,
  COMMAND_CHANNELS,
  maximumSavedViewLength,
  portableName,
  portableNameLength,
  REASONING_EFFORTS,
  type Appearance,
  type BrowserButton,
  type BrowserHeldKey,
  type BrowserIntent,
  type BrowserPointer,
  type CommandName,
  type Commands,
  type ContextBudgetChoice,
  type ConversationFormat,
  type MemoryRequest,
  type MemorySection,
  type SceneIntent,
  type SceneView,
  type ThreeDContent,
  type WorkspaceView,
} from "@zhiyin/contract";
import {
  byKind,
  isLookChoice,
  isReviewerModelChoice,
  isWorkPauses,
  isConnectionToolTreatment,
  oneOf,
} from "@zhiyin/value-checks";
import { longestTypedMessage } from "@zhiyin/context-budget";

/*
 * The choices a command offers, each held to the type the command itself
 * declares: one the type gains has no entry here until it is written.
 */
const budget = oneOf<ContextBudgetChoice>({
  low: true,
  medium: true,
  ultra: true,
});
const appearance = oneOf<Appearance>({ system: true, light: true, dark: true });
const workspaceView = oneOf<WorkspaceView>({
  conversation: true,
  browser: true,
  document: true,
  "3d": true,
});
const threeDContent = oneOf<ThreeDContent>({ scene: true, parts: true });
const sceneView = oneOf<SceneView>({ camera: true, overview: true });
const specialistAccess = oneOf<"read" | "change">({ read: true, change: true });
const exportFormat = oneOf<ConversationFormat>({
  html: true,
  trajectory: true,
});
const rewoundFiles = oneOf<Parameters<Commands["commitRewind"]>[2]>({
  keep: true,
  restore: true,
});
const approvalDecision = oneOf<Parameters<Commands["resolveApproval"]>[2]>({
  allow: true,
  "allow-conversation": true,
  "allow-file": true,
  "allow-folder": true,
  deny: true,
});
const recoveryChoice = oneOf<Parameters<Commands["recoverHistory"]>[0]>({
  recover: true,
  startFresh: true,
});
const savedConversationsChoice = oneOf<
  Parameters<Commands["settleSavedConversations"]>[0]
>({ update: true, recycle: true });

function reasoningSelection(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => key !== "enabled" && key !== "effort"))
    return false;
  return item.enabled === false
    ? item.effort === undefined
    : item.enabled === true &&
        (item.effort === undefined ||
          REASONING_EFFORTS.some((effort) => effort === item.effort));
}

/** More languages than any dictionary set offers is not a choice. */
const spellingLanguages = 64;

/** On or off, and languages named once each: at least one while on. */
function spellingChoice(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const languages = item.languages;
  return (
    Object.keys(item).every(
      (key) => key === "enabled" || key === "languages",
    ) &&
    typeof item.enabled === "boolean" &&
    Array.isArray(languages) &&
    languages.length <= spellingLanguages &&
    languages.every((code) => text(code, 32)) &&
    new Set(languages).size === languages.length &&
    (!item.enabled || languages.length > 0)
  );
}

function text(value: unknown, maximum = 1000): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maximum
  );
}

/**
 * A provider, and its region where it has two. Names, not hosts: where
 * requests go is decided by the model client from the provider's own profile.
 */
/**
 * A web page an answer links to: http or https, a host, no name or password
 * in the address, and no longer than a browser's address bar holds well.
 * Anything else the shell could open, a file, a program or a settings page,
 * is refused here, whatever the window asks.
 */
function isAnswerLink(value: unknown): boolean {
  if (!text(value, 2_048)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    url.hostname !== "" &&
    url.username === "" &&
    url.password === ""
  );
}

function providerTarget(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).every((key) => key === "provider" || key === "region") &&
    text(item["provider"], 64) &&
    (item["region"] === undefined || text(item["region"], 64))
  );
}

/** Arguments that end with an optional provider target. */
function withTarget(args: readonly unknown[], required: number): boolean {
  return (
    args.length === required ||
    (args.length === required + 1 && providerTarget(args[required]))
  );
}

/** A 12 MB picture is 16 MB of base64; the store refuses anything larger. */
const pictureCharacters = 16 * 1024 * 1024;

function pictureToKeep(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).every((key) =>
      ["name", "mediaType", "data"].includes(key),
    ) &&
    text(item.name, 200) &&
    attachablePictureTypes.includes(item.mediaType as string) &&
    text(item.data, pictureCharacters)
  );
}

function connectionDefinition(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    text(item.id, 128) &&
    text(item.name, 160) &&
    typeof item.enabled === "boolean" &&
    text(item.url, 4000)
  );
}

function componentContentDraft(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).every((key) =>
      ["name", "description", "instructions"].includes(key),
    ) &&
    (item.name === undefined || text(item.name, 160)) &&
    text(item.description, 4000) &&
    text(item.instructions, 64_000)
  );
}

/** A plugin's portable name; the core refuses any name it did not list. */
function pluginName(value: unknown): boolean {
  return text(value, portableNameLength) && portableName.test(value);
}

function authoredSkillDraft(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  // A skill's name becomes the name of its folder in the package.
  return (
    pluginName(item.id) &&
    (item.name === undefined || text(item.name, 160)) &&
    text(item.description, 4000) &&
    text(item.instructions, 64_000)
  );
}

function authoredSpecialistDraft(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    text(item.id, 128) &&
    text(item.name, 160) &&
    text(item.description, 4000) &&
    text(item.instructions, 64_000) &&
    (item.access === undefined || specialistAccess(item.access)) &&
    // As a plugin may declare them: at most 50 tool names.
    (item.tools === undefined ||
      (Array.isArray(item.tools) &&
        item.tools.length <= 50 &&
        item.tools.every(
          (name) => text(name, 128) && (name as string).trim().length > 0,
        )))
  );
}

function authoredMcpServerDraft(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    text(item.id, 128) &&
    text(item.name, 160) &&
    text(item.description, 4000) &&
    text(item.url, 4000) &&
    (item.access === undefined || text(item.access, 4000)) &&
    (item.dataDestination === undefined || text(item.dataDestination, 4000))
  );
}

function authoredPluginContents(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    text(item.displayName, 160) &&
    text(item.description, 4000) &&
    Array.isArray(item.skills) &&
    item.skills.length <= 50 &&
    item.skills.every(authoredSkillDraft) &&
    Array.isArray(item.specialists) &&
    item.specialists.length <= 50 &&
    item.specialists.every(authoredSpecialistDraft) &&
    Array.isArray(item.mcpServers) &&
    item.mcpServers.length <= 50 &&
    item.mcpServers.every(authoredMcpServerDraft) &&
    namedOnce([...item.skills, ...item.specialists, ...item.mcpServers])
  );
}

/** No two components share a name: each is written under it. */
function namedOnce(components: readonly unknown[]): boolean {
  const ids = components.map((component) => (component as { id: string }).id);
  return new Set(ids).size === ids.length;
}

/**
 * A view check answer. The failure reason is bounded like any other text that
 * crosses the bridge: it reaches the model, and an unbounded string from
 * the renderer would be an unbounded string in a model request.
 */
function outcome(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.ok === true) return item.reason === undefined;
  return item.ok === false && text(item.reason, 4000);
}

function userInputResponse(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const answers = (value as Record<string, unknown>).answers;
  return (
    Array.isArray(answers) &&
    answers.length >= 1 &&
    answers.length <= 12 &&
    answers.every((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
      const answer = value as Record<string, unknown>;
      const ids = answer.answerIds;
      return (
        text(answer.questionId, 64) &&
        (ids === undefined ||
          (Array.isArray(ids) &&
            ids.length <= 8 &&
            ids.every((id) => text(id, 64)))) &&
        (answer.text === undefined || text(answer.text, 4000)) &&
        (ids !== undefined || answer.text !== undefined)
      );
    })
  );
}

const pointerAction = oneOf<BrowserPointer["action"]>({
  press: true,
  move: true,
  release: true,
});
const pointerButton = oneOf<BrowserButton>({ left: true, right: true });
const heldKey = oneOf<BrowserHeldKey>({
  Alt: true,
  Control: true,
  Shift: true,
});

/**
 * A page can put anything on screen, so what comes back from the panel is
 * checked as data rather than trusted as a shape. An address is bounded; a
 * coordinate is a finite number; text is capped at what a person could paste;
 * a pointer names a known button, a click count a mouse gives and the keys
 * held, each once.
 */
const browserIntent = byKind<BrowserIntent["kind"]>({
  open: (intent) => intent.url === undefined || text(intent.url, 4000),
  close: nothingElse,
  back: nothingElse,
  forward: nothingElse,
  reload: nothingElse,
  navigate: (intent) => text(intent.url, 4000),
  pointer: (intent) =>
    fields(intent) === (intent.button === undefined ? 6 : 7) &&
    pointerAction(intent.action) &&
    finite(intent.x) &&
    finite(intent.y) &&
    // A button goes down or comes up; only a pointer moving holds none.
    (intent.button === undefined
      ? intent.action === "move"
      : pointerButton(intent.button)) &&
    Number.isInteger(intent.clicks) &&
    within(intent.clicks, 3) &&
    intent.clicks >= 0 &&
    Array.isArray(intent.keys) &&
    intent.keys.length <= 3 &&
    new Set(intent.keys).size === intent.keys.length &&
    intent.keys.every(heldKey),
  scroll: (intent) =>
    finite(intent.x) &&
    finite(intent.y) &&
    finite(intent.deltaX) &&
    finite(intent.deltaY),
  type: (intent) => text(intent.text, 10_000),
  key: (intent) => text(intent.key, 32),
  copy: nothingElse,
  cut: nothingElse,
});

/** An entry's text, which may be empty, up to far past any limit memory keeps. */
function entryText(value: unknown): boolean {
  return typeof value === "string" && value.length <= 100_000;
}

function optionalEntryText(value: unknown): boolean {
  return value === undefined || entryText(value);
}

const memorySection = oneOf<MemorySection>({
  about: true,
  how: true,
  brief: true,
  knowledge: true,
});

function entryNumber(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/** A record holding no field but `kind` and these. */
function only(
  record: Record<string, unknown>,
  ...names: readonly string[]
): boolean {
  return Object.keys(record).every(
    (key) => key === "kind" || names.includes(key),
  );
}

/** A record of these fields, every one checked, and no other. */
function fieldsOf(
  value: unknown,
  checks: Readonly<Record<string, (field: unknown) => boolean>>,
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) => Object.hasOwn(checks, key)) &&
    Object.entries(checks).every(([key, check]) => check(record[key]))
  );
}

const id = (value: unknown) => text(value, 200);

/** What the person asks of memory: each kind with exactly its fields. */
const memoryRequest = byKind<MemoryRequest["kind"]>({
  switch: (request) => only(request, "on") && typeof request.on === "boolean",
  add: (request) =>
    only(request, "draft") &&
    fieldsOf(request.draft, {
      scope: id,
      section: memorySection,
      title: optionalEntryText,
      summary: optionalEntryText,
      text: entryText,
    }),
  edit: (request) =>
    only(request, "number", "edit") &&
    entryNumber(request.number) &&
    fieldsOf(request.edit, {
      title: optionalEntryText,
      summary: optionalEntryText,
      text: optionalEntryText,
    }),
  remove: (request) => only(request, "number") && entryNumber(request.number),
  move: (request) =>
    only(request, "number", "scope") &&
    entryNumber(request.number) &&
    id(request.scope),
  keep: (request) => only(request, "waitingId") && id(request.waitingId),
  discard: (request) => only(request, "waitingId") && id(request.waitingId),
  undo: (request) => only(request, "writeId") && id(request.writeId),
  createProject: (request) => only(request, "name") && id(request.name),
  projectFromConversation: (request) =>
    only(request, "taskId") && id(request.taskId),
  forgetConversation: (request) =>
    only(request, "taskId", "own", "general") &&
    id(request.taskId) &&
    (request.own === undefined || request.own === true) &&
    (request.general === undefined || request.general === true),
  renameProject: (request) =>
    only(request, "id", "name") && id(request.id) && id(request.name),
  linkFolder: (request) => only(request, "id") && id(request.id),
  unlinkFolder: (request) =>
    only(request, "id", "folder") &&
    id(request.id) &&
    text(request.folder, 4000),
  archiveProject: (request) =>
    only(request, "id", "archived") &&
    id(request.id) &&
    typeof request.archived === "boolean",
  mergeProject: (request) =>
    only(request, "from", "into") && id(request.from) && id(request.into),
  deleteProject: (request) => only(request, "id") && id(request.id),
});

/** A conversation's choice of memory: a project, none, or keeping nothing. */
function conversationMemoryChoice(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const choice = value as Record<string, unknown>;
  return (
    Object.keys(choice).every((key) =>
      ["project", "off", "linkFolder"].includes(key),
    ) &&
    (choice.project === undefined ||
      choice.project === null ||
      text(choice.project, 200)) &&
    (choice.off === undefined || typeof choice.off === "boolean") &&
    (choice.linkFolder === undefined || choice.linkFolder === true)
  );
}

/** A panel's size: whole pixels, no more than a screen holds, and nothing else. */
function browserView(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const view = value as Record<string, unknown>;
  const side = (pixels: unknown) =>
    Number.isInteger(pixels) &&
    (pixels as number) >= 1 &&
    (pixels as number) <= 16_384;
  return (
    Object.keys(view).length === 2 && side(view.width) && side(view.height)
  );
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** An intent that is its kind and nothing more. */
function nothingElse(intent: Record<string, unknown>): boolean {
  return Object.keys(intent).length === 1;
}

/**
 * The 3D view's turning and zooming arrive many times a second, so each is
 * checked as data: finite numbers within what a drag or a window could give.
 */
const sceneIntent = byKind<SceneIntent["kind"]>({
  view: (intent) => fields(intent) === 2 && sceneView(intent.view),
  turn: (intent) =>
    fields(intent) === 3 &&
    within(intent.yaw, 3600) &&
    within(intent.pitch, 3600),
  zoom: (intent) =>
    fields(intent) === 2 && within(intent.factor, 100) && intent.factor > 0,
  reset: nothingElse,
  size: (intent) =>
    fields(intent) === 3 &&
    within(intent.width, 16_384) &&
    within(intent.height, 16_384) &&
    intent.width >= 1 &&
    intent.height >= 1,
});

function fields(intent: Record<string, unknown>): number {
  return Object.keys(intent).length;
}

function within(value: unknown, limit: number): value is number {
  return finite(value) && Math.abs(value) <= limit;
}

/**
 * An argument left out at the end arrives as `undefined` rather than absent, so
 * an optional one counts as given only when it carries something. A gap in the
 * middle is not an argument left out and is left where it is.
 */
function asGiven(args: readonly unknown[]): readonly unknown[] {
  let end = args.length;
  while (end > 0 && args[end - 1] === undefined) end -= 1;
  return args.slice(0, end);
}

/**
 * Whether a command's arguments have the shape its channel allows. Everything
 * that crosses from the window is untrusted data until it passes here.
 */
export function validateCommand(
  channel: string,
  sent: readonly unknown[],
): void {
  if (!isCommandChannel(channel)) throw invalidRequest();
  const args = asGiven(sent);
  let valid: boolean;
  switch (channel) {
    case CHANNEL.frontendReady:
    case CHANNEL.openDataFolder:
    case CHANNEL.openMemoryFolder:
    case CHANNEL.createTask:
    case CHANNEL.listProviders:
    case CHANNEL.chooseWorkspace:
    case CHANNEL.selectNothing:
    case CHANNEL.shellAvailability:
    case CHANNEL.recheckShell:
    case CHANNEL.refreshConnections:
    case CHANNEL.modelList:
    case CHANNEL.checkModelList:
    case CHANNEL.appUpdate:
    case CHANNEL.checkForAppUpdate:
    case CHANNEL.restartToUpdate:
      valid = args.length === 0;
      break;
    case CHANNEL.setModelListUpdates:
    case CHANNEL.setAppUpdateChecks:
      valid = args.length === 1 && typeof args[0] === "boolean";
      break;
    case CHANNEL.openExternalUrl:
      valid =
        args.length === 1 &&
        (ALLOWED_EXTERNAL_URLS as readonly unknown[]).includes(args[0]);
      break;
    case CHANNEL.openAnswerLink:
      valid = args.length === 1 && isAnswerLink(args[0]);
      break;
    // One identifier the application itself issued — a task, a server, or a
    // stored picture. Well-formedness is all that can be decided here; each
    // store refuses any name it did not hand out.
    case CHANNEL.selectTask:
    case CHANNEL.openTask:
    case CHANNEL.resendTask:
    case CHANNEL.deleteTask:
    case CHANNEL.interruptTask:
    case CHANNEL.answerNow:
    case CHANNEL.sendNow:
    case CHANNEL.runningCommands:
    case CHANNEL.readPicture:
    case CHANNEL.componentContent:
    case CHANNEL.resetComponent:
    case CHANNEL.installToolchain:
    case CHANNEL.cancelToolchainInstall:
    case CHANNEL.closeDocument:
      valid = args.length === 1 && text(args[0]);
      break;
    // An issue's words, and the conversation it is about when it is.
    case CHANNEL.dismissIssue:
      valid =
        (args.length === 1 || args.length === 2) &&
        text(args[0]) &&
        (args[1] === undefined || text(args[1]));
      break;
    // A model id, and the upstream slugs routing may use. Both are provider
    // names rather than application identifiers, so the shape is all that can
    // be decided here; the provider refuses anything it does not serve.
    case CHANNEL.clearProviderApiKey:
    case CHANNEL.listModels:
      valid = withTarget(args, 0);
      break;
    case CHANNEL.listModelProviders:
      valid = withTarget(args, 1) && text(args[0], 200);
      break;
    case CHANNEL.selectModel:
      valid =
        withTarget(args, 2) &&
        text(args[0], 200) &&
        Array.isArray(args[1]) &&
        args[1].length <= 64 &&
        args[1].every((slug) => text(slug, 200));
      break;
    // A path, but the core still checks it is one the person already chose in
    // a dialog. Well-formedness is all that can be decided here.
    case CHANNEL.useRecentWorkspace:
    case CHANNEL.showInFolder:
      valid = args.length === 1 && text(args[0], 4000);
      break;
    // A task and a path or an identifier. A workspace path is held to the
    // conversation's folder by the core.
    case CHANNEL.previewArtifact:
    case CHANNEL.exportArtifact:
    case CHANNEL.previewRewind:
    case CHANNEL.previewUndo:
    case CHANNEL.commitUndo:
    case CHANNEL.takeBackMessage:
    case CHANNEL.openDocument:
    case CHANNEL.showDocumentInFolder:
      valid = args.length === 2 && text(args[0]) && text(args[1], 4000);
      break;
    // A task, a path, and the page a citation names, counting from 1.
    case CHANNEL.showDocument:
      valid =
        (args.length === 2 || args.length === 3) &&
        text(args[0]) &&
        text(args[1], 4000) &&
        (args.length === 2 ||
          (Number.isInteger(args[2]) && (args[2] as number) >= 1));
      break;
    case CHANNEL.chooseWorkspaceView:
      // What the 3D view shows is named only with the 3D view.
      valid =
        text(args[0]) &&
        workspaceView(args[1]) &&
        (args.length === 2 ||
          (args.length === 3 && args[1] === "3d" && threeDContent(args[2])));
      break;
    // A conversation and the number of the build whose mesh is asked for.
    case CHANNEL.partModel:
      valid =
        args.length === 2 &&
        text(args[0]) &&
        Number.isInteger(args[1]) &&
        (args[1] as number) >= 1;
      break;
    // A page counts from 1; the width is device pixels, at most what a page
    // is ever drawn at.
    case CHANNEL.drawDocumentPage:
      valid =
        args.length === 4 &&
        text(args[0]) &&
        text(args[1], 128) &&
        Number.isInteger(args[2]) &&
        (args[2] as number) >= 1 &&
        Number.isInteger(args[3]) &&
        (args[3] as number) >= 1 &&
        (args[3] as number) <= 8192;
      break;
    // A task, the message that opened a turn, and a path the turn changed.
    case CHANNEL.compareDocument:
      valid =
        args.length === 3 &&
        text(args[0]) &&
        text(args[1]) &&
        text(args[2], 4000);
      break;
    case CHANNEL.commitRewind:
      valid =
        args.length === 3 &&
        text(args[0]) &&
        text(args[1], 4000) &&
        rewoundFiles(args[2]);
      break;
    case CHANNEL.exportConversation:
      valid = args.length === 2 && text(args[0]) && exportFormat(args[1]);
      break;
    case CHANNEL.exportView:
      valid =
        args.length === 3 &&
        text(args[0]) &&
        text(args[1], 128) &&
        text(args[2], maximumSavedViewLength);
      break;
    // Words, pastes kept beforehand, or both; never nothing. The reasoning
    // choice may be left out before the pastes.
    case CHANNEL.sendMessage: {
      const [taskId, message, reasoning, pastes = [], delivery] = args;
      valid =
        args.length >= 2 &&
        args.length <= 5 &&
        (delivery === undefined || delivery === "guidance") &&
        text(taskId) &&
        (reasoning === undefined || reasoningSelection(reasoning)) &&
        Array.isArray(pastes) &&
        pastes.length <= 20 &&
        pastes.every((id) => text(id, 100)) &&
        (text(message, longestTypedMessage) ||
          (message === "" && pastes.length > 0));
      break;
    }
    // The text itself: the store refuses more than 50 MB of it, and no string
    // longer than that in characters can be less in bytes.
    case CHANNEL.keepPaste:
      valid = args.length === 1 && text(args[0], 50 * 1024 * 1024);
      break;
    case CHANNEL.keepPicture:
      valid = args.length === 1 && pictureToKeep(args[0]);
      break;
    case CHANNEL.openAttachment:
      valid =
        args.length === 2 &&
        (args[0] === null || text(args[0])) &&
        text(args[1], 100);
      break;
    case CHANNEL.setContextBudget:
      valid = args.length === 2 && text(args[0]) && budget(args[1]);
      break;
    case CHANNEL.setDefaultContextBudget:
      valid = args.length === 1 && budget(args[0]);
      break;
    case CHANNEL.memory:
      valid = args.length === 0;
      break;
    case CHANNEL.changeMemory:
      valid = args.length === 1 && memoryRequest(args[0]);
      break;
    case CHANNEL.setConversationMemory:
      valid =
        args.length === 2 && text(args[0]) && conversationMemoryChoice(args[1]);
      break;
    case CHANNEL.setNotifications:
    case CHANNEL.setStudioReviews:
    case CHANNEL.dimWindowControls:
      valid = args.length === 1 && typeof args[0] === "boolean";
      break;
    case CHANNEL.setReviewerModel:
      valid =
        args.length === 1 &&
        (args[0] === null || isReviewerModelChoice(args[0]));
      break;
    case CHANNEL.reviewerModelSettings:
      valid = args.length === 0;
      break;
    case CHANNEL.setWorkPauses:
      valid = args.length === 1 && isWorkPauses(args[0]);
      break;
    case CHANNEL.setAppearance:
      valid = args.length === 1 && appearance(args[0]);
      break;
    case CHANNEL.setLook:
      valid = args.length === 1 && isLookChoice(args[0]);
      break;
    case CHANNEL.setSpelling:
      valid = args.length === 1 && spellingChoice(args[0]);
      break;
    case CHANNEL.condenseNow:
      valid = args.length === 1 && text(args[0]);
      break;
    case CHANNEL.renameTask:
      valid = args.length === 2 && text(args[0]) && text(args[1], 160);
      break;
    case CHANNEL.answerViewCheck:
      valid = args.length === 2 && text(args[0], 128) && outcome(args[1]);
      break;
    case CHANNEL.resolveApproval:
      valid =
        (args.length === 3 || args.length === 4) &&
        text(args[0]) &&
        text(args[1]) &&
        approvalDecision(args[2]) &&
        (args.length === 3 || (args[2] === "deny" && text(args[3], 2_000)));
      break;
    case CHANNEL.revokeConversationPermission:
    case CHANNEL.commandOutput:
    case CHANNEL.stopCommand:
      valid = args.length === 2 && text(args[0]) && text(args[1]);
      break;
    case CHANNEL.resolveUserInput:
      valid =
        args.length === 3 &&
        text(args[0]) &&
        text(args[1]) &&
        userInputResponse(args[2]);
      break;
    case CHANNEL.setPluginEnabled:
    case CHANNEL.setComponentEnabled:
      valid =
        args.length === 2 && text(args[0]) && typeof args[1] === "boolean";
      break;
    case CHANNEL.installPlugin:
      valid = args.length === 0;
      break;
    case CHANNEL.updatePlugin:
    case CHANNEL.rollbackPlugin:
    case CHANNEL.removePlugin:
      valid = args.length === 1 && text(args[0]);
      break;
    case CHANNEL.createPlugin:
      valid = args.length === 2 && text(args[0], 160) && text(args[1], 4000);
      break;
    case CHANNEL.savePluginContents:
      valid =
        args.length === 2 && text(args[0]) && authoredPluginContents(args[1]);
      break;
    case CHANNEL.overrideComponent:
      valid =
        args.length === 2 && text(args[0]) && componentContentDraft(args[1]);
      break;
    case CHANNEL.editablePluginContents:
      valid = args.length === 1 && text(args[0]);
      break;
    case CHANNEL.setMcpServerToolEnabled:
      valid =
        args.length === 3 &&
        text(args[0]) &&
        text(args[1]) &&
        typeof args[2] === "boolean";
      break;
    case CHANNEL.setMcpServerToolTreatment:
      valid =
        args.length === 4 &&
        text(args[0]) &&
        text(args[1]) &&
        isConnectionToolTreatment(args[2]) &&
        text(args[3]);
      break;
    case CHANNEL.testMcpConnection:
      valid =
        args.length >= 1 &&
        args.length <= 2 &&
        connectionDefinition(args[0]) &&
        (args.length === 1 || text(args[1], 4096));
      break;
    case CHANNEL.checkMcpConnection:
      valid = args.length === 1 && text(args[0]);
      break;
    case CHANNEL.saveMcpServerToken:
      valid = args.length === 2 && text(args[0]) && text(args[1], 4096);
      break;
    case CHANNEL.clearMcpServerToken:
    case CHANNEL.signInToMcpServer:
    case CHANNEL.cancelMcpSignIn:
      valid = args.length === 1 && text(args[0]);
      break;
    case CHANNEL.driveBrowser:
      valid = args.length === 1 && browserIntent(args[0]);
      break;
    case CHANNEL.watchBrowser:
      valid =
        args.length === 2 &&
        text(args[0]) &&
        (args[1] === null || browserView(args[1]));
      break;
    case CHANNEL.lookAtScene:
      valid = args.length === 1 && sceneIntent(args[0]);
      break;
    case CHANNEL.saveProviderApiKey:
      valid = withTarget(args, 1) && text(args[0], 4096);
      break;
    case CHANNEL.configureProfile:
      valid =
        args.length === 1 &&
        Array.isArray(args[0]) &&
        args[0].length <= 32 &&
        args[0].every(pluginName);
      break;
    case CHANNEL.recoverHistory:
      valid = args.length === 1 && recoveryChoice(args[0]);
      break;
    case CHANNEL.settleSavedConversations:
      valid = args.length === 1 && savedConversationsChoice(args[0]);
      break;
    default: {
      // Every command's channel has its case above, or this does not compile.
      const unnamed: never = channel;
      throw new Error(`No shape is written for ${String(unnamed)}.`);
    }
  }
  if (!valid) throw invalidRequest();
}

type CommandChannel = (typeof COMMAND_CHANNELS)[CommandName];

const commandChannels: ReadonlySet<string> = new Set(
  Object.values(COMMAND_CHANNELS),
);

/** A channel a command travels on; anything else is refused unread. */
function isCommandChannel(channel: string): channel is CommandChannel {
  return commandChannels.has(channel);
}

function invalidRequest(): Error {
  return new Error("This request is invalid. Reopen the page and try again.");
}
