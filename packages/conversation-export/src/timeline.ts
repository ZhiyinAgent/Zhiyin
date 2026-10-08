import {
  diffLines,
  type ActionDetail,
  type CommandFileChanges,
  type FileChange,
  type TaskAction,
  type TaskMessage,
  type WorkspaceTask,
} from "@zhiyin/contract";
import { escapeHtml, laidOut } from "./html.js";

/**
 * The conversation as it happened, one entry per message, action or event, in
 * the order of their places on the timeline. An action opens to show what it
 * was asked, who let it run, what it changed and what it answered.
 */
export function timeline(task: WorkspaceTask): string {
  const entries: { readonly sequence: number; readonly html: string }[] = [
    ...task.messages.map((message) => ({
      sequence: message.sequence,
      html: messageEntry(message),
    })),
    ...task.actions.map((action) => ({
      sequence: action.sequence,
      html: actionEntry(action),
    })),
    ...task.views.map((view) => ({
      sequence: view.sequence,
      html: event(`Drew a ${view.kind.replaceAll("-", " ")}: ${view.title}`),
    })),
    ...task.interactions.map((interaction) => ({
      sequence: interaction.sequence,
      html: event(
        `Asked “${interaction.request.title}”, answered ${String(interaction.response.answers.length)} of ${String(interaction.request.questions.length)}`,
      ),
    })),
    ...task.specialistRuns.map((run) => ({
      sequence: run.sequence,
      html: event(`Handed to ${run.specialist.name}: ${run.task}`),
    })),
    ...task.condensings.map((condensing) => ({
      sequence: condensing.sequence,
      condensing: true,
      html: event("Earlier messages were condensed to fit the model's window."),
    })),
  ];
  // A condensing comes before what shares its place, sent while it ran.
  return entries
    .sort(
      (first, second) =>
        first.sequence - second.sequence ||
        Number("condensing" in second) - Number("condensing" in first),
    )
    .map((entry) => entry.html)
    .join("\n");
}

function event(text: string): string {
  return `<li class="event">${escapeHtml(text)}</li>`;
}

function messageEntry(message: TaskMessage): string {
  const attachments = message.attachments?.length
    ? `<ul class="attachments">${message.attachments
        .map((attachment) =>
          attachment.kind === "picture"
            ? `<li>Picture: ${escapeHtml(attachment.name)}</li>`
            : `<li>Pasted text, ${String(attachment.lines)} lines</li>`,
        )
        .join("")}</ul>`
    : "";
  return `<li class="message ${message.role}"><p class="who">${message.role === "user" ? "You" : "Zhiyin"}</p><div class="text">${escapeHtml(message.text)}</div>${attachments}</li>`;
}

const statusWords: Record<
  TaskAction["status"],
  readonly [string, "done" | "stopped" | "failed"]
> = {
  completed: ["Done", "done"],
  reported: ["Done", "done"],
  running: ["Unfinished", "stopped"],
  cancelled: ["Stopped", "stopped"],
  failed: ["Failed", "failed"],
  denied: ["Declined", "failed"],
  blocked: ["Blocked", "failed"],
};

/** Whether the action ran to its end, so what it would change was changed. */
export function madeItsChanges(action: TaskAction): boolean {
  return action.status === "completed" || action.status === "reported";
}

function approvalWords(action: TaskAction): string {
  const approval = action.approval;
  if (!approval) return "";
  if (approval.by === "you")
    return action.status === "denied" ? "Declined by you" : "Approved by you";
  if (approval.by === "conversation-permission")
    return `Allowed by the conversation permission “${approval.label ?? "unnamed"}”`;
  if (approval.by === "no-approval-needed") return "No approval needed";
  return approval.reason ? `Blocked: ${approval.reason}` : "Blocked";
}

