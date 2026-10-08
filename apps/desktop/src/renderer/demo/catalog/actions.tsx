import {
  ActionHistory,
  ApprovalPrompt,
  SpecialistRunHistory,
  TurnFiles,
} from "../../ui/actions/index.js";
import { ConversationPermissions } from "../../ui/app/index.js";
import { sampleBrowserFrame } from "../sampleBrowserFrame.js";
import {
  emptyConversationLists,
  type ConversationPermission,
  type TaskAction,
} from "@zhiyin/contract";
import { useState } from "react";
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

function ConversationPermissionsExample() {
  const [open, setOpen] = useState(false);
  const [permissions, setPermissions] = useState<ConversationPermission[]>([
    {
      id: "permission-demo",
      kind: "connector-tool",
      toolName: "mcp__research__tavily__tavily_search",
      label: "mcp__research__tavily__tavily_search, this version",
      at: "2026-09-29T19:00:00.000Z",
      identity: JSON.stringify({
        server: { id: "research/tavily", name: "Tavily" },
        schema: {},
      }),
    },
    {
      id: "permission-folder",
      kind: "file-folder",
      toolName: "write_file",
      label: "Changes to files in reports/",
      at: "2026-09-29T19:00:00.000Z",
      workspaceRoot: "C:/workspace",
      folder: "C:/workspace/reports",
    },
  ]);
  return (
    <>
      <button className="button button--quiet" onClick={() => setOpen(true)}>
        Open permissions
      </button>
      {open && (
        <ConversationPermissions
          task={{
            id: "catalog-permissions",
            title: "Prepare a research report",
            updatedLabel: "Now",
            updatedAt: "2026-10-05T09:00:00.000Z",
            ...emptyConversationLists,
            messages: [],
            phase: { kind: "draft" },
            conversationPermissions: permissions,
          }}
          onClose={() => setOpen(false)}
          onRevoke={async (id) =>
            setPermissions((current) =>
              current.filter((item) => item.id !== id),
            )
          }
        />
      )}
    </>
  );
}

/** A long page whose end holds a few style rules, to be edited. */
const longPage = Array.from({ length: 1_200 }, (_, line) =>
  line === 1_003
    ? "  --or:#e0a03c;"
    : line === 1_009
      ? "  --gris:#6a7885;"
      : line === 1_014
        ? "  .reveler{opacity:1;transform:none;transition:none}"
        : `  <p>Ligne ${line + 1} de la page.</p>`,
);

