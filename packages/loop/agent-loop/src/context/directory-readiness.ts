/**
 * The plugin directory's marks, held as a conversation started with them
 * (ADR 0016): what each connector needs and which built-in plugins are
 * switched off. The person setting a connector up, or switching a plugin on,
 * leaves the start of the conversation's requests as it was; the model is
 * told in a `readiness` notice instead, once, and again only when a
 * condensing took that notice away or the marks changed again.
 */

import type {
  ConnectorNeed,
  DirectoryReadiness,
  PluginDirectoryEntry,
  PluginReadiness,
} from "@zhiyin/contract";
import { sameValue } from "../canonical.js";
import { harnessNotice } from "../turn/notices.js";
import type { TurnRecords } from "../turn/turn-records.js";
import type { ModelHistory } from "./model-history.js";

type Directory = readonly PluginDirectoryEntry[];

function marksOf(entry: PluginDirectoryEntry): PluginReadiness {
  return {
    ...(entry.needs ? { needs: entry.needs } : {}),
    ...(entry.switchedOff ? { switchedOff: true as const } : {}),
  };
}

/**
 * The directory as the conversation's requests start with it: each plugin
 * it was first sent with keeps the marks it had then, and a plugin listed
 * since has its own.
 */
export function directoryAsSent(
  directory: Directory,
  sent: DirectoryReadiness | undefined,
): Directory {
  if (!sent) return directory;
  return directory.map((entry) => {
    const marks = sent[entry.id];
    if (!marks) return entry;
    // Rebuilt in the directory's own order, so its bytes stay the same.
    const rest = { ...entry };
    delete (rest as { needs?: unknown }).needs;
    delete (rest as { switchedOff?: unknown }).switchedOff;
    return { ...rest, ...marks };
  });
}

/**
 * The marks the conversation's requests start with, kept with it: those it
 * was first sent, and the current marks of each plugin listed since.
 */
export async function keepReadiness(
  records: TurnRecords,
  taskId: string,
  directory: Directory,
): Promise<DirectoryReadiness> {
  const sent = records.task(taskId).readinessSent ?? {};
  const added = directory.filter((entry) => !(entry.id in sent));
  if (!added.length) return sent;
  const kept: DirectoryReadiness = {
    ...sent,
    ...Object.fromEntries(added.map((entry) => [entry.id, marksOf(entry)])),
  };
  await records.replaceTask({ ...records.task(taskId), readinessSent: kept });
  return kept;
}

const needWords: Record<ConnectorNeed, string> = {
  key: "needs its key",
  "sign-in": "needs a sign-in",
  install: "needs a program installed",
  "could-not-start": "could not start and needs checking",
  "switched-off": "is switched off",
};

/** One plugin's marks now, said where they differ from what was sent. */
function changeOf(
  entry: PluginDirectoryEntry,
  sent: PluginReadiness,
): string | undefined {
  const now = marksOf(entry);
  if (sameValue(now, sent)) return undefined;
  const parts: string[] = [];
  if (!!now.switchedOff !== !!sent.switchedOff)
    parts.push(now.switchedOff ? "switched off" : "switched on");
  const ids = [
    ...new Set([
      ...Object.keys(sent.needs ?? {}),
      ...Object.keys(now.needs ?? {}),
    ]),
  ];
  for (const id of ids) {
    const need = now.needs?.[id];
    if (need === sent.needs?.[id]) continue;
    parts.push(need ? `${id} ${needWords[need]}` : `${id} needs nothing now`);
  }
  return `- ${entry.id}: ${parts.join("; ")}.`;
}

/**
 * Tells the model what the person set up or switched since the directory
 * was sent: once, unless the last notice it was told says the same, and
 * again after a condensing took that notice away.
 */
export async function noteReadiness(
  history: ModelHistory,
  directory: Directory,
  sent: DirectoryReadiness | undefined,
): Promise<void> {
  if (!sent) return;
  const changes = directory.flatMap((entry) => {
    const marks = sent[entry.id];
    const change = marks && changeOf(entry, marks);
    return change ? [change] : [];
  });
  const latest = history.latestNotice("readiness");
  if (!changes.length && !latest) return;
  const text = changes.length
    ? [
        "What these plugins and their connectors need has changed since the plugin directory was sent. This holds in place of the directory's marks for them:",
        ...changes,
      ].join("\n")
    : "Every plugin and connector is again as the plugin directory marks it.";
  if (latest === harnessNotice("readiness", text)) return;
  await history.notice("readiness", text);
}