function actionEntry(action: TaskAction): string {
  const [status, tone] = statusWords[action.status];
  const summary = [
    `<span class="status ${tone}">${status}</span>`,
    `<span class="title">${escapeHtml(action.action)}</span>`,
    action.target && action.target !== action.command
      ? `<span class="target">${escapeHtml(action.target)}</span>`
      : "",
    `<span class="approval">${escapeHtml(approvalWords(action))}</span>`,
  ].join("");
  const body = [
    action.claim
      ? `<p class="claim">The model said: ${escapeHtml(action.claim)}</p>`
      : "",
    action.description ? `<p>${escapeHtml(action.description)}</p>` : "",
    action.detail ? `<p>${escapeHtml(action.detail)}</p>` : "",
    action.command
      ? `<h3>Command</h3><pre>${escapeHtml(action.command)}</pre>`
      : "",
    action.invocation ? invocationPart(action.invocation) : "",
    action.changes?.length
      ? action.changes
          .map((change) => changePart(change, madeItsChanges(action)))
          .join("")
      : "",
    action.commandChanges ? commandChangesPart(action.commandChanges) : "",
    action.details?.length
      ? action.details.map(detailPart).join("")
      : action.evidence
        ? `<h3>Answer</h3><pre>${escapeHtml(action.evidence)}</pre>`
        : "",
    action.reason ? `<p>${escapeHtml(action.reason)}</p>` : "",
  ].join("");
  return `<li class="action"><details><summary>${summary}</summary><div class="body">${body}</div></details></li>`;
}

function invocationPart(invocation: NonNullable<TaskAction["invocation"]>) {
  const through = invocation.via
    ? `<p class="quiet">Sent through ${escapeHtml(invocation.via)}</p>`
    : "";
  const values = invocation.arguments
    .map(
      (argument) =>
        `<dt>${escapeHtml(argument.name)}</dt><dd><pre>${escapeHtml(laidOut(argument.value))}</pre></dd>`,
    )
    .join("");
  return `${through}${values ? `<dl class="facts">${values}</dl>` : ""}`;
}

const changeWords: Record<FileChange["change"], string> = {
  created: "created",
  updated: "changed",
  recycled: "moved to the Recycle Bin",
  deleted: "deleted",
};

function changePart(change: FileChange, made: boolean): string {
  const heading = `<h3>${escapeHtml(change.path)} · ${made ? changeWords[change.change] : "proposed, not made"}</h3>`;
  if (change.change === "recycled" || change.change === "deleted")
    return heading;
  if (change.after === undefined)
    return `${heading}<p>${escapeHtml(change.omitted ?? "Too large to include.")}</p>`;
  const lines = diffLines(change.before ?? "", change.after).sections.map(
    (section) =>
      section.kind === "skipped"
        ? `<span class="skipped">… ${String(section.count)} unchanged lines</span>`
        : section.lines
            .map((line) =>
              line.kind === "same"
                ? `<span>  ${escapeHtml(line.text)}</span>`
                : `<span class="${line.kind}">${line.kind === "added" ? "+" : "-"} ${escapeHtml(line.text)}</span>`,
            )
            .join(""),
  );
  return `${heading}<pre class="diff">${lines.join("")}</pre>`;
}

function commandChangesPart(changes: CommandFileChanges): string {
  if (changes.status !== "checked") return "";
  if (!changes.files.length) return "";
  const more = changes.more ? `<li>and ${String(changes.more)} more</li>` : "";
  return `<h3>Files changed while it ran</h3><ul>${changes.files
    .map(
      (file) =>
        `<li>${escapeHtml(file.path)} · ${changeWords[file.change]}</li>`,
    )
    .join("")}${more}</ul>`;
}

function detailPart(detail: ActionDetail): string {
  if (detail.kind === "text")
    return `<h3>${escapeHtml(detail.label)}${detail.truncated ? " (shortened)" : ""}</h3><pre>${escapeHtml(detail.text)}</pre>`;
  if (detail.kind === "facts")
    return `<dl class="facts">${detail.items
      .map(
        (item) =>
          `<dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd>`,
      )
      .join("")}</dl>`;
  if (detail.kind === "matches")
    return `<pre>${detail.items
      .map((item) =>
        escapeHtml(`${item.path}:${String(item.line)}  ${item.text}`),
      )
      .join(
        "\n",
      )}</pre>${detail.note ? `<p>${escapeHtml(detail.note)}</p>` : ""}`;
  if (detail.kind === "list")
    return `<h3>${escapeHtml(detail.label)}</h3><ul>${detail.items
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("")}</ul>`;
  return `<p>Picture: ${escapeHtml(detail.alt)} (not included)</p>`;
}
