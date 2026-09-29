/**
 * The one channel through which Zhiyin speaks to the model, and the fence
 * around what tools return.
 *
 * The model has to tell three voices apart: the person's, Zhiyin's own, and
 * whatever a tool fetched — a web page, a document, a connector's answer.
 * Zhiyin's arrives as a `zhiyin-notice` of a named kind, a tool's as a
 * `tool-output`, each marked the same way every time and explained once in
 * the system prompt. Nothing inside either can close its mark: the openings
 * and closings of both are escaped wherever they appear in the text, so a
 * fetched page cannot end its fence and pose as Zhiyin.
 *
 * A notice is sent as a `user` message at the end of the conversation, never
 * as a system message mid-conversation: upstreams merge, move or reject
 * those, and the tag, not the role, carries the meaning.
 */

/**
 * Every kind of notice, each owned by one part of Zhiyin. A new kind is a new
 * entry here, with a test that produces it.
 */
export const noticeKinds = [
  /** A condensed conversation, in place of the messages it condenses. */
  "summary",
  /** A specialist's result, arriving after it settled. */
  "handoff",
  /** The person chose Pause: report now. */
  "pause",
  /** The person chose Continue: a fresh work budget. */
  "renewal",
  /** The caption of a picture a tool produced, or the note left in its place. */
  "picture",
  /** The specialists delegated to so far, sent again when any of them changes. */
  "specialists",
  /** Zhiyin asks for the conversation so far to be summarised. */
  "condense",
  /** A tool result cleared to make room, and where it can be read again. */
  "cleared",
  /** The plan the turn is judged on, at its start and again when it goes stale. */
  "plan",
  /** The model has repeated the same action, and should change approach. */
  "loop",
  /** What the judge found missing from an item claimed done. */
  "gaps",
  /** The person's standing instructions, sent again when they change. */
  "instructions",
  /** A person's message added while the current turn was working. */
  "guidance",
  /** A provider interruption after completed tools; resume from their results. */
  "recovery",
] as const;

export type NoticeKind = (typeof noticeKinds)[number];

/** Anything that would open or close either mark, made inert. */
function inert(text: string): string {
  return text.replace(/<(\/?)(zhiyin-|tool-output)/gi, "&lt;$1$2");
}

function attribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function harnessNotice(kind: NoticeKind, text: string): string {
  if (!(noticeKinds as readonly string[]).includes(kind))
    throw new Error(`No part of Zhiyin sends a "${kind}" notice.`);
  return `<zhiyin-notice kind="${kind}">${inert(text)}</zhiyin-notice>`;
}

/** What a tool returned, as data to weigh and never as instructions. */
export function toolOutput(tool: string, content: string): string {
  return `<tool-output tool="${attribute(tool)}" trust="untrusted">${inert(content)}</tool-output>`;
}
