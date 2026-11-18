import { readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  type WorkspaceTask,
  type TaskAction,
  type ToolCallInspection,
  type ToolOwner,
} from "@zhiyin/contract";
import { ranToItsEnd } from "@zhiyin/conversation-rules";
import type { ConversationFacts } from "@zhiyin/permission-engine";
import { whoseWord } from "@zhiyin/trust-rules";

type Inspection = Extract<ToolCallInspection, { readonly ok: true }>;

/**
 * What an action's record keeps of what it brought into the conversation
 * (ADR 0012): outside content, and something private from beyond the
 * workspace, by its effects. A connection Zhiyin does not ship is taken to
 * bring both, since nothing it says of itself counts, and so is a call that
 * declares no effects, as the worst it could do.
 */
export function conversationMarks(
  owner: ToolOwner,
  inspection: Inspection,
): Pick<TaskAction, "brings" | "reachesPrivate"> {
  const effects = inspection.effects;
  if (whoseWord(owner, inspection) === "nothing" || !effects)
    return { brings: "outside", reachesPrivate: true };
  const outside = effects.brings === "outside";
  const elsewhere =
    effects.reads === "elsewhere" || effects.reads === "account";
  return {
    ...(outside ? { brings: "outside" as const } : {}),
    ...(elsewhere ? { reachesPrivate: true as const } : {}),
  };
}

/**
 * Whether what an action brought may have reached the model: it began
 * running, so its answer, a failure's too, went back to the model.
 */
function reachedTheModel(action: TaskAction): boolean {
  return action.startedAt !== undefined || ranToItsEnd(action);
}

/** The most entries looked at to find a file of the person's; past it, one is assumed. */
const lookLimit = 5000;

/**
 * Whether the folder holds a file this conversation did not make, looked for
 * file by file and stopped at the first. A folder too large to look through
 * is taken to hold one.
 */
async function holdsPersonsFile(
  root: string,
  made: ReadonlySet<string>,
): Promise<boolean> {
  let looked = 0;
  const pending = [root];
  while (pending.length) {
    const folder = pending.pop()!;
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const entry of entries) {
      looked += 1;
      if (looked > lookLimit) return true;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      const named = relative(root, path).split(sep).join("/").toLowerCase();
      if (!made.has(named)) return true;
    }
  }
  return false;
}

/** The workspace files this conversation created, by their path in it, in lower case. */
function madeHere(task: WorkspaceTask): Set<string> {
  const made = new Set<string>();
  const add = (path: string) =>
    made.add(path.replaceAll("\\", "/").toLowerCase());
  for (const action of task.actions) {
    for (const change of action.changes ?? [])
      if (change.change === "created") add(change.path);
    if (action.commandChanges?.status === "checked")
      for (const change of action.commandChanges.files)
        if (change.change === "created") add(change.path);
  }
  return made;
}

/**
 * What the conversation holds that bears on a send, worked out from its own
 * record, so going back past an action takes back what it brought.
 */
export async function conversationFacts(
  task: WorkspaceTask,
  workspaceRoot: string | undefined,
): Promise<ConversationFacts> {
  const ran = task.actions.filter(reachedTheModel);
  // What memory sent at the start held, as the entries it sent did.
  const memory = task.memorySent?.held;
  const outsideContent =
    memory?.outside === true ||
    ran.some((action) => action.brings === "outside");
  let personsFolder = false;
  if (workspaceRoot) {
    const root = await realpath(resolve(workspaceRoot)).catch(() => undefined);
    personsFolder = root ? await holdsPersonsFile(root, madeHere(task)) : true;
  }
  const privateWithinReach =
    personsFolder ||
    memory?.private === true ||
    ran.some((action) => action.reachesPrivate);
  return { outsideContent, privateWithinReach };
}

const address = /https?:\/\/[^\s"'<>\\)\]]+/g;

/** An address as a browser writes it, or as given when it is not one. */
function normal(text: string): string {
  try {
    return new URL(text).href;
  } catch {
    return text;
  }
}

/**
 * The parts of an address that can hold what the model put in it: its path,
 * its query and its fragment, decoded and in lower case. An address with none
 * of them is its site alone. One that cannot be read as an address is taken
 * whole.
 */
function carriedBy(destination: string): string[] {
  try {
    const url = new URL(destination);
    return [
      url.pathname === "/" ? "" : url.pathname,
      url.search.slice(1),
      url.hash.slice(1),
    ]
      .map(decoded)
      .filter((part) => part.length > 0);
  } catch {
    return [decoded(destination)];
  }
}

/** Text decoded where it is percent-encoded, in lower case. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text).toLowerCase();
  } catch {
    return text.toLowerCase();
  }
}

/**
 * What a call sent, as text to search: every string in its arguments,
 * unescaped from JSON and decoded, in lower case.
 */
function wordsOf(argumentsText: string): string {
  const strings: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object")
      Object.values(value).forEach(walk);
  };
  try {
    walk(JSON.parse(argumentsText));
  } catch {
    strings.push(argumentsText);
  }
  return strings.map(decoded).join("\n");
}

