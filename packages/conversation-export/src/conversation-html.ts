import { withoutCredentials, type WorkspaceTask } from "@zhiyin/contract";
import { leftOut, type ExportAbout } from "./about.js";
import { escapeHtml } from "./html.js";
import { pageStyle } from "./page-style.js";
import { madeItsChanges, timeline } from "./timeline.js";

/**
 * The conversation as one page a person reads: offline, with no scripts and
 * nothing fetched from anywhere, so it opens the same in any browser and runs
 * nothing that was in the conversation.
 */
export function conversationHtml(
  task: WorkspaceTask,
  about: ExportAbout,
): string {
  const shown = withoutCredentials(task) as WorkspaceTask;
  const exported = `${about.exportedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(shown.title)} · Zhiyin conversation</title>
<style>${pageStyle}</style>
</head>
<body>
<main>
<header>
<p class="kicker">Zhiyin conversation</p>
<h1>${escapeHtml(shown.title)}</h1>
<p class="meta">Exported ${exported} from Zhiyin ${escapeHtml(about.appVersion)}</p>
${summary(shown)}
<p class="notice">Known credential formats were removed. This file is a copy: Zhiyin cannot delete it.</p>
</header>
<ol class="timeline">
${timeline(shown)}
</ol>
<footer>
<h2>Left out of this file</h2>
<ul>${leftOut.html.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
</footer>
</main>
</body>
</html>
`;
}

function summary(task: WorkspaceTask): string {
  const files = new Set(
    task.actions
      .filter(madeItsChanges)
      .flatMap((action) => (action.changes ?? []).map((change) => change.path)),
  );
  const costs = task.modelResponses.flatMap((response) =>
    response.usage?.costUsd === undefined ? [] : [response.usage.costUsd],
  );
  const models = [
    ...new Set(task.modelResponses.flatMap((response) => response.model ?? [])),
  ];
  const facts: [string, string][] = [
    ["Messages", String(task.messages.length)],
    ["Actions", String(task.actions.length)],
    ["Files changed", String(files.size)],
    ...(costs.length
      ? [
          [
            "Cost",
            `$${costs.reduce((total, cost) => total + cost, 0).toFixed(4)}`,
          ] as [string, string],
        ]
      : []),
    ...(models.length
      ? [["Model", models.join(", ")] as [string, string]]
      : []),
  ];
  return `<dl class="summary">${facts
    .map(
      ([label, value]) =>
        `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
    )
    .join("")}</dl>`;
}
