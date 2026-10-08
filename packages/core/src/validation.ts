import {
  ALLOWED_EXTERNAL_URLS,
  attachablePictureTypes,
  CHANNEL,
  REASONING_EFFORTS,
  typedMessageCharacters,
} from "@zhiyin/contract";

function budget(value: unknown): boolean {
  return value === "low" || value === "medium" || value === "ultra";
}

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
  return text(value, 128) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function authoredSkillDraft(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    text(item.id, 128) &&
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
    text(item.instructions, 64_000)
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
    item.mcpServers.every(authoredMcpServerDraft)
  );
}

/**
 * A view check answer. The failure reason is bounded like any other text that
 * crosses the bridge: it reaches a repair prompt, and an unbounded string from
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

/**
 * A page can put anything on screen, so what comes back from the panel is
 * checked as data rather than trusted as a shape. An address is bounded; a
 * coordinate is a finite number; text is capped at what a person could paste.
 */
function browserIntent(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const intent = value as Record<string, unknown>;
  const finite = (key: string) =>
    typeof intent[key] === "number" && Number.isFinite(intent[key]);
  switch (intent["kind"]) {
    case "open":
      return intent["url"] === undefined || text(intent["url"], 4000);
    case "close":
    case "back":
    case "forward":
    case "reload":
      return Object.keys(intent).length === 1;
    case "navigate":
      return text(intent["url"], 4000);
    case "click":
      return finite("x") && finite("y");
    case "scroll":
      return finite("x") && finite("y") && finite("deltaY");
    case "type":
      return text(intent["text"], 10_000);
    case "key":
      return text(intent["key"], 32);
    default:
      return false;
  }
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
  const args = asGiven(sent);
  let valid = false;
  switch (channel) {
    case CHANNEL.frontendReady:
    case CHANNEL.openDataFolder:
    case CHANNEL.createTask:
    case CHANNEL.clearProviderApiKey:
    case CHANNEL.listModels:
    case CHANNEL.chooseWorkspace:
    case CHANNEL.selectNothing:
    case CHANNEL.shellAvailability:
    case CHANNEL.recheckShell:
    case CHANNEL.refreshConnections:
      valid = args.length === 0;
      break;
    case CHANNEL.openExternalUrl:
      valid =
        args.length === 1 &&
        (ALLOWED_EXTERNAL_URLS as readonly unknown[]).includes(args[0]);
      break;
    // One identifier the application itself issued — a task, a server, or a
    // stored picture. Well-formedness is all that can be decided here; each
    // store refuses any name it did not hand out.
    case CHANNEL.selectTask:
    case CHANNEL.resendTask:
    case CHANNEL.deleteTask:
    case CHANNEL.dismissIssue:
    case CHANNEL.interruptTask:
    case CHANNEL.runningCommands:
    case CHANNEL.readPicture:
    case CHANNEL.componentContent:
    case CHANNEL.resetComponent:
    case CHANNEL.installToolchain:
    case CHANNEL.closeDocument:
      valid = args.length === 1 && text(args[0]);
      break;
    // A model id, and the upstream slugs routing may use. Both are provider
    // names rather than application identifiers, so the shape is all that can
    // be decided here; the provider refuses anything it does not serve.
    case CHANNEL.listModelProviders:
      valid = args.length === 1 && text(args[0], 200);
      break;
    case CHANNEL.selectModel:
      valid =
        args.length === 2 &&
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
      valid =
        args.length === 2 &&
        text(args[0]) &&
        ["conversation", "browser", "document"].includes(args[1] as string);
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
        (args[2] === "keep" || args[2] === "restore");
      break;
    case CHANNEL.exportConversation:
      valid =
        args.length === 2 &&
        text(args[0]) &&
        (args[1] === "html" || args[1] === "json");
      break;
    case CHANNEL.exportView:
      valid =
        args.length === 3 &&
        text(args[0]) &&
        text(args[1], 128) &&
        text(args[2], 2_000_000);
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
        (text(message, typedMessageCharacters) ||
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
    case CHANNEL.setPersonalInstructions:
      // Empty clears them. Longer than the 16 KB sent, so the person is told
      // it was shortened rather than refused; far past it is not an edit.
      valid =
        args.length === 1 &&
        typeof args[0] === "string" &&
        args[0].length <= 64_000;
      break;
    case CHANNEL.setNotifications:
      valid = args.length === 1 && typeof args[0] === "boolean";
      break;
    case CHANNEL.setAppearance:
      valid =
        args.length === 1 &&
        (args[0] === "system" || args[0] === "light" || args[0] === "dark");
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
        (args[2] === "allow" ||
          args[2] === "allow-conversation" ||
          args[2] === "deny") &&
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
    case CHANNEL.saveProviderApiKey:
      valid = args.length === 1 && text(args[0], 4096);
      break;
    case CHANNEL.configureProfile:
      valid =
        args.length === 1 &&
        Array.isArray(args[0]) &&
        args[0].length <= 32 &&
        args[0].every(pluginName);
      break;
    case CHANNEL.recoverHistory:
      valid =
        args.length === 1 &&
        (args[0] === "recover" || args[0] === "startFresh");
      break;
    case CHANNEL.settleSavedConversations:
      valid =
        args.length === 1 && (args[0] === "update" || args[0] === "recycle");
      break;
  }
  if (!valid)
    throw new Error("This request is invalid. Reopen the page and try again.");
}
