import { useState } from "react";
import {
  ApprovalPrompt,
  ActionHistory,
  SpecialistRunHistory,
} from "../ui/actions/index.js";
import { ArtifactDrawer, ArtifactPanel } from "../ui/artifacts/index.js";
import { Onboarding } from "../ui/onboarding/index.js";
import {
  CapabilityLibrary,
  ComponentEditor,
} from "../ui/capabilities/index.js";
import {
  WorkspacePicker,
  AppSidebar,
  SessionHeader,
  createWorkspaceState,
} from "../ui/app/index.js";
import {
  Composer,
  ConversationSkeleton,
  ConversationTimeline,
  ReasoningTrace,
  ContextShelf,
  MarkdownMessage,
  OutcomeCard,
  TaskPlan,
  UserTurn,
  WorkTrace,
  NewConversation,
} from "../ui/conversation/index.js";
import { LoadingSkeleton, Logo } from "../ui/shared/index.js";
import { BrowserPanel } from "../ui/browser/index.js";
import { JsonBlock, ToolCallView } from "../ui/actions/index.js";
import { ModelSettings } from "../ui/model/index.js";
import { UsagePanel } from "../ui/usage/index.js";
import { EvidencePanel } from "../ui/evidence/index.js";
import { TaskViewCard } from "../ui/views/index.js";
import { UserInputPrompt } from "../ui/user-input/index.js";
import { RewindMessage } from "../ui/rewind/index.js";
import { HistoryRecoveryGate } from "../ui/recovery/index.js";
import {
  demoCatalog,
  demoConnections,
  demoPlugins,
  demoProviders,
  demoUsage,
} from "./fixtures.js";
import { sampleBrowserFrame } from "./sampleBrowserFrame.js";

export type ComponentCatalogEntry = {
  id: string;
  title: string;
  description: string;
  className?: string;
  render: () => React.ReactNode;
};

const steps = [
  {
    id: "decisions",
    label: "Read architecture decisions",
    detail: "docs/decisions",
    status: "complete" as const,
  },
  {
    id: "history",
    label: "Read recent commits",
    detail: "12 commits in the current branch",
    status: "active" as const,
  },
];

const responseFixture = `## Project state

Zhiyin is a **local-first desktop agent** with typed boundaries between its renderer, agent loop, tools, and permission engine.

### What is working

- Conversation state survives a restart.
- File reads require an explicit permission decision.
- Provider usage is recorded from the response rather than reconstructed locally.

| Area | Current state | Next risk |
| --- | --- | --- |
| Desktop shell | Operational | Long-response layout |
| Permission flow | Connected | Broader tool coverage |
| Usage | Provider-reported | Empty-history guidance |

Technical identifiers such as \`read_file\` belong in audit detail, not in the ordinary progress view.`;

