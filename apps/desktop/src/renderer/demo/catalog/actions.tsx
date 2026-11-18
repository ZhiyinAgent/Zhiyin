import {
  ActionHistory,
  SpecialistRunHistory,
  TurnChecks,
  TurnFiles,
} from "../../ui/actions/index.js";
import { MarkdownMessage } from "../../ui/conversation/index.js";
import { sampleBrowserFrame } from "../sampleBrowserFrame.js";
import type { ActionEffects, TaskAction } from "@zhiyin/contract";
import type { ComponentCatalogEntry } from "./entry.js";

/** A thesis of three pages, as the words a PDF reader takes from each. */
const thesisPages = [
  "Household energy use in rural Yunnan\nA thesis submitted for the degree of Master of Science\nOctober 2026",
  "1 Introduction\nThis thesis measures how households heat their homes in winter.\nThe sample of 40 households is small.\nEach household was visited twice.",
  "2 Method\nReadings were taken every hour for six weeks.\nMissing readings were left out rather than estimated.",
];

/** A turn that edited two files, wrote a third, and recycled a fourth. */
const turnActions: TaskAction[] = [
  {
    sequence: 1,
    id: "edit-plan",
    action: "Edit a file",
    target: "notes/plan.md",
    status: "completed",
    changes: [
      {
        path: "notes/plan.md",
        change: "updated",
        before: "# Plan\n\n- Draft the brief\n- Send it\n",
        after:
          "# Plan\n\n- Draft the brief\n- Review it with Ana\n- Send it on Friday\n",
      },
    ],
  },
  {
    sequence: 1,
    id: "edit-budget",
    action: "Edit a file",
    target: "budget/2026 quarterly budget with the long name.csv",
    status: "completed",
    changes: [
      {
        path: "budget/2026 quarterly budget with the long name.csv",
        change: "updated",
        before: "item,amount\nrent,1200\nfood,400\n",
        after: "item,amount\nrent,1200\n",
      },
    ],
  },
  {
    sequence: 1,
    id: "write-summary",
    action: "Write a file",
    target: "summary.md",
    status: "completed",
    changes: [
      {
        path: "summary.md",
        change: "created",
        after: "# Summary\n\nThe plan now has a review step.\n",
      },
    ],
  },
  {
    sequence: 1,
    id: "recycle-old",
    action: "Delete a file",
    target: "old-plan.md",
    status: "completed",
    changes: [{ path: "old-plan.md", change: "recycled" }],
  },
];

/** A move that ran, naming each file at both ends as the tool does. */
function moveAction(
  id: string,
  action: string,
  moves: readonly (readonly [from: string, to: string])[],
): TaskAction {
  return {
    sequence: 1,
    id,
    action,
    target: moves[0]![0],
    status: "completed",
    changes: [
      ...moves.map(([from, to]) => ({
        path: from,
        change: "moved" as const,
        to,
      })),
      ...moves.map(([from, to]) => ({
        path: to,
        change: "created" as const,
        from,
      })),
    ],
  };
}

/**
 * A turn that renamed a file, moved a folder, moved a file out of the
 * workspace, wrote a draft and moved it, and moved a file in and edited it.
 */
