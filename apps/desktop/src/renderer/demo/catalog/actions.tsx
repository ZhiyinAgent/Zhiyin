import {
  ActionHistory,
  ApprovalPrompt,
  JsonBlock,
  SpecialistRunHistory,
  ToolCallView,
} from "../../ui/actions/index.js";
import { ConversationPermissions } from "../../ui/app/index.js";
import { sampleBrowserFrame } from "../sampleBrowserFrame.js";
import type { ConversationPermission } from "@zhiyin/contract";
import { useState } from "react";
import type { ComponentCatalogEntry } from "./entry.js";

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
          claim="Retirer Babel et corriger la définition des encadrés."
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
          title="Publish the release notes"
          target="docs.zhiyin.app"
          description="This sends the reviewed draft to the public documentation site."
          command="pnpm docs:publish --production"
          onDecision={() => undefined}
        />
        <ApprovalPrompt
          title="Run the invoice tests"
          effect="Run a shell command"
          claim="Runs only the invoice tests, to check the date fix."
          target="pnpm test -- --run invoice"
          command={
            'bash({"command":"pnpm test -- --run invoice","timeoutMs":120000})'
          }
          onDecision={() => undefined}
        />
        <div className="lab-dock">
          <ApprovalPrompt
            title="Run a shell command"
            effect="Run a shell command"
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
              id: "scan",
              action: "Scan the source tree",
              description: "Locate packages that contribute to the release.",
              target: "packages",
              status: "running",
            },
            {
              id: "package",
              action: "Read package.json",
              description: "Identify the project and its package manager.",
              target: "package.json",
              status: "completed",
            },
            {
              id: "python",
              action: "Run a shell command",
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
              id: "remote",
              action: "Use Tavily: tavily_search",
              toolName: "mcp__research__tavily__tavily_search",
              description: "An external tool that describes nothing.",
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
              id: "readme",
              action: "Read README.md",
              description: "Find the project overview in the workspace.",
              target: "README.md",
              status: "failed",
              reason: "README.md was not found in this workspace.",
            },
            {
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
    id: "specialist-run-history",
    title: "Specialist run history",
    description:
      "A delegated specialist's own run, drawn with the same production components as the main task's history: its status and task, its structured handoff once it finishes, and its own actions nested through the unmodified action history.",
    render: () => (
      <div className="lab-narrow" style={{ display: "grid", gap: 16 }}>
        <SpecialistRunHistory
          run={{
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
  {
    id: "tool-call",
    title: "What was called, and with what",
    description:
      "The shared rendering for any tool that does not draw its own effects: one row per input, and the answer below. JSON is indented and coloured by shape, a payload that arrived escaped inside a field is decoded, and a long value is cut from the middle with the amount stated.",
    render: () => (
      <div className="lab-stack">
        <ToolCallView
          invocation={{
            name: "tavily_search",
            via: "https://mcp.tavily.com/mcp/",
            arguments: [
              { name: "max_results", value: "8" },
              {
                name: "query",
                value: "ZEvent 2026 montant récolté associations",
              },
              { name: "search_depth", value: "advanced" },
            ],
          }}
        />
        <ToolCallView
          invocation={{
            name: "render_bar_chart",
            arguments: [
              { name: "title", value: "Récoltes par édition" },
              {
                name: "series",
                value: `[
  {
    "label": "2024",
    "value": 10182154,
    "highlight": false
  },
  {
    "label": "2026",
    "value": 32891874,
    "highlight": true
  }
]`,
              },
            ],
          }}
        />
        <ToolCallView
          invocation={{
            name: "write_file",
            arguments: [
              { name: "path", value: "notes/summary.md" },
              {
                name: "text",
                value: `# ZEvent 2026

L’édition 2026 a récolté 32 891 874 euros au profit de 22 associations.

## Bilan

Le total dépasse celui de 2025.`,
                omitted: 12480,
              },
            ],
          }}
        />
        <ToolCallView
          invocation={{ name: "browser_snapshot", arguments: [] }}
        />
        <JsonBlock
          text={JSON.stringify({
            ok: true,
            value: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    query: "most popular movies in theaters",
                    answer: null,
                    results: [
                      {
                        url: "https://example.com/weekend",
                        title: "Weekend Box Office",
                        score: 0.94,
                      },
                    ],
                  }),
                },
              ],
            },
          })}
        />
      </div>
    ),
  },
];