/** An address's site, in lower case and without a leading `www.`. */
function siteOf(address: string): string | undefined {
  try {
    const host = new URL(address).hostname.toLowerCase();
    return host.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the person named the site, in their messages, or let a visit to it
 * run when asked. Which of a page's addresses the model opens is a choice,
 * and a run of choices can spell out a little of what is private; on a site
 * the person neither named nor let through, the first such visit asks.
 */
function siteKnown(task: WorkspaceTask, address: string): boolean {
  const site = siteOf(address);
  if (!site) return false;
  const escaped = site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(
    `(?<![a-z0-9-])${escaped}(?![a-z0-9-]|\\.[a-z0-9])`,
    "i",
  );
  return (
    task.messages.some(
      (message) => message.role === "user" && named.test(message.text),
    ) ||
    task.actions.some(
      (action) =>
        ranToItsEnd(action) &&
        action.approval?.by === "you" &&
        action.effects?.destination !== undefined &&
        siteOf(action.effects.destination) === site,
    )
  );
}

/**
 * Whether an address came, whole, from somewhere other than the model, so
 * going there carries nothing it wrote:
 *
 * - the person's messages;
 * - the answer of a call that ran to its end, brought outside content and ran
 *   no code the model wrote, when the call did not hold the address itself,
 *   and the address is on a site the person named or let a visit to run:
 *   such an answer is someone else's words, not the model's repeated;
 * - an address an earlier call already sent to, which says nothing new.
 *
 * An address the model wrote, in its words, its calls or what its own code
 * printed, does not count: it could carry what the model put in it. Choosing
 * among the addresses a page offers on a known site is not asked about, and
 * can carry a little.
 */
export function addressSeen(task: WorkspaceTask, destination: string): boolean {
  const wanted = normal(destination);
  const same = (text: string) =>
    text === destination || normal(text) === wanted;
  const carried = carriedBy(wanted);
  const sent = new Map<string, string>();
  for (const entry of task.modelHistory)
    if (entry.kind === "calls")
      for (const call of entry.calls) sent.set(call.id, call.arguments);
  const byCall = new Map(
    task.actions.flatMap((action) =>
      action.callId ? [[action.callId, action] as const] : [],
    ),
  );
  const theirs = (callId: string) => {
    const action = byCall.get(callId);
    if (
      !action ||
      !ranToItsEnd(action) ||
      action.brings !== "outside" ||
      !action.effects ||
      action.effects.runs !== "none"
    )
      return false;
    // An answer that could repeat what the call held is the model's words:
    // any part of the address that can hold data, found in what it sent, in
    // whatever way it was written there.
    const given = wordsOf(sent.get(callId) ?? "");
    return !carried.some((part) => given.includes(part));
  };
  if (
    task.actions.some(
      (action) =>
        ranToItsEnd(action) &&
        action.effects?.destination !== undefined &&
        same(action.effects.destination),
    )
  )
    return true;
  const holds = (texts: readonly string[]) => {
    for (const found of texts.join("\n").matchAll(address)) {
      const trimmed = found[0].replace(/[.,;:!?]+$/, "");
      if (same(trimmed)) return true;
    }
    return false;
  };
  if (
    holds(
      task.messages
        .filter((message) => message.role === "user")
        .map((message) => message.text),
    )
  )
    return true;
  return (
    siteKnown(task, wanted) &&
    holds(
      task.modelHistory.flatMap((entry) =>
        entry.kind === "result" && theirs(entry.callId) ? [entry.content] : [],
      ),
    )
  );
}

/**
 * What brought the outside content the conversation holds, as a person
 * recognises it: the site of the last action that brought some, or its
 * target. Nothing when none came in.
 */
export function outsideSource(task: WorkspaceTask): string | undefined {
  const last = task.actions
    .filter(reachedTheModel)
    .filter((action) => action.brings === "outside")
    .at(-1);
  if (!last) return task.memorySent?.held.outside ? "memory" : undefined;
  try {
    const url = new URL(last.target);
    if (url.protocol === "http:" || url.protocol === "https:") return url.host;
  } catch {
    // Not an address: its target as the action named it.
  }
  return last.target || last.action;
}