const movedActions: TaskAction[] = [
  moveAction("rename", "Rename notes.md to meeting notes.md", [
    ["notes.md", "meeting notes.md"],
  ]),
  moveAction("move-folder", "Move drafts to archive/drafts", [
    ["drafts/brief.md", "archive/drafts/brief.md"],
    ["drafts/outline.md", "archive/drafts/outline.md"],
  ]),
  moveAction(
    "move-out",
    "Move report.pdf to C:\\Users\\Léa\\Documents\\Rapports 2026\\report.pdf",
    [["report.pdf", "C:\\Users\\Léa\\Documents\\Rapports 2026\\report.pdf"]],
  ),
  {
    sequence: 1,
    id: "write-draft",
    action: "Write a file",
    target: "draft.md",
    status: "completed",
    changes: [
      {
        path: "draft.md",
        change: "created",
        after: "# Letter\n\nDear Ana,\n",
      },
    ],
  },
  moveAction("file-draft", "Move draft.md to letters/ana.md", [
    ["draft.md", "letters/ana.md"],
  ]),
  moveAction("move-budget", "Move budget.csv to finance/budget.csv", [
    ["budget.csv", "finance/budget.csv"],
  ]),
  {
    sequence: 1,
    id: "edit-budget-moved",
    action: "Edit a file",
    target: "finance/budget.csv",
    status: "completed",
    changes: [
      {
        path: "finance/budget.csv",
        change: "updated",
        before: "item,amount\nrent,1200\n",
        after: "item,amount\nrent,1250\n",
      },
    ],
  },
];

/** What a demo action declares it does. */
const nothing: ActionEffects = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
};
const shell: ActionEffects = {
  ...nothing,
  reads: "elsewhere",
  changes: "elsewhere",
  sends: "chosen",
  runs: "full-access",
  brings: "outside",
};