function ComponentEditorExample() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="button" type="button" onClick={() => setOpen(true)}>
        Open plugin component editor
      </button>
      {open && (
        <ComponentEditor
          draft={{
            kind: "skill",
            id: "release-notes",
            description: "Use when a release needs a concise public summary.",
            instructions:
              "Read the changes, group them by outcome, and cite checks.",
          }}
          onSave={async () => undefined}
          onRemove={async () => undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export const componentCatalog: ComponentCatalogEntry[] = [
  {
    id: "conversation-timeline",
    title: "Conversation timeline",
    description:
      "The main conversation surface, including message ordering, reasoning, work, and the completed outcome.",
    render: () => (
      <ConversationTimeline
        task={{
          id: "catalog-conversation",
          messages: [
            {
              id: "catalog-user",
              role: "user",
              text: "Prepare the release note and verify the result.",
              sequence: 1,
            },
            {
              id: "catalog-assistant",
              role: "assistant",
              text: "The release note is ready and the checks pass.",
              sequence: 2,
            },
          ],
          phase: {
            kind: "completed",
            outcome: {
              title: "Release note prepared",
              summary: "The draft was written and checked.",
              file: "release-notes.md",
            },
          },
        }}
        pieces={{
          actions: () => null,
          view: () => null,
          interaction: () => null,
        }}
      />
    ),
  },
  {
    id: "new-conversation",
    title: "New conversation",
    description:
      "The empty conversation invitation in its normal and unavailable states.",
    render: () => (
      <div className="lab-stack">
        <NewConversation onSuggestion={() => undefined} />
        <NewConversation disabled onSuggestion={() => undefined} />
      </div>
    ),
  },
  {
    id: "component-editor",
    title: "Plugin component editor",
    description:
      "The production editor for a reusable plugin component, with populated fields and removal available.",
    render: () => <ComponentEditorExample />,
  },
  {
    id: "history-recovery",
    title: "History recovery",
    description:
      "The startup choice shown when some saved conversations can be recovered and others are damaged.",
    render: () => (
      <HistoryRecoveryGate
        recovery={{
          readable: 4,
          damaged: 2,
          keptAt: "C:/Users/sam/AppData/Roaming/Zhiyin/history.damaged.json",
        }}
        onChoose={async () => undefined}
      />
    ),
  },
  {
    id: "reasoning-trace",
    title: "Reasoning trace",
    description: "Live reasoning stays readable before the answer arrives.",
    render: () => (
      <ReasoningTrace
        trace={{
          text: "I’m comparing the sources and checking their dates before drawing a conclusion.",
          status: "streaming",
        }}
      />
    ),
  },
  {
    id: "conversation-rewind",
    title: "Conversation rewind",
    description:
      "An in-place rewind review with an explicit file choice, recoverable paths, conflicts, and effects that remain.",
    render: () => (
      <RewindMessage
        taskId="catalog-task"
        messageId="catalog-message"
        bubble={
          <UserTurn text="Rewrite the release note and update the draft file." />
        }
        onPreview={async () => ({
          id: "catalog-rewind",
          taskId: "catalog-task",
          messageId: "catalog-message",
          draft: "Rewrite the release note and update the draft file.",
          discardedMessages: 4,
          discardedActions: [
            {
              id: "catalog-action",
              action: "Edit release note",
              target: "release-notes.md",
              status: "completed",
            },
          ],
          files: [
            {
              path: "release-notes.md",
              action: "restore",
              status: "recoverable",
            },
            {
              path: "notes/manual-edits.md",
              action: "restore",
              status: "conflict",
            },
          ],
        })}
        onCommit={async () => ({ files: [] })}
        onCommitted={() => undefined}
      />
    ),
  },
  {
    id: "clarifying-questions",
    title: "Clarifying questions",
    description:
      "One question at a time, with choices, written input, a review of every answer before sending, and no permission styling.",
    render: () => (
      <UserInputPrompt
        prompt={{
          id: "catalog-clarification",
          kind: "clarification",
          title: "Choose the release shape",
          questions: [
            {
              id: "audience",
              prompt: "Who should receive it first?",
              options: [
                {
                  id: "team",
                  label: "Internal team",
                  description: "Try it privately before a wider release.",
                },
                { id: "customers", label: "Customers" },
              ],
              allowText: true,
            },
            {
              id: "date",
              prompt: "What date should the release use?",
              allowText: true,
            },
          ],
        }}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ),
  },
  {
    id: "quiz",
    title: "Interactive quiz",
    description:
      "One question at a time, with immediate explanation, saved review, and an honest retry before the result is sent.",
    render: () => {
      const request = {
        kind: "quiz" as const,
        title: "Release readiness",
        questions: [
          {
            id: "presidential-powers",
            prompt:
              "Quels pouvoirs le Président exerce-t-il de manière propre, sans contreseing ministériel ?",
            answers: [
              { id: "appoint", label: "Il nomme le Premier ministre" },
              {
                id: "cabinet",
                label: "Il préside le conseil des ministres",
              },
              {
                id: "dissolve",
                label: "Il peut dissoudre l’Assemblée nationale",
              },
              { id: "policy", label: "Il dirige la politique de la nation" },
            ],
            selection: "multiple" as const,
            correctAnswerIds: ["appoint", "dissolve"],
            explanation:
              "La nomination du Premier ministre et la dissolution relèvent des pouvoirs propres énumérés par la Constitution.",
          },
          {
            id: "evidence",
            prompt: "Which checks count as product evidence?",
            answers: [
              { id: "unit", label: "Unit tests" },
              { id: "review", label: "Independent review" },
              { id: "installed", label: "Installed-app exercise" },
            ],
            selection: "multiple" as const,
            correctAnswerIds: ["review", "installed"],
            explanation:
              "Independent review and an installed-app exercise test the product beyond its implementation.",
          },
        ],
      };
      return (
        <UserInputPrompt
          prompt={{ id: "catalog-quiz", ...request }}
          onSubmit={() => undefined}
          onCancel={() => undefined}
        />
      );
    },
  },
  {
    id: "work-budget",
    title: "Renewable work checkpoint",
    description:
      "A bounded choice between another tool-round tranche and one final progress report.",
    render: () => (
      <UserInputPrompt
        prompt={{
          id: "catalog-work-budget",
          kind: "workBudget",
          title: "Continue working?",
          completedRounds: 24,
        }}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ),
  },
  {
    id: "diagram-view",
    title: "Diagram tool result",
    description:
      "Validated Mermaid with source review, zoom, keyboard pan, and explicit export.",
    render: () => (
      <TaskViewCard
        view={{
          id: "catalog-diagram",
          callId: "catalog-diagram",
          kind: "diagram",
          title: "Release path",
          source:
            "flowchart LR\n  Draft --> Review\n  Review -->|approved| Publish\n  Review -->|changes| Draft",
        }}
      />
    ),
  },
  {
    id: "chart-view",
    title: "Line chart tool result",
    description:
      "A data-forward chart plate with the exact underlying values one tab away.",
    render: () => (
      <TaskViewCard
        view={{
          id: "catalog-chart",
          callId: "catalog-chart",
          kind: "line-chart",
          title: "Weekly response time",
          source: JSON.stringify({
            kind: "line-chart",
            title: "Weekly response time",
            xLabel: "Week",
            yLabel: "Median response time",
            unit: "ms",
            series: [
              {
                name: "Current",
                points: [
                  { x: "W1", y: 480 },
                  { x: "W2", y: 420 },
                  { x: "W3", y: 355 },
                  { x: "W4", y: 310 },
                ],
              },
              {
                name: "Target",
                points: [
                  { x: "W1", y: 300 },
                  { x: "W2", y: 300 },
                  { x: "W3", y: 300 },
                  { x: "W4", y: 300 },
                ],
              },
            ],
          }),
        }}
      />
    ),
  },
  {
    id: "bar-chart-view",
    title: "Bar chart tool result",
    description:
      "Category comparison with a zero baseline and exact values in Data.",
    render: () => (
      <TaskViewCard
        view={{
          id: "catalog-bars",
          callId: "catalog-bars",
          kind: "bar-chart",
          title: "Requests by channel",
          source: JSON.stringify({
            kind: "bar-chart",
            title: "Requests by channel",
            xLabel: "Channel",
            yLabel: "Requests",
            categories: [
              { label: "Desktop", value: 42 },
              { label: "Web", value: 31 },
              { label: "API", value: 19 },
            ],
          }),
        }}
      />
    ),
  },
  {
    id: "scatter-chart-view",
    title: "Scatter plot tool result",
    description:
      "Numeric observations use both colour and marker shape to distinguish series.",
    render: () => (
      <TaskViewCard
        view={{
          id: "catalog-scatter",
          callId: "catalog-scatter",
          kind: "scatter-plot",
          title: "Quality and latency",
          source: JSON.stringify({
            kind: "scatter-plot",
            title: "Quality and latency",
            xLabel: "Latency",
            yLabel: "Quality",
            series: [
              {
                name: "Local",
                points: [
                  { x: 1, y: 8 },
                  { x: 2, y: 7 },
                ],
              },
              {
                name: "Remote",
                points: [
                  { x: 3, y: 9 },
                  { x: 4, y: 8 },
                ],
              },
            ],
          }),
        }}
      />
    ),
  },
  {
    id: "histogram-view",
    title: "Histogram tool result",
    description:
      "Observed values are binned deterministically and remain inspectable.",
    render: () => (
      <TaskViewCard
        view={{
          id: "catalog-histogram",
          callId: "catalog-histogram",
          kind: "histogram",
          title: "Turn duration",
          source: JSON.stringify({
            kind: "histogram",
            title: "Turn duration",
            xLabel: "Duration",
            unit: "s",
            values: [8, 9, 9, 10, 12, 14, 14, 15, 18, 22],
          }),
        }}
      />
    ),
  },
  {
    id: "box-plot-view",
    title: "Box plot tool result",
    description:
      "Distribution summaries preserve each source observation in Data.",
    render: () => (
      <TaskViewCard
        view={{
          id: "catalog-boxes",
          callId: "catalog-boxes",
          kind: "box-plot",
          title: "Latency by provider",
          source: JSON.stringify({
            kind: "box-plot",
            title: "Latency by provider",
            yLabel: "Latency",
            unit: "ms",
            groups: [
              { label: "A", values: [110, 130, 145, 180, 240] },
              { label: "B", values: [90, 120, 125, 140, 190] },
            ],
          }),
        }}
      />
    ),
  },
  {
    id: "diagram-edge-states",
    title: "Diagram edge states",
    description:
      "A rejected restored source and an oversized but scrollable view.",
    render: () => (
      <div className="lab-stack">
        <TaskViewCard
          view={{
            id: "catalog-bad-diagram",
            callId: "catalog-bad-diagram",
            kind: "diagram",
            title: "Damaged diagram",
            source: "flowchart ???",
          }}
        />
        <TaskViewCard
          view={{
            id: "catalog-wide-diagram",
            callId: "catalog-wide-diagram",
            kind: "diagram",
            title: "Long release train",
            source: `flowchart LR\n${Array.from({ length: 18 }, (_, index) => `S${index}[Stage ${index + 1}] --> S${index + 1}[Stage ${index + 2}]`).join("\n")}`,
          }}
        />
      </div>
    ),
  },
  {
    id: "diagram-model-colour",
    title: "Diagram with model-chosen colours",
    description:
      "A diagram whose author picked its own fills, including pale ones. Text has to stay readable on whatever ground it lands on, not on the ground the theme assumed.",
    render: () => (
      <TaskViewCard
        view={{
          id: "catalog-coloured-diagram",
          callId: "catalog-coloured-diagram",
          kind: "diagram",
          title: "Data review",
          source: [
            "flowchart TB",
            "  subgraph S1[1 · Collect & Load]",
            "    A[Raw data source]",
            "    B[First look]",
            "    A --> B",
            "  end",
            "  subgraph S2[2 · Assess Quality]",
            "    C[Missing values]",
            "  end",
            "  B --> C",
            "  D[Pale node]",
            "  C --> D",
            "  subgraph S3[3 · Multi-line labels]",
            "    E[PRÉSIDENT DE LA RÉPUBLIQUE<br/>Arbitre art. 5<br/>Chef des armées art. 15]",
            "    F(Rounded pale node)",
            "  end",
            "  D --> E",
            "  E --> F",
            "  style S1 fill:#eaf2ff,stroke:#5b7fbd",
            "  style E fill:#ffe4e1,stroke:#c0392b",
            "  style F fill:#ffe4e1,stroke:#c0392b",
            "  classDef pale fill:#fdf6e3,stroke:#b58900",
            "  class C pale",
            "  style S2 fill:#fdf1dc,stroke:#e0a13a",
            "  style D fill:#f6f6f2,stroke:#999999",
          ].join("\n"),
        }}
      />
    ),
  },
  {
    id: "diagram-class-styled",
    title: "Diagram with class-styled nodes",
    description:
      "The shape a model actually produces: classDef fills, multi-line labels, and labelled edges. Every label has to stay readable on whatever its author painted behind it.",
    render: () => (
      <TaskViewCard
        view={{
          id: "catalog-class-diagram",
          callId: "catalog-class-diagram",
          kind: "diagram",
          title:
            "Interactions des pouvoirs — Constitution du 4 octobre 1958 (consolidée au 8 mars 2024)",
          source: [
            "flowchart TB",
            'subgraph SOUVER["Souveraineté nationale"]',
            '  PEUPLE["LE PEUPLE<br/>Souveraineté nationale (art. 3)<br/>Suffrage universel, égal, secret (art. 3)"]',
            "end",
            'subgraph EXEC["Pouvoir exécutif (Titres II et III)"]',
            '  PRES["PRÉSIDENT DE LA RÉPUBLIQUE<br/>Arbitre (art. 5) · élu 5 ans au suffrage direct (art. 6)<br/>Chef des armées (art. 15)"]',
            '  GOV["GOUVERNEMENT / PREMIER MINISTRE<br/>Détermine et conduit la politique de la Nation (art. 20)"]',
            "end",
            'subgraph LEG["Pouvoir législatif (Titre IV)"]',
            '  PARL["PARLEMENT<br/>Vote la loi · contrôle le Gouvernement (art. 24)"]',
            '  AN["ASSEMBLÉE NATIONALE<br/>Députés, suffrage direct (art. 24)"]',
            "end",
            'PEUPLE -->|"Élit le Président (arts. 6-7)"| PRES',
            'PRES -->|"Nomme le Premier ministre (art. 8)"| GOV',
            'GOV -->|"Engagement de responsabilité (art. 49)"| AN',
            "classDef people fill:#fff8e1,stroke:#b8860b,stroke-width:2px",
            "classDef exec fill:#ffe3e3,stroke:#c0392b,stroke-width:2px",
            "classDef legis fill:#e3f0ff,stroke:#1f5fa8,stroke-width:2px",
            "class PEUPLE people",
            "class PRES,GOV exec",
            "class PARL,AN legis",
          ].join("\n"),
        }}
      />
    ),
  },
  {
    id: "chart-edge-states",
    title: "Chart edge states",
    description:
      "Single-value data remains honest; malformed empty and oversized inputs stay contained.",
    render: () => (
      <div className="lab-stack">
        <TaskViewCard
          view={{
            id: "catalog-single",
            callId: "catalog-single",
            kind: "histogram",
            title: "One observation",
            source: JSON.stringify({
              kind: "histogram",
              title: "One observation",
              values: [12],
            }),
          }}
        />
        <TaskViewCard
          view={{
            id: "catalog-empty",
            callId: "catalog-empty",
            kind: "histogram",
            title: "Empty data",
            source: JSON.stringify({
              kind: "histogram",
              title: "Empty data",
              values: [],
            }),
          }}
        />
        <TaskViewCard
          view={{
            id: "catalog-too-many",
            callId: "catalog-too-many",
            kind: "line-chart",
            title: "Too many series",
            source: JSON.stringify({
              kind: "line-chart",
              title: "Too many series",
              series: Array.from({ length: 9 }, (_, index) => ({
                name: `S${index}`,
                points: [{ x: 1, y: index }],
              })),
            }),
          }}
        />
      </div>
    ),
  },
  {
    id: "onboarding",
    title: "Onboarding",
    description: "Choose starting plugins without restricting future work.",
    render: () => <Onboarding onComplete={async () => {}} />,
  },
  {
    id: "library",
    title: "Plugin directory",
    description: "Every skill, specialist, and connector, grouped by plugin.",
    render: () => (
      <CapabilityLibrary
        plugins={demoPlugins}
        mcpServers={demoConnections}
        onClose={() => {}}
        onTogglePlugin={async () => {}}
        onInstallPlugin={async () => ({ status: "cancelled" })}
        onUpdatePlugin={async () => ({ status: "cancelled" })}
        onRollbackPlugin={async () => {}}
        onRemovePlugin={async () => {}}
        onCreatePlugin={async () => {}}
        onLoadEditableContents={async () => undefined}
        onSavePluginContents={async () => {}}
        onToggleComponent={async () => {}}
        onLoadComponentContent={async () => undefined}
        onOverrideComponent={async () => {}}
        onResetComponent={async () => {}}
        onInstallToolchain={async () => {}}
        onTestConnection={async () => ({
          ok: true,
          tools: [{ name: "search", description: "Search.", enabled: true }],
        })}
        onSetConnectionToolEnabled={async () => {}}
        onSaveConnectionToken={async () => {}}
        onClearConnectionToken={async () => {}}
        onRefreshConnections={async () => {}}
        onCheckShell={async () => ({ available: true })}
        onRecheckShell={async () => ({ available: true })}
        onOpenExternalUrl={async () => {}}
      />
    ),
  },
  {
    id: "identity",
    title: "Identity",
    description: "The supplied SVG at every product size.",
    className: "lab-section--brand",
    render: () => (
      <div className="lab-brand">
        <Logo size={72} />
        <div className="lab-brand__sizes">
          <span className="lab-mark lab-mark--large">
            <Logo compact size={48} />
          </span>
          <span className="lab-mark lab-mark--medium">
            <Logo compact size={30} />
          </span>
          <span className="lab-mark lab-mark--small">
            <Logo compact size={18} />
          </span>
        </div>
      </div>
    ),
  },
  {
    id: "model-response",
    title: "Model response",
    description:
      "Structured long-form output with headings, lists, code, and wide data.",
    render: () => (
      <div className="lab-response">
        <MarkdownMessage>{responseFixture}</MarkdownMessage>
      </div>
    ),
  },
  {
    id: "permission",
    title: "Permission",
    description:
      "A compact decision row with technical detail on demand; a long script, which scrolls inside the card so the decision stays in view; the same row for a command whose effect only Zhiyin can describe; and the same row when the action would replace existing work, where the change is reviewed as a difference rather than as the call.",
    render: () => (
      <div className="lab-stack">
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
          detail="This runs in Zhiyin Desktop and can read, change, or delete files there, reach the network, and start other programs. It cannot be undone."
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
            detail="This starts in TestOnlineZhiyin but is not confined to that folder. It can read, change, or delete any files your account can access, reach the network, and start other programs. It cannot be undone."
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
    id: "task-plan",
    title: "Task plan",
    description:
      "Ordered work with observable criteria and explicit verification states.",
    render: () => (
      <div className="lab-narrow">
        <TaskPlan
          items={[
            {
              id: "plan-1",
              title: "Review project evidence",
              criterion:
                "The release summary is supported by decisions and commit history.",
              status: "verified",
              verification:
                "Architecture decisions and 12 commits were reviewed.",
            },
            {
              id: "plan-2",
              title: "Publish the reviewed draft",
              criterion:
                "The approved draft is available at the documentation site.",
              status: "active",
            },
          ]}
        />
      </div>
    ),
  },
  {
    id: "work-trace",
    title: "Work trace",
    description:
      "Concrete action progress used when task guidance is unavailable.",
    render: () => (
      <div className="lab-narrow">
        <WorkTrace steps={steps} />
      </div>
    ),
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
              detail:
                "This starts in Zhiyin Desktop but is not confined to that folder. It can read, change, or delete any files your account can access.",
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
            task: "Review the proposed change for regressions.",
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
              summary: "The change is covered by an existing regression test.",
              findings: ["A regression test exercises the changed behavior."],
              recommendations: ["Keep the test in the release gate."],
              limitations: [],
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
    id: "context",
    title: "Context shelf",
    description: "Only relevant files or browser context; never a second plan.",
    render: () => (
      <div className="lab-shelves">
        <ContextShelf
          context={{
            kind: "workspace",
            project: "Zhiyin Desktop",
            files: [
              { name: "release-notes.md", meta: "Edited · 2 min ago" },
              { name: "changelog.md", meta: "Read" },
            ],
            changes: "+42 −8",
          }}
        />
        <ContextShelf
          context={{
            kind: "browser",
            title: "Zhiyin documentation",
            url: "docs.zhiyin.app/releases/new",
          }}
        />
      </div>
    ),
  },
  {
    id: "composer",
    title: "Composer",
    description:
      "Normal, running, and decision-paused states, and the folder picker that scopes the next message. The picker opens upward, since the composer sits at the bottom of the window. Running dims the field alone and lights the edge; paused dims the whole bar and shows the reason.",
    render: () => (
      <div className="lab-stack">
        <Composer
          scope={
            <WorkspacePicker
              current={{ path: "C:/work/reports", name: "reports" }}
              recent={[
                { path: "C:/work/reports", name: "reports" },
                { path: "C:/work/notes", name: "notes" },
                { path: "C:/work/quarterly-site", name: "quarterly-site" },
              ]}
              onChoose={() => undefined}
              onUseRecent={() => undefined}
            />
          }
        />
        <Composer
          running
          onStop={() => undefined}
          onAddContext={() => undefined}
          reasoningCapabilities={{
            status: "available",
            required: false,
            defaultEnabled: true,
            defaultEffort: "medium",
            efforts: ["low", "medium", "high"],
          }}
          scope={
            <WorkspacePicker
              disabled
              current={{ path: "C:/work/reports", name: "reports" }}
              recent={[]}
            />
          }
        />
        <Composer
          scope={<WorkspacePicker onChoose={() => undefined} />}
          disabledReason="Answer the permission request first"
          disabledPlaceholder="Waiting for your decision"
        />
      </div>
    ),
  },
  {
    id: "reasoning-controls",
    title: "Reasoning control, in the states a model can put it in",
    description:
      "Reasoning the model requires, so there is nothing to turn off; reasoning a model offers but nobody has turned on; and a model that cannot report its reasoning settings at all, where the control says so rather than offering a choice it cannot honour.",
    render: () => (
      <div className="lab-stack">
        <Composer
          onAddContext={() => undefined}
          reasoningCapabilities={{
            status: "available",
            required: true,
            defaultEnabled: true,
            defaultEffort: "max",
            efforts: ["low", "high", "max"],
          }}
        />
        <Composer
          onAddContext={() => undefined}
          reasoningCapabilities={{
            status: "available",
            required: false,
            defaultEnabled: false,
            defaultEffort: "low",
            efforts: ["low", "medium", "high"],
          }}
          initialReasoning={{ enabled: false }}
        />
        <Composer
          onAddContext={() => undefined}
          reasoningCapabilities={{
            status: "unavailable",
            reason: "Reasoning settings are unavailable for this model.",
          }}
        />
      </div>
    ),
  },
  {
    id: "frame",
    title: "App frame",
    description: "Navigation, task header, and completed-result handoff.",
    render: () => (
      <div className="lab-frame-parts">
        <div className="lab-sidebar">
          <AppSidebar
            selectedId="release"
            onSelect={() => undefined}
            tasks={[
              {
                id: "release",
                title: "Prepare v0.1 release notes",
                meta: "Now",
              },
              { id: "audit", title: "Audit dependencies", meta: "Yesterday" },
            ]}
          />
        </div>
        <div className="lab-frame-parts__main">
          <SessionHeader
            workspace="Zhiyin Desktop"
            title="Prepare v0.1 release notes"
          />
          <div>
            <OutcomeCard
              title="Release notes are ready"
              file="release-notes.md"
              summary="12 commits distilled into a concise public draft."
            />
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "artifacts",
    title: "Produced files",
    description:
      "Files a task created or replaced, with review, save, and the states a file can be in afterwards. The panel renders nothing when a task has produced none.",
    render: () => (
      <ArtifactPanel
        artifacts={[
          {
            path: "reports/release-brief.md",
            name: "release-brief.md",
            change: "created",
            bytes: 1536,
            updatedAt: "2026-09-05T10:00:00.000Z",
          },
          {
            path: "notes.md",
            name: "notes.md",
            change: "updated",
            bytes: 240,
            updatedAt: "2026-09-05T10:05:00.000Z",
          },
          {
            path: "archive/very-long-generated-file-name-for-overflow.md",
            name: "very-long-generated-file-name-for-overflow.md",
            change: "created",
            bytes: 2_400_000,
            updatedAt: "2026-09-05T10:06:00.000Z",
          },
        ]}
        onPreview={async (path) =>
          path === "notes.md"
            ? {
                status: "missing",
                path,
                reason:
                  "notes.md is no longer in the workspace. It may have been moved, renamed, or deleted outside Zhiyin.",
              }
            : {
                status: "ready",
                path,
                text: [
                  "# Release brief",
                  "",
                  "Twelve commits, distilled for a public audience.",
                ].join("\n"),
                truncated: path.startsWith("archive/"),
              }
        }
        onExport={async (path) =>
          path === "notes.md"
            ? {
                status: "failed",
                reason:
                  "notes.md could not be saved to that location. Check that the folder exists and allows changes.",
              }
            : {
                status: "saved",
                destination: String.raw`C:\Users\sam\Desktop\release-brief.md`,
              }
        }
      />
    ),
  },
  {
    id: "files-drawer",
    title: "Produced files, in place",
    description:
      "The same list as it appears in the app: a panel over the right of the conversation, opened from the session header and closed with Escape.",
    render: () => (
      <div className="lab-drawer-stage">
        <ArtifactDrawer
          open
          onClose={() => undefined}
          artifacts={[
            {
              path: "reports/release-brief.md",
              name: "release-brief.md",
              change: "created",
              bytes: 1536,
              updatedAt: "2026-09-05T10:00:00.000Z",
            },
            {
              path: "notes.md",
              name: "notes.md",
              change: "updated",
              bytes: 240,
              updatedAt: "2026-09-05T10:05:00.000Z",
            },
          ]}
          onPreview={async (path) => ({
            status: "ready",
            path,
            text: "The finished brief.",
            truncated: false,
          })}
          onExport={async () => ({ status: "cancelled" })}
        />
      </div>
    ),
  },
  {
    id: "model-settings",
    title: "Model and providers",
    description:
      "Choosing a model, then the upstreams that may serve it, against a live catalogue.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface">
        <ModelSettings
          settings={createWorkspaceState().provider}
          onClose={() => undefined}
          onListModels={async () => demoCatalog}
          onListModelProviders={async (model) => ({
            status: "ready",
            model,
            providers: demoProviders,
          })}
          onSelectModel={async () => {}}
          onSaveApiKey={async () => ({ status: "accepted" as const })}
          onClearApiKey={async () => {}}
        />
      </div>
    ),
  },
  {
    id: "model-settings-configured",
    title: "Model and providers, with a key stored",
    description:
      "The same page once a key exists: models to choose from, the upstreams that serve one, and a stored model the catalogue no longer lists — which says so and stays the choice, rather than being quietly replaced by one that does exist.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface">
        <ModelSettings
          settings={{
            model: "z-ai/glm-4.9-retired",
            providers: [],
            endpoint: "https://openrouter.ai/api/v1/chat/completions",
            credential: { status: "configured", source: "credentialStore" },
          }}
          onClose={() => undefined}
          onListModels={async () => demoCatalog}
          onListModelProviders={async (model) => ({
            status: "ready",
            model,
            providers: demoProviders,
          })}
          onSelectModel={async () => {}}
          onSaveApiKey={async () => ({ status: "accepted" as const })}
          onClearApiKey={async () => {}}
        />
      </div>
    ),
  },
  {
    id: "usage",
    title: "Usage instruments",
    description: "Real request, model, and cost data rendered visually.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface lab-feature-surface--page">
        <UsagePanel availability={demoUsage} onClose={() => undefined} />
      </div>
    ),
  },
  {
    id: "private-evidence",
    title: "Private evidence and recovery",
    description:
      "Local correction history, recovery usage, retention limits, and explicit deletion.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface lab-feature-surface--page">
        <EvidencePanel
          onClose={() => undefined}
          read={async () => ({
            corrections: {
              retainedEntries: 3,
              shownEntries: 3,
              maximumEntries: 5000,
              entries: [
                {
                  at: "2026-09-13T08:12:00.000Z",
                  taskId: "catalog-task",
                  taskTitle: "Prepare a report",
                  toolName: "run_python",
                  kind: "quiet-retry",
                  reason:
                    "The call arrived with its arguments encoded twice and was sent again.",
                },
                {
                  at: "2026-09-13T08:41:00.000Z",
                  taskId: "catalog-task",
                  taskTitle: "Prepare a report",
                  toolName: "read_file",
                  kind: "repair-applied",
                  reason:
                    "The path was given relative to the wrong folder and was rewritten.",
                  before: '{ "path": "notes/summary.md" }',
                  after: '{ "path": "report/notes/summary.md" }',
                },
                {
                  at: "2026-09-13T09:00:00.000Z",
                  taskId: "catalog-task",
                  taskTitle: "Prepare a report",
                  toolName: "write_file",
                  kind: "repair-rejected",
                  reason: "The proposed repair changed approved content.",
                  cause: "content-changed",
                  before: '{ "path": "report/summary.md", "text": "…" }',
                  after: '{ "path": "report/summary.md", "text": "… (2)" }',
                },
              ],
            },
            recovery: {
              usedBytes: 61_204_480,
              retainedFiles: 24,
              excludedFiles: 1,
              limits: {
                totalBytes: 256 * 1024 * 1024,
                fileBytes: 10 * 1024 * 1024,
                versionsPerPath: 10,
                maximumAgeDays: 30,
              },
            },
            policy: {
              taskDeletion:
                "Deleting a conversation deletes its saved transcript and derived context.",
              correctionRedaction:
                "Common credential fields are removed; arbitrary sensitive text cannot be detected reliably.",
              privateStorage:
                "Private evidence stays on this computer and outside usage telemetry.",
            },
          })}
          clear={async () => {
            throw new Error("Deletion is disabled in the component catalog.");
          }}
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
  {
    id: "agent-browser",
    title: "The agent's browser",
    description:
      "The right-hand rail while a page is open. The person watches the page the agent is working on, and can click and type into it.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface lab-feature-surface--rail">
        <BrowserPanel
          browser={{
            status: "open",
            url: "https://example.com/pricing",
            title: "Pricing — Example",
            loading: false,
            frame: { data: sampleBrowserFrame, width: 560, height: 420 },
          }}
          onDrive={() => undefined}
        />
      </div>
    ),
  },
  {
    id: "agent-browser-unavailable",
    title: "The agent's browser, with nothing to show",
    description:
      "Opening, and failed. A browser that cannot run says so where the page would have been, rather than showing an empty frame.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface lab-feature-surface--rail">
        <BrowserPanel
          browser={{ status: "opening", url: "", title: "", loading: true }}
          onDrive={() => undefined}
        />
        <BrowserPanel
          browser={{
            status: "failed",
            url: "",
            title: "",
            loading: false,
            reason:
              "No supported browser could be started. Tried msedge; chrome.",
          }}
          onDrive={() => undefined}
        />
      </div>
    ),
  },
  {
    id: "loading",
    title: "Loading placeholders",
    description:
      "Content-shaped placeholders preserve layout without faking progress.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-loading-grid">
        <ConversationSkeleton label="Loading task preview" />
        <LoadingSkeleton label="Loading list preview" />
      </div>
    ),
  },
];
