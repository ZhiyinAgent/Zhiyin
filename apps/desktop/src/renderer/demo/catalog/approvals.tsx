import { ApprovalPrompt } from "../../ui/actions/index.js";
import { ConversationPermissions } from "../../ui/conversation-dialogs/index.js";
import {
  emptyConversationLists,
  type ConversationPermission,
} from "@zhiyin/contract";
import { useState } from "react";
import type { ComponentCatalogEntry } from "./entry.js";

function ConversationPermissionsExample() {
  const [open, setOpen] = useState(false);
  const [permissions, setPermissions] = useState<ConversationPermission[]>([
    {
      id: "permission-demo",
      kind: "connector-tool",
      toolName: "mcp__research__tavily__tavily_search",
      label: "Tavily · Search",
      at: "2026-09-29T19:00:00.000Z",
      identity: JSON.stringify({
        server: { id: "research/tavily", name: "Tavily" },
        schema: {},
      }),
    },
    {
      id: "permission-folder",
      kind: "outside-folder",
      toolName: "run_python",
      label: "Changes to files in D:\\Photos\\2026\\",
      at: "2026-09-29T19:00:00.000Z",
      folder: "D:\\Photos\\2026",
    },
    {
      id: "permission-place",
      kind: "destination",
      toolName: "mcp__engineering__github__*",
      label: "GitHub · lea-martin/field-notes",
      at: "2026-09-29T19:00:00.000Z",
      destination: "lea-martin/field-notes",
    },
    {
      id: "permission-file",
      kind: "outside-file",
      toolName: "write_file",
      label: "Changes to D:\\Shared\\notes\\plan.md",
      at: "2026-09-29T19:00:00.000Z",
      file: "D:\\Shared\\notes\\plan.md",
    },
    {
      id: "permission-reach-host",
      kind: "reach-host",
      toolName: "bash",
      label: "Commands may reach data.gouv.fr and every name below it",
      at: "2026-09-29T19:00:00.000Z",
      hosts: ["data.gouv.fr", "*.data.gouv.fr"],
      facts: { outsideContent: false, privateWithinReach: true },
    },
    {
      id: "permission-reach-folder",
      kind: "reach-folder",
      toolName: "bash",
      label: "Commands may read D:\\Données\\relevés-2026",
      at: "2026-09-29T19:00:00.000Z",
      folder: "D:\\Données\\relevés-2026",
      facts: { outsideContent: false, privateWithinReach: false },
    },
    {
      id: "permission-registries",
      kind: "reach-registries",
      toolName: "bash",
      label: "Package registries and Git hosts",
      at: "2026-09-29T19:00:00.000Z",
      facts: { outsideContent: true, privateWithinReach: true },
      declined: true,
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

export const approvalsEntries: ComponentCatalogEntry[] = [
  {
    id: "permission-reach",
    title: "Permission for sealed-off commands",
    description:
      "What a request for sealed-off commands to reach more shows, from fields Zhiyin checked: a website by its registrable domain, saying what it lets out while something private is within reach; a folder by its whole path, to read or to change; and the one card that confirms what the conversation outgrew, naming every grant it affects.",
    render: () => (
      <div className="lab-stack">
        <ApprovalPrompt
          title="Let commands reach a website"
          claim="Download the 2026 air-quality dataset the script reads."
          target="data.gouv.fr and every name below it"
          detail="Commands in this conversation may connect to data.gouv.fr and every name below it until the conversation ends or you take it back. Something private is within this conversation's reach, so what the conversation can read could be sent to anyone who uses that website: Zhiyin sees which website a command reaches, never what it sends."
          reach={{ kind: "grant" }}
          onDecision={() => undefined}
        />
        <ApprovalPrompt
          title="Let commands change a folder"
          claim="Write the cleaned tables beside the raw ones."
          target="D:\Données\relevés-2026\tables nettoyées après la deuxième campagne de mesures"
          detail="Sealed-off commands in this conversation may read and change every file in D:\Données\relevés-2026\tables nettoyées après la deuxième campagne de mesures, outside the folder you selected, until the conversation ends or you take it back. Each change is saved first, so going back undoes it."
          reach={{ kind: "grant" }}
          onDecision={() => undefined}
        />
        <ApprovalPrompt
          title="Keep letting commands reach these?"
          target="Commands may reach data.gouv.fr and every name below it; Commands may read D:\Données\relevés-2026; Commands may reach the package registries and Git hosts Zhiyin lists"
          reach={{
            kind: "confirm",
            since:
              "This conversation has now read content from outside, and something private is within reach: a command could send what it reads to these places, or download something that steers the work.",
            places: [
              {
                label:
                  "Commands may reach data.gouv.fr and every name below it",
                kind: "website",
              },
              {
                label: "Commands may read D:\\Données\\relevés-2026",
                kind: "folder",
              },
              {
                label:
                  "Commands may reach the package registries and Git hosts Zhiyin lists",
                kind: "website",
              },
            ],
          }}
          onDecision={() => undefined}
        />
      </div>
    ),
  },
  {
    id: "permission",
    title: "Permission",
    description:
      "A compact decision row with technical detail on demand; a long script, named on the card and read whole, numbered, in its review; the same row for a command whose effect only Zhiyin can describe; and the same row when the action would replace existing work, where the change is reviewed as a difference rather than as the call. A move, of a file, of a folder or out of the workspace, is one row per file saying where it goes.",
    render: () => (
      <div className="lab-stack">
        <ApprovalPrompt
          title="Edit a file outside the workspace"
          claim="Remove Babel and fix how the boxed notes are defined."
          target="D:\Cours\Rapport de stage\rapport-enseigner-maternelle.tex"
          changes={[
            {
              path: "D:\\Cours\\Rapport de stage\\rapport-enseigner-maternelle.tex",
              change: "updated",
              before: "\\usepackage[french]{babel}\n",
              after: "\\usepackage{polyglossia}\n",
            },
          ]}
          fileRules={[
            { choice: "file", label: "rapport-enseigner-maternelle.tex" },
            { choice: "folder", label: "D:\\Cours\\Rapport de stage\\" },
          ]}
          onDecision={() => undefined}
        />
        {/* A write outside the conversation's folder: named by its whole
            path, allowed for the conversation by the file or its folder. */}
        <ApprovalPrompt
          title="Create a file outside the workspace"
          detail="This file is outside the folder you selected. This creates a new file. Nothing is replaced."
          target="C:\Users\Léa\Documents\Impression 3D\support-casque.step"
          changes={[
            {
              path: "C:\\Users\\Léa\\Documents\\Impression 3D\\support-casque.step",
              change: "created",
              after: "ISO-10303-21;\n",
            },
          ]}
          fileRules={[
            { choice: "file", label: "support-casque.step" },
            {
              choice: "folder",
              label: "C:\\Users\\Léa\\Documents\\Impression 3D\\",
            },
          ]}
          onDecision={() => undefined}
        />
        {/* Long enough for four-digit line numbers in the review, with a
            value changed, a line rewritten and a line added. */}
        <ApprovalPrompt
          title="Edit a workspace file"
          claim="Darken the grey and explain the gold colour."
          target="page-maternelle.html"
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
          destinations={["Tavily"]}
          claim="Find the total raised at ZEvent 2026."
          target="tavily_search"
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
          detail="To the Recycle Bin, where it can be restored: drafts/old-plan.md (4.1 KB). Deleted permanently; this cannot be restored from the Recycle Bin: exports/archive.zip (18.2 GB). Windows would not move exports/archive.zip to the Recycle Bin: it is too large for it, or on a drive without one."
          changes={[
            { path: "drafts/old-plan.md", change: "recycled" },
            { path: "exports/archive.zip", change: "deleted" },
          ]}
          onDecision={() => undefined}
        />
        {/* Moves: each file is one row saying where it goes, though the
            request names it at both ends. */}
        <ApprovalPrompt
          title="Rename notes.md to meeting notes.md"
          target="notes.md"
          detail="notes.md (2.3 KB) goes to meeting notes.md. Nothing already there is replaced."
          changes={[
            { path: "notes.md", change: "moved", to: "meeting notes.md" },
            { path: "meeting notes.md", change: "created", from: "notes.md" },
          ]}
          onDecision={() => undefined}
        />
        <ApprovalPrompt
          title="Move drafts to archive/drafts"
          target="drafts"
          detail="drafts, a folder with 2 files (6.8 KB) goes to archive/drafts. Nothing already there is replaced."
          changes={[
            {
              path: "drafts/brief.md",
              change: "moved",
              to: "archive/drafts/brief.md",
            },
            {
              path: "drafts/outline.md",
              change: "moved",
              to: "archive/drafts/outline.md",
            },
            {
              path: "archive/drafts/brief.md",
              change: "created",
              from: "drafts/brief.md",
            },
            {
              path: "archive/drafts/outline.md",
              change: "created",
              from: "drafts/outline.md",
            },
          ]}
          onDecision={() => undefined}
        />
        {/* Out of the workspace: asked about every time, so nothing is
            offered for the rest of the conversation. */}
        <ApprovalPrompt
          title="Move report.pdf to C:\Users\Léa\Documents\Rapports 2026\report.pdf"
          target="report.pdf"
          detail="Something here is outside the folder you selected. report.pdf (1.2 MB) goes to C:\Users\Léa\Documents\Rapports 2026\report.pdf, in a folder this creates, C:\Users\Léa\Documents\Rapports 2026. Nothing already there is replaced."
          why={{ code: "outside-folder" }}
          effects={{
            reads: "elsewhere",
            changes: "elsewhere",
            sends: "none",
            actsAsPerson: "none",
            runs: "none",
            lasting: false,
            brings: "none",
          }}
          changes={[
            {
              path: "report.pdf",
              change: "moved",
              to: "C:\\Users\\Léa\\Documents\\Rapports 2026\\report.pdf",
            },
            {
              path: "C:\\Users\\Léa\\Documents\\Rapports 2026\\report.pdf",
              change: "created",
              from: "report.pdf",
              createdFolder: "C:\\Users\\Léa\\Documents\\Rapports 2026",
            },
          ]}
          onDecision={() => undefined}
        />
        <ApprovalPrompt
          title="Publish the release notes"
          target="docs.zhiyin.app"
          description="This sends the reviewed draft to the public documentation site."
          onDecision={() => undefined}
        />
        <ApprovalPrompt
          title="Run the invoice tests"
          effect="Run a command"
          claim="Runs only the invoice tests, to check the date fix."
          target="pnpm test -- --run invoice"
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
                  runs: true,
                },
                { name: "Stops after", value: "30 min", readable: true },
              ],
            }}
            onDecision={() => undefined}
          />
        </div>
        <ApprovalPrompt
          title="Rewrite the project brief"
          effect="Overwrite an existing workspace file"
          detail="This replaces the current contents of docs/brief.md (4.2 KB)."
          target="docs/brief.md"
          description="The rewritten brief replaces the draft you already have."
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
    id: "permission-whole",
    title: "What an approval shows whole",
    description:
      "An edit across two files, one too large to show, with the call's inputs beside the files; a large file's change, carried as the lines it changes; a browser click that says what it acts on and how; a connector tool named like a shell, whose every input is shown; and built-in tools that run code or a command, each shown as what runs with the rest in words.",
    render: () => (
      <div className="lab-stack">
        <div className="lab-dock">
          <ApprovalPrompt
            title="Edit workspace files"
            detail="This applies 2 replacements to 2 existing files. Nothing else is changed."
            target="2 files: data/export.json, notes.md"
            invocation={{
              name: "multi_edit",
              arguments: [
                {
                  name: "edits",
                  value: JSON.stringify(
                    [
                      {
                        path: "data/export.json",
                        replacements: [
                          {
                            find: '"region": "north"',
                            replace: '"region": "nord"',
                          },
                        ],
                      },
                      {
                        path: "notes.md",
                        replacements: [{ find: "north", replace: "nord" }],
                      },
                    ],
                    null,
                    2,
                  ),
                },
              ],
            }}
            changes={[
              {
                path: "data/export.json",
                change: "updated",
                omitted: "This change is too large to show here.",
              },
              {
                path: "notes.md",
                change: "updated",
                before: "Regions: north, south.\n",
                after: "Regions: nord, south.\n",
              },
            ]}
            onDecision={() => undefined}
          />
        </div>
        <ApprovalPrompt
          title="Edit workspace files"
          target="data/readings.csv"
          changes={[
            {
              path: "data/readings.csv",
              change: "updated",
              diff: {
                added: 1,
                removed: 1,
                sections: [
                  { kind: "skipped", count: 4812 },
                  {
                    kind: "lines",
                    lines: [
                      {
                        kind: "same",
                        beforeLine: 4813,
                        afterLine: 4813,
                        text: "2026-10-07 12:00,18.40",
                      },
                      {
                        kind: "removed",
                        beforeLine: 4814,
                        text: "2026-10-07 13:00,81.20",
                        parts: [
                          { text: "2026-10-07 13:00,", changed: false },
                          { text: "81", changed: true },
                          { text: ".20", changed: false },
                        ],
                      },
                      {
                        kind: "added",
                        afterLine: 4814,
                        text: "2026-10-07 13:00,18.20",
                        parts: [
                          { text: "2026-10-07 13:00,", changed: false },
                          { text: "18", changed: true },
                          { text: ".20", changed: false },
                        ],
                      },
                    ],
                  },
                  { kind: "skipped", count: 3907 },
                ],
              },
            },
          ]}
          onDecision={() => undefined}
        />
        <ApprovalPrompt
          title="Click on page"
          effect="Click on page"
          detail="Acts on the live site, which can send information or change something under your name."
          target="https://shop.example/account"
          invocation={{
            name: "Click on page",
            arguments: [
              { name: "Page", value: "https://shop.example/account" },
              { name: "Element", value: "the Cancel subscription button" },
              { name: "Selector", value: "text=Cancel subscription" },
              { name: "Double click", value: "Yes" },
              { name: "Keys held", value: "Shift" },
            ],
          }}
          onDecision={() => undefined}
        />
        <ApprovalPrompt
          title="Run a command"
          destinations={["https://ops.example/mcp"]}
          target="Ops"
          invocation={{
            name: "run_command",
            via: "https://ops.example/mcp",
            arguments: [
              { name: "command", value: "deploy --env staging" },
              { name: "cwd", value: "/srv/app" },
              { name: "stdin", value: "yes\n" },
            ],
          }}
          onDecision={() => undefined}
        />
        <div className="lab-dock">
          <ApprovalPrompt
            title="Build a CAD part"
            detail="The script reads the workspace and cannot use the internet. Zhiyin writes only plate_120x80x10.step."
            claim="Build the plate, check it is a valid solid, and export STEP"
            target="plate.py"
            invocation={{
              name: "Build a CAD part",
              arguments: [
                {
                  name: "Code",
                  value:
                    '"""Mounting plate: every size the shape depends on is named below."""\nimport sys\nfrom build123d import *\n\nLENGTH = float(sys.argv[1])  # mm\nWIDTH = float(sys.argv[2])\nTHICKNESS = 10.0\nCORNER_HOLE = 9.0  # clearance for M8\nCORNER_INSET = 10.0\nBORE = 40.0\nSLOT = (30.0, 10.0)\n\nwith BuildPart() as plate:\n    Box(LENGTH, WIDTH, THICKNESS)\n    fillet(plate.edges().filter_by(Axis.Z), radius=3)\n    with Locations(plate.faces().sort_by(Axis.Z)[-1]):\n        with GridLocations(LENGTH - 2 * CORNER_INSET, WIDTH - 2 * CORNER_INSET, 2, 2):\n            Hole(CORNER_HOLE / 2)\n        Hole(BORE / 2)\n    with BuildSketch(Plane.XY.offset(THICKNESS / 2)):\n        with Locations((0, WIDTH / 2 - CORNER_INSET)):\n            SlotOverall(*SLOT)\n    extrude(amount=-THICKNESS, mode=Mode.SUBTRACT)\n\nshow(plate.part, name="Plate")',
                  runs: true,
                },
                { name: "Script", value: "plate.py", readable: true },
                {
                  name: "Arguments",
                  value: '120 80 "steel plate"',
                  readable: true,
                },
                { name: "Stops after", value: "10 min", readable: true },
              ],
            }}
            changes={[
              {
                path: "plate_120x80x10.step",
                change: "created",
                omitted: "The part's exact faces in STEP.",
              },
            ]}
            onDecision={() => undefined}
          />
        </div>
        <div className="lab-dock">
          <ApprovalPrompt
            title="Run a Python script"
            claim="Count the rows of each sheet in the workbook"
            detail="The script reads and changes only the workspace, and reaches no network."
            target="a script, in data"
            invocation={{
              name: "Run a Python script",
              arguments: [
                {
                  name: "Code",
                  value:
                    "import sys\nimport openpyxl\n\nbook = openpyxl.load_workbook(sys.argv[1], read_only=True)\nfor sheet in book.worksheets:\n    print(sheet.title, sheet.max_row)",
                  runs: true,
                },
                {
                  name: "Arguments",
                  value: '"Ventes 2026.xlsx"',
                  readable: true,
                },
                { name: "Environment", value: "data", readable: true },
                { name: "Stops after", value: "10 min", readable: true },
              ],
            }}
            conversationRule={{
              label:
                "Python scripts that reach only the workspace, and no network",
            }}
            onDecision={() => undefined}
          />
        </div>
        <div className="lab-dock">
          <ApprovalPrompt
            title="Run a Python script"
            claim="Check the latest polars release before pinning it"
            detail="The script reads and changes only the workspace, and can reach files.pythonhosted.org and pypi.org: it could send what it reads there, and nowhere else."
            target="a script"
            invocation={{
              name: "Run a Python script",
              arguments: [
                {
                  name: "Code",
                  value:
                    "import json, urllib.request\n\nwith urllib.request.urlopen('https://pypi.org/pypi/polars/json') as answer:\n    release = json.load(answer)['info']['version']\nprint('polars', release)",
                  runs: true,
                },
                {
                  name: "Hosts",
                  value: "files.pythonhosted.org, pypi.org",
                  readable: true,
                },
                { name: "Stops after", value: "10 min", readable: true },
              ],
            }}
            conversationRule={{
              label:
                "Python scripts that reach only the workspace and these hosts: files.pythonhosted.org, pypi.org",
            }}
            onDecision={() => undefined}
          />
        </div>
        <div className="lab-dock">
          <ApprovalPrompt
            title="Commit the staged changes"
            claim="Record the date fix with a message that says why"
            detail={
              "Commits what is staged:\n src/invoice.ts | 4 ++--\n 1 file changed, 2 insertions(+), 2 deletions(-)\n\nIts commit hooks (pre-commit) run with it, with your account's full access, and can change what is committed."
            }
            target="invoices"
            invocation={{
              name: "Commit the staged changes",
              arguments: [
                {
                  name: "Command",
                  value:
                    'git commit -m "Fix the \\"due date\\" shown on invoices\n\nThe date was read as UTC, so invoices sent after 23:00 showed the next day."',
                  runs: true,
                },
              ],
            }}
            onDecision={() => undefined}
          />
        </div>
      </div>
    ),
  },
  {
    id: "conversation-permissions",
    title: "Conversation permissions",
    description:
      "Active grants have readable scopes, and each is taken back in one press.",
    render: () => <ConversationPermissionsExample />,
  },
];