export const actionsEntries: ComponentCatalogEntry[] = [
  {
    id: "action-history",
    title: "Action history",
    description:
      "Durable outcomes use human action names, exact targets, and plain reasons. An action that ran and answered without succeeding is neither a tick nor a cross. Inspecting one shows what it did — a difference, an output, a list of matches — rather than the call that did it.",
    render: () => (
      <div className="lab-narrow">
        <ActionHistory
          readPicture={async () => ({
            status: "ready",
            mediaType: "image/jpeg",
            data: sampleBrowserFrame,
          })}
          actions={[
            {
              sequence: 1,
              id: "research",
              effects: { ...nothing, sends: "service", brings: "outside" },
              action: "Tavily · Search",
              description: "Check a source for the latest figures.",
              descriptionBy: "model",
              target: "Tavily",
              status: "completed",
              approval: {
                by: "conversation-permission",
                at: "2026-09-29T19:00:00.000Z",
                permissionId: "permission-demo",
              },
            },
            {
              sequence: 1,
              id: "scan",
              effects: { ...nothing, reads: "workspace" },
              action: "Scan the source tree",
              description: "Locate packages that contribute to the release.",
              descriptionBy: "model",
              target: "packages",
              status: "running",
            },
            {
              sequence: 1,
              id: "package",
              effects: { ...nothing, reads: "workspace" },
              action: "Read package.json",
              description: "Identify the project and its package manager.",
              descriptionBy: "model",
              target: "package.json",
              status: "completed",
            },
            {
              sequence: 1,
              id: "python",
              effects: shell,
              action: "Run a command",
              description: "Check whether Python 3 is installed.",
              descriptionBy: "model",
              target: "command -v python3",
              status: "reported",
              reason: "The command exited with code 1.",
              claim: "Check whether Python 3 is installed before using it.",
              command: 'bash({"command":"command -v python3"})',
              details: [
                {
                  kind: "text",
                  label: "Command",
                  text: "command -v python3",
                },
                {
                  kind: "facts",
                  items: [
                    { label: "Exit code", value: "1" },
                    { label: "Took", value: "38 ms" },
                  ],
                },
                {
                  kind: "text",
                  label: "Errors",
                  text: "bash: command: python3: not found",
                },
              ],
            },
            {
              sequence: 1,
              id: "skill",
              effects: { ...nothing, reads: "app" },
              action: "Open exploratory-data-analysis",
              target: "skill:data-science/exploratory-data-analysis",
              status: "completed",
              command:
                'open({"id":"skill:data-science/exploratory-data-analysis"})',
              details: [
                {
                  kind: "text",
                  label: "Instructions",
                  text: [
                    "Inspect the available data before interpreting it.",
                    "Identify units, missing values, and assumptions.",
                    "Distinguish observations from causal claims.",
                  ].join("\n"),
                },
              ],
            },
            {
              sequence: 1,
              id: "release",
              effects: {
                ...nothing,
                reads: "workspace",
                changes: "workspace",
                sends: "chosen",
                runs: "sealed",
                brings: "outside",
              },
              action: "Run a Python script",
              description: "Check the latest polars release.",
              descriptionBy: "model",
              target: "a script",
              status: "completed",
              detail:
                "The script reads and changes only the workspace, and can reach pypi.org: it could send what it reads there, and nowhere else.",
              details: [
                {
                  kind: "text",
                  label: "Network",
                  text: "pypi.org: sent 1.8 KB, received 312.4 KB.\nfiles.pythonhosted.org: refused: not among the hosts this run may reach.",
                },
              ],
            },
            {
              sequence: 1,
              id: "capture",
              effects: { ...nothing, brings: "outside" },
              action: "Capture page",
              description: "Look at the chart the way the page draws it.",
              descriptionBy: "model",
              target: "http://127.0.0.1:61075/index.html",
              status: "completed",
              detail:
                "Reads the page as it stands. What it says then guides the work that follows.",
              command: 'browser_take_screenshot({"fullPage":true})',
              details: [
                {
                  kind: "image",
                  label: "Picture",
                  mediaType: "image/jpeg",
                  source: "sample-picture",
                  alt: "The chart page, as Zhiyin’s browser saw it",
                },
                {
                  kind: "facts",
                  items: [
                    { label: "Browser", value: "Zhiyin’s browser" },
                    { label: "Page", value: "Revenue by quarter" },
                  ],
                },
              ],
            },
            {
              sequence: 1,
              id: "blocked",
              effects: { ...nothing, reads: "elsewhere", changes: "elsewhere" },
              action: "Delete a file",
              description: "Remove the old export before writing a new one.",
              descriptionBy: "model",
              target: "../shared/exports/old.csv",
              status: "blocked",
              reason: "This is outside the conversation's folder.",
            },
            {
              sequence: 1,
              id: "stopped",
              effects: shell,
              action: "Run a command",
              description: "Build the documentation site.",
              descriptionBy: "model",
              target: "pnpm docs:build",
              status: "cancelled",
              reason: "The action stopped before it completed.",
            },
            {
              sequence: 1,
              id: "remote",
              effects: { ...nothing, sends: "service", brings: "outside" },
              action: "Tavily · Search",
              toolName: "mcp__research__tavily__tavily_search",
              description: "Look up how many CFM56 engines were delivered.",
              descriptionBy: "model",
              target: "Tavily",
              status: "completed",
              command: 'tavily_search({"query":"current news"})',
              evidence: '{"ok":true,"value":{"results":[]}}',
              invocation: {
                name: "tavily_search",
                via: "https://mcp.tavily.com/mcp/",
                arguments: [
                  { name: "max_results", value: "6" },
                  {
                    name: "query",
                    value:
                      "CFM56 total engines delivered best-selling commercial aircraft engine",
                  },
                  { name: "search_depth", value: "advanced" },
                ],
              },
            },
            {
              sequence: 1,
              id: "brief",
              effects: { ...nothing, reads: "workspace", changes: "workspace" },
              action: "Overwrite an existing workspace file",
              description: "Rewrite the brief with the agreed wording.",
              descriptionBy: "model",
              target: "docs/brief.md",
              status: "completed",
              command:
                'write_file({"path":"docs/brief.md","content":"# Brief…"})',
              changes: [
                {
                  path: "docs/brief.md",
                  change: "updated",
                  before: ["# Brief", "", "Internal reviewers."].join("\n"),
                  after: [
                    "# Brief",
                    "",
                    "Internal reviewers and the partner team.",
                  ].join("\n"),
                },
              ],
            },
            {
              sequence: 1,
              id: "search",
              effects: { ...nothing, reads: "workspace" },
              action: "Search workspace files",
              description: "Find where the budget figure is quoted.",
              descriptionBy: "model",
              target: "“budget”",
              status: "completed",
              command: 'search_files({"query":"budget"})',
              details: [
                {
                  kind: "facts",
                  items: [
                    { label: "Looking for", value: "budget" },
                    { label: "Files read", value: "184" },
                    { label: "Matches", value: "2" },
                  ],
                },
                {
                  kind: "matches",
                  items: [
                    {
                      path: "notes/budget.md",
                      line: 3,
                      text: "Q3 budget total: 42,000",
                    },
                    {
                      path: "docs/brief.md",
                      line: 11,
                      text: "against the budget agreed in June",
                    },
                  ],
                  note: "Not searched: .git, node_modules.",
                },
              ],
            },
            {
              sequence: 1,
              id: "readme",
              effects: { ...nothing, reads: "workspace" },
              action: "Read README.md",
              description: "Find the project overview in the workspace.",
              descriptionBy: "model",
              target: "README.md",
              status: "failed",
              reason: "README.md was not found in this workspace.",
            },
            {
              sequence: 1,
              id: "publish",
              effects: shell,
              action: "Publish the release notes",
              target: "docs.zhiyin.app",
              status: "denied",
              reason: "The action was denied. No further work ran.",
            },
            {
              ...movedActions[1]!,
              effects: { ...nothing, reads: "workspace", changes: "workspace" },
            },
          ]}
        />
      </div>
    ),
  },
  {
    id: "turn-checks",
    title: "Checks a turn's tools measured",
    description:
      "Under a turn whose tool measured checks, such as a design's requirements: the last build's verdict on each, said in words beside its mark with what was measured, a long label and measure wrapping, and a requirement taken out after failing named under the list.",
    render: () => (
      <div className="lab-narrow" style={{ display: "grid", gap: 16 }}>
        <TurnChecks
          checks={[
            {
              kind: "checks",
              label: "Requirements in requirements.json",
              items: [
                {
                  label: "R1 · Fits a 200 × 200 × 200 mm print bed",
                  holds: true,
                  note: "180.4 × 92.1 × 61.7 mm; 19.6 mm to spare",
                },
                {
                  label:
                    "R2 · The front axle goes into the front-right wheel from outside",
                  holds: false,
                  note: "Axle_F cannot go in along +y: 76.1 mm short of its place it meets Wheel_FR at (41.5, 38.2, 12), and would go 0.7 mm into it; 0.7 mm past the limit",
                },
                {
                  label: "R3 · No overhang steeper than 45°",
                  holds: true,
                  note: "steepest overhang 44.2°; 0.8° to spare",
                },
                {
                  label: "R4 · Lid walls at least 1.2 mm",
                  holds: null,
                  note: "no part is named Lid",
                },
              ],
              note: "R5 (No wall under 1.2 mm) failed in the last build, 1.09 mm past its limit, and is no longer in requirements.json.",
            },
          ]}
        />
      </div>
    ),
  },
  {
    id: "turn-files",
    title: "Files a turn changed",
    description:
      "Under each turn that touched files: how many and how many lines, each file once with its own review, and one undo that shows what goes back and what stays before it does anything. Below, the same turn after its undo, one whose large file had no copy, one whose commands changed files that were only listed, one whose folder was too large to check, one that compiled over a PDF, whose review compares the words on its pages, and one that moved files: a rename, a folder, a file out of the workspace, a draft written then moved, and a file moved then edited, each move named at both ends.",
    render: () => (
      <div className="lab-narrow" style={{ display: "grid", gap: 16 }}>
        <TurnFiles
          actions={turnActions}
          running={false}
          onPreviewUndo={async () => ({
            id: "undo-lab",
            taskId: "task-lab",
            messageId: "message-lab",
            files: [
              {
                path: "notes/plan.md",
                action: "restore",
                status: "recoverable",
              },
              {
                path: "budget/2026 quarterly budget with the long name.csv",
                action: "restore",
                status: "conflict",
              },
              { path: "summary.md", action: "remove", status: "recoverable" },
            ],
          })}
          onCommitUndo={async () => ({ files: [] })}
        />
        <TurnFiles
          actions={turnActions}
          running={false}
          undone={{
            id: "undo-lab",
            messageId: "message-lab",
            actionIds: ["edit-plan", "edit-budget", "write-summary"],
            at: "2026-10-02T09:00:00.000Z",
            files: [
              { path: "notes/plan.md", status: "restored" },
              {
                path: "budget/2026 quarterly budget with the long name.csv",
                status: "conflict",
              },
              { path: "summary.md", status: "removed" },
            ],
          }}
        />
        <TurnFiles
          actions={[
            {
              sequence: 1,
              id: "export",
              action: "Write a file",
              target: "exports/data.csv",
              status: "completed",
              changes: [
                {
                  path: "exports/data.csv",
                  change: "updated",
                  omitted: "The file is too large to show.",
                },
              ],
              recovery: {
                files: [
                  {
                    path: "exports/data.csv",
                    status: "unprotected",
                    reason: "Too large to keep a copy.",
                  },
                ],
              },
            },
          ]}
          running={false}
          onPreviewUndo={async () => {
            throw new Error("Not offered.");
          }}
          onCommitUndo={async () => ({ files: [] })}
        />
        <TurnFiles
          actions={[
            turnActions[0]!,
            {
              sequence: 1,
              id: "convert",
              action: "Run a command",
              target: "python convert.py",
              status: "completed",
              commandChanges: {
                status: "checked",
                files: [
                  { path: "notes/plan.md", change: "updated" },
                  { path: "exports/sales by region.csv", change: "created" },
                  { path: "exports/old.csv", change: "deleted" },
                ],
                more: 12,
              },
            },
            {
              sequence: 1,
              id: "build",
              action: "Run a command",
              target: "make report",
              status: "completed",
              commandChanges: { status: "running", job: "J1" },
            },
          ]}
          running={false}
          onPreviewUndo={async () => ({
            id: "undo-lab",
            taskId: "task-lab",
            messageId: "message-lab",
            files: [
              { path: "notes/plan.md", action: "restore", status: "conflict" },
            ],
          })}
          onCommitUndo={async () => ({ files: [] })}
        />
        <TurnFiles
          actions={[
            {
              sequence: 1,
              id: "convert-large",
              action: "Run a command",
              target: "python convert.py",
              status: "completed",
              commandChanges: {
                status: "unchecked",
                reason:
                  "This folder has more than 20,000 files, too many to check what commands change.",
              },
            },
          ]}
          running={false}
        />
        <TurnFiles
          actions={[
            {
              sequence: 1,
              id: "compile-paper",
              action: "Compile document",
              target: "paper/thesis.typ",
              status: "completed",
              changes: [
                {
                  path: "paper/thesis.pdf",
                  change: "updated",
                  omitted: "Its contents are known only once it is compiled.",
                },
              ],
            },
          ]}
          running={false}
          onPreviewUndo={async () => ({
            id: "undo-compile",
            taskId: "task-lab",
            messageId: "message-lab",
            files: [
              {
                path: "paper/thesis.pdf",
                action: "restore",
                status: "recoverable",
              },
            ],
          })}
          onCommitUndo={async () => ({ files: [] })}
          onCompareDocument={async () => ({
            before: thesisPages,
            after: [
              thesisPages[0]!,
              thesisPages[1]!.replace(
                "The sample of 40 households is small.",
                "The sample of 212 households across four regions is large enough to compare them.",
              ),
              thesisPages[2]! + "\nLimitations are discussed in chapter 5.",
            ],
          })}
        />
        <TurnFiles
          actions={movedActions}
          running={false}
          onPreviewUndo={async () => {
            throw new Error("Not offered.");
          }}
          onCommitUndo={async () => ({ files: [] })}
        />
      </div>
    ),
  },
  {
    id: "specialist-run-history",
    title: "Specialist run history",
    description:
      "A delegated specialist's own run, drawn with the same production components as the main task's history: its status and task, its structured handoff once it finishes, and its own actions nested through the unmodified action history.",
    render: () => (
      <div className="lab-narrow" style={{ display: "grid", gap: 16 }}>
        <SpecialistRunHistory
          Markdown={MarkdownMessage}
          run={{
            sequence: 1,
            id: "run-running",
            specialist: {
              id: "reviewer",
              name: "Reviewer",
              description: "Reviews behavior and regressions.",
              instructions: "Inspect the evidence and report concrete risks.",
              provenance: { source: "plugin", pluginId: "engineering" },
            },
            task: "Review the proposed change for regressions. Read every file the change touches, run the tests that cover them, and report any behaviour that differs from the documented invariants, with the file and the test that shows it.",
            depth: 1,
            status: "running",
            startedAt: "2026-09-17T00:00:00.000Z",
            actionIds: ["review-read"],
          }}
          actions={[
            {
              sequence: 1,
              id: "review-read",
              action: "Read file",
              target: "src/change.ts",
              command: "read_file(src/change.ts)",
              status: "completed",
            },
          ]}
        />
        <SpecialistRunHistory
          Markdown={MarkdownMessage}
          run={{
            sequence: 1,
            id: "run-completed",
            specialist: {
              id: "reviewer",
              name: "Reviewer",
              description: "Reviews behavior and regressions.",
              instructions: "Inspect the evidence and report concrete risks.",
              provenance: { source: "plugin", pluginId: "engineering" },
            },
            task: "Review the proposed change for regressions.",
            depth: 1,
            status: "completed",
            startedAt: "2026-09-17T00:00:00.000Z",
            finishedAt: "2026-09-17T00:01:00.000Z",
            actionIds: ["review-read"],
            handoff: {
              report: [
                "The change is covered by an existing regression test. The risks are in coverage and in one undocumented edge, not in the arithmetic: every total was checked against the source files and matches.",
                "",
                "## Findings",
                "",
                "1. **Accurate totals**: every figure in the summary table matches the CSV exports, including the rounding of the quarterly averages.",
                "2. **MAJOR (§4.2 lines 203-205)**: the retry path skips the backoff when the provider returns 429 without Retry-After, so a burst of calls is sent again at once.",
                "3. **MINOR (§6)**: the log line names the connector id rather than its display name.",
                "",
                "## Recommendations",
                "",
                "- Keep the regression test in the release gate.",
                "- Default to a one-second backoff when a 429 carries no Retry-After.",
                "",
                "## Not checked",
                "",
                "The installed build was not run; only the unit tests were.",
              ].join("\n"),
            },
          }}
          actions={[
            {
              sequence: 1,
              id: "review-read",
              action: "Read file",
              target: "src/change.ts",
              command: "read_file(src/change.ts)",
              status: "completed",
            },
          ]}
        />
        <SpecialistRunHistory
          Markdown={MarkdownMessage}
          run={{
            sequence: 1,
            id: "run-interrupted",
            specialist: {
              id: "reviewer",
              name: "Reviewer",
              description: "Reviews behavior and regressions.",
              instructions: "Inspect the evidence and report concrete risks.",
              provenance: { source: "plugin", pluginId: "engineering" },
            },
            task: "Review the proposed change for regressions.",
            depth: 1,
            status: "interrupted",
            startedAt: "2026-09-17T00:00:00.000Z",
            finishedAt: "2026-09-17T00:01:00.000Z",
            actionIds: [],
            reason: "The specialist stopped before it completed.",
          }}
          actions={[]}
        />
      </div>
    ),
  },
];
