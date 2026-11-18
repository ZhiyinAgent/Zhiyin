/**
 * The page's whole look, inline so the file needs nothing beside it. It
 * follows the reader's light or dark setting and prints as it reads.
 */
export const pageStyle = `
:root {
  color-scheme: light dark;
  --ground: #f6f6f3;
  --card: #ffffff;
  --text: #1d1e20;
  --quiet: #5f6368;
  --line: #dcdcd6;
  --you: #e8eef9;
  --added: #e3f4e6;
  --added-text: #135c25;
  --removed: #fbe6e4;
  --removed-text: #8c1d18;
  --done: #1b7a3a;
  --stopped: #9a5b00;
  --failed: #b3261e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ground: #1b1c1e;
    --card: #232427;
    --text: #e8e8e6;
    --quiet: #a3a5a8;
    --line: #3a3b3f;
    --you: #26324a;
    --added: #1d3524;
    --added-text: #9fdcae;
    --removed: #3d2120;
    --removed-text: #f1aca6;
    --done: #7fd39a;
    --stopped: #f0b45c;
    --failed: #f28b82;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--text);
  font: 15px/1.55 "Segoe UI", system-ui, sans-serif;
}
main { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
h1 { font-size: 26px; line-height: 1.25; margin: 4px 0 6px; overflow-wrap: anywhere; }
h2 { font-size: 17px; margin: 0 0 10px; }
h3 { font-size: 14px; margin: 14px 0 6px; }
.kicker, .meta { color: var(--quiet); margin: 0; font-size: 13px; }
.summary { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 18px 0 12px; }
.summary div { min-width: 0; }
.summary dt { color: var(--quiet); font-size: 12px; }
.summary dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.notice {
  margin: 0 0 24px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--quiet);
  font-size: 13px;
}
.timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.message { padding: 12px 14px; border-radius: 10px; background: var(--card); border: 1px solid var(--line); }
.message.user { background: var(--you); border-color: transparent; }
.who { margin: 0 0 4px; font-size: 12px; font-weight: 600; color: var(--quiet); }
.text { white-space: pre-wrap; overflow-wrap: anywhere; }
.attachments { margin: 8px 0 0; padding-left: 18px; color: var(--quiet); font-size: 13px; }
.event { padding: 6px 14px; color: var(--quiet); font-size: 13px; }
.action { background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
.action summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  padding: 10px 14px;
  cursor: pointer;
  list-style: none;
}
.action summary::-webkit-details-marker { display: none; }
.action summary::before {
  content: "▸";
  color: var(--quiet);
  width: 10px;
}
.action details[open] summary::before { content: "▾"; }
.action .body { padding: 0 14px 12px; border-top: 1px solid var(--line); }
.status { font-size: 12px; font-weight: 600; }
.status.done { color: var(--done); }
.status.stopped { color: var(--stopped); }
.status.failed { color: var(--failed); }
.title { font-weight: 600; }
.target {
  font: 13px Consolas, "Cascadia Mono", monospace;
  color: var(--quiet);
  overflow-wrap: anywhere;
  min-width: 0;
}
.approval { margin-left: auto; font-size: 12px; color: var(--quiet); }
.claim { color: var(--quiet); font-style: italic; }
pre {
  margin: 6px 0;
  padding: 10px 12px;
  background: var(--ground);
  border-radius: 6px;
  font: 12.5px/1.5 Consolas, "Cascadia Mono", monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.diff span { display: block; padding: 0 6px; border-radius: 3px; }
.diff .added { background: var(--added); color: var(--added-text); }
.diff .removed { background: var(--removed); color: var(--removed-text); }
.diff .skipped { color: var(--quiet); font-style: italic; }
dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 2px 14px; margin: 6px 0; }
dl.facts dt { color: var(--quiet); }
dl.facts dd { margin: 0; overflow-wrap: anywhere; }
dl.facts dd pre { margin: 0 0 6px; }
.quiet { color: var(--quiet); font-size: 13px; }
footer { margin-top: 36px; color: var(--quiet); font-size: 13px; }
footer ul { padding-left: 18px; }
@media print {
  .message, .action { break-inside: avoid; }
}
`;