export const actionsEntries: ComponentCatalogEntry[] = [
  {
    id: "permission",
    title: "Permission",
    description:
      "A compact decision row with technical detail on demand; a long script, which scrolls inside the card so the decision stays in view; the same row for a command whose effect only Zhiyin can describe; and the same row when the action would replace existing work, where the change is reviewed as a difference rather than as the call.",
    render: () => (
      <div className="lab-stack">
        <ApprovalPrompt
          title="Edit a workspace file"
          claim="Remove Babel and fix how the boxed notes are defined."
          target="rapport-enseigner-maternelle.tex"
          command={'edit_file({"path":"rapport-enseigner-maternelle.tex"})'}
          changes={[
            {
              path: "rapport-enseigner-maternelle.tex",
              change: "updated",
              before: "\\usepackage[french]{babel}\n",
              after: "\\usepackage{polyglossia}\n",
            },
          ]}
          conversationRule={{ label: "Changes to files in this folder" }}
          onDecision={() => undefined}
        />
        {/* Long enough for four-digit line numbers in the review, with a
            value changed, a line rewritten and a line added. */}
        <ApprovalPrompt
          title="Edit a workspace file"
          claim="Darken the grey and explain the gold colour."
          target="page-maternelle.html"
          command={'edit_file({"path":"page-maternelle.html"})'}
          changes={[
            {
              path: "page-maternelle.html",
              change: "updated",
              before: longPage.join("\n"),
              after: longPage
                .map((line, index) =>
                  index === 1_009
                    ? "  --gris:#5a6673;"
                    : index === 1_014
                      ? "  .reveler{opacity:1;transform:none}"
                      : line,
                )
                .toSpliced(
                  1_004,
                  0,
                  "  /* --or reste decoratif ; pour du texte, --or-texte. */",
                  "  --or-texte:#9c5e14;",
                )
                .join("\n"),
            },
          ]}
          onDecision={() => undefined}
        />
        <ApprovalPrompt
          title="Search the web"
          destination="Tavily"
          claim="Find the total raised at ZEvent 2026."
          target="tavily_search"
          command={'tavily_search({"query":"ZEvent 2026 montant récolté"})'}
          invocation={{
            name: "tavily_search",
            via: "Tavily",
            arguments: [
              { name: "query", value: "ZEvent 2026 montant récolté" },
            ],
          }}
          onDecision={() => undefined}
        />
        <ApprovalPrompt
          title="Delete 2 items: 1 to the Recycle Bin, 1 permanently"
          target="2 items"
          detail="To the Recycle Bin, where they can be restored: drafts/old-plan.md (4.1 KB). Deleted permanently; this cannot be restored from the Recycle Bin: exports/archive.zip (18.2 GB). Windows would not move exports/archive.zip to the Recycle Bin: it is too large for it, or on a drive without one."
          command='delete_file({"paths":["drafts/old-plan.md","exports/archive.zip"]})'
          changes={[
            { path: "drafts/old-plan.md", change: "recycled" },
            { path: "exports/archive.zip", change: "deleted" },
          ]}
          onDecision={() => undefined}
        />
        <ApprovalPrompt
          title="Publish the release notes"
          target="docs.zhiyin.app"
          description="This sends the reviewed draft to the public documentation site."
          command="pnpm docs:publish --production"
          onDecision={() => undefined}
        />
        <ApprovalPrompt
          title="Run the invoice tests"
          effect="Run a command"
          claim="Runs only the invoice tests, to check the date fix."
          target="pnpm test -- --run invoice"
          command={
            'bash({"command":"pnpm test -- --run invoice","timeoutMs":120000})'
          }
          onDecision={() => undefined}
        />
        <div className="lab-dock">
          <ApprovalPrompt
            title="Run a command"
            effect="Run a command"
            claim="Parse all tables in the Wikipedia PISA article and list their captions and sizes to locate the score tables"
            target="cat > /tmp/parse_tables.py"
            invocation={{
              name: "bash",
              arguments: [
                {
                  name: "command",
                  value:
                    "cat > /tmp/parse_tables.py << 'EOF'\nimport re\nfrom html.parser import HTMLParser\n\nclass TableExtractor(HTMLParser):\n    def __init__(self):\n        super().__init__()\n        self.tables = []\n        self.depth = 0\n        self.cur = None\n        self.in_caption = False\n        self.cur_caption = []\n        self.in_cell = False\n\n    def handle_starttag(self, tag, attrs):\n        if tag == 'table':\n            self.depth += 1\n            self.cur = {'caption': '', 'rows': 0}\nEOF\npython /tmp/parse_tables.py",
                },
                {
                  name: "explanation",
                  value:
                    "Parse all tables in the Wikipedia PISA article and list their captions and sizes to locate the score tables",
                },
              ],
            }}
            command={'bash({"command":"cat > /tmp/parse_tables.py << EOF …"})'}
            onDecision={() => undefined}
          />
        </div>
        <ApprovalPrompt
          title="Rewrite the project brief"
          effect="Overwrite an existing workspace file"
          detail="This replaces the current contents of docs/brief.md (4.2 KB)."
          target="docs/brief.md"
          description="The rewritten brief replaces the draft you already have."
          command={'write_file({"path":"docs/brief.md","text":"# Brief…"})'}
          changes={[
            {
              path: "docs/brief.md",
              change: "updated",
              before: [
                "# Project brief",
                "",
                "## Purpose",
                "A short statement of what we are building.",
                "",
                "## Audience",
                "Internal reviewers.",
                "",
                "## Timeline",
                "Draft by Friday.",
              ].join("\n"),
              after: [
                "# Project brief",
                "",
                "## Purpose",
                "A short statement of what we are building, and for whom.",
                "",
                "## Audience",
                "Internal reviewers and the partner team.",
                "",
                "## Timeline",
                "Draft by Friday.",
                "Review the following Monday.",
              ].join("\n"),
            },
          ]}
          recovery={{
            files: [
              {
                path: "docs/brief.md",
                status: "protected",
              },
            ],
          }}
          onDecision={() => undefined}
        />
      </div>
    ),
  },
  {
    id: "conversation-permissions",
    title: "Conversation permissions",
    description:
      "Active grants have readable scopes and a direct revoke control.",
    render: () => <ConversationPermissionsExample />,
  },
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
              action: "Tavily · Search",
              description: "Check a source for the latest figures.",
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
              action: "Scan the source tree",
              description: "Locate packages that contribute to the release.",
              target: "packages",
              status: "running",
            },
            {
              sequence: 1,
              id: "package",
              action: "Read package.json",
              description: "Identify the project and its package manager.",
              target: "package.json",
              status: "completed",
            },
            {
              sequence: 1,
              id: "python",
              action: "Run a command",
              description: "Check whether Python 3 is installed.",
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
              action: "Read skill instructions",
              target: "builtin-analysis",
              status: "completed",
              command: 'load_skill({"id":"builtin-analysis"})',
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
              id: "capture",
              action: "Capture page",
              description: "Look at the chart the way the page draws it.",
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
              action: "Delete a file",
              description: "Remove the old export before writing a new one.",
              target: "../shared/exports/old.csv",
              status: "blocked",
              reason: "This is outside the conversation's folder.",
            },
            {
              sequence: 1,
              id: "stopped",
              action: "Run a command",
              description: "Build the documentation site.",
              target: "pnpm docs:build",
              status: "cancelled",
              reason: "The action stopped before it completed.",
            },
            {
              sequence: 1,
              id: "remote",
              action: "Use Tavily: tavily_search",
              toolName: "mcp__research__tavily__tavily_search",
              description: "Look up how many CFM56 engines were delivered.",
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
              action: "Overwrite an existing workspace file",
              description: "Rewrite the brief with the agreed wording.",
              target: "docs/brief.md",
              status: "completed",
              command: 'write_file({"path":"docs/brief.md","text":"# Brief…"})',
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
              action: "Search workspace files",
              description: "Find where the budget figure is quoted.",
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
              action: "Read README.md",
              description: "Find the project overview in the workspace.",
              target: "README.md",
              status: "failed",
              reason: "README.md was not found in this workspace.",
            },
            {
              sequence: 1,
              id: "publish",
              action: "Publish the release notes",
              target: "docs.zhiyin.app",
              status: "denied",
              reason: "The action was denied. No further work ran.",
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
      "Under each turn that touched files: how many and how many lines, each file once with its own review, and one undo that shows what goes back and what stays before it does anything. Below, the same turn after its undo, one whose large file had no copy, one whose commands changed files that were only listed, one whose folder was too large to check, and one that compiled over a PDF, whose review compares the words on its pages.",
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
              summary:
                "The change is covered by an existing regression test.\nThe risks are in coverage and in one undocumented edge, not in the arithmetic: every total was checked against the source files and matches.",
              findings: [
                "Accurate totals: every figure in the summary table matches the CSV exports, including the rounding of the quarterly averages.",
                "MAJOR (§4.2 lines 203-205): the retry path skips the backoff when the provider returns 429 without Retry-After, so a burst of calls is sent again at once.",
                "MINOR (§6): the log line names the connector id rather than its display name.",
              ],
              recommendations: [
                "Keep the regression test in the release gate.",
                "Default to a one-second backoff when a 429 carries no Retry-After.",
              ],
              limitations: [
                "The installed build was not run; only the unit tests were.",
              ],
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
