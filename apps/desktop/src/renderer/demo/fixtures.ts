import { defaultLook, emptyConversationLists } from "@zhiyin/contract";
import { demoOpenRouter as demoOpenRouterSettings } from "./fixtures/models.js";
import {
  type WindowState,
  type WorkspaceTask,
  createWindowState,
} from "../ui/app/index.js";
import { demoUsage } from "./fixtures/usage.js";
import { demoSpelling } from "./fixtures/spelling.js";
import { demoPlugins, demoConnections } from "./fixtures/capabilities.js";
import { chartPlace, reportPlace, shownReport } from "./fixtures/documents.js";
import { demoMemory } from "./fixtures/memory.js";
import { demoUpdateReady } from "./fixtures/updates.js";
import { sampleBrowserFrame } from "./sampleBrowserFrame.js";
export { demoUsage, demoUsageWithEstimates } from "./fixtures/usage.js";
export {
  demoCatalog,
  demoDeepSeekMainland,
  demoLabCatalog,
  demoLabSummaries,
  demoModelList,
  demoOpenRouter,
  demoProviders,
  demoProviderSummaries,
} from "./fixtures/models.js";
export {
  demoPlugins,
  demoConnections,
  demoCheck,
  demoComponentContent,
  demoImportedPlugin,
} from "./fixtures/capabilities.js";

const releaseTask: WorkspaceTask = {
  id: "release",
  title: "Prepare v0.1 release notes",
  updatedLabel: "Now",
  updatedAt: "2026-10-05T09:00:00.000Z",
  ...emptyConversationLists,
  messages: [
    {
      id: "release-user",
      role: "user",
      text: "Prepare the v0.1 release notes from the project history. Keep them useful for non-technical users, verify every claim, then publish the final draft.",
      sequence: 0,
    },
    {
      id: "release-assistant-plan",
      role: "assistant",
      text: "I’ll review the decisions and recent commits first, then draft only the changes the project history supports.",
      sequence: 1,
    },
  ],
  actions: [],
  plan: [
    { id: "plan-1", title: "Review project evidence", status: "in_progress" },
    { id: "plan-2", title: "Prepare the release draft", status: "pending" },
    { id: "plan-3", title: "Publish after approval", status: "pending" },
  ],
  phase: {
    kind: "working",
    note: "Reading docs/decisions and the last 12 commits",
    steps: [],
  },
};

const historyTasks: WorkspaceTask[] = [
  {
    id: "audit",
    title: "Audit dependencies",
    updatedLabel: "Yesterday",
    updatedAt: "2026-10-05T09:00:00.000Z",
    ...emptyConversationLists,
    messages: [],
    phase: {
      kind: "completed",
      outcome: {
        title: "Dependency audit complete",
        summary: "No unresolved critical findings were recorded.",
      },
    },
  },
  {
    id: "onboarding",
    title: "Plan the onboarding guide",
    updatedLabel: "Mon",
    updatedAt: "2026-10-05T09:00:00.000Z",
    ...emptyConversationLists,
    messages: [],
    phase: { kind: "interrupted" },
  },
  {
    id: "permission",
    title: "Review permission boundaries",
    updatedLabel: "Aug 29",
    updatedAt: "2026-10-05T09:00:00.000Z",
    ...emptyConversationLists,
    messages: [],
    phase: {
      kind: "completed",
      outcome: {
        title: "Boundary review complete",
        summary: "The permission invariants were traced to named tests.",
      },
    },
  },
];

/** What a demo action that only reads declares. */
const readsOnly = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
} as const;

export type DemoScenario =
  | "new"
  | "first-run"
  | "no-model"
  | "thinking"
  | "required-reasoning"
  | "waiting-message"
  | "working"
  | "quiz"
  | "folder-instructions"
  | "approval"
  | "connected-tool"
  | "browser"
  | "document"
  | "done"
  | "condensing"
  | "loading"
  | "plugins"
  | "long"
  | "damaged"
  | "update";

const demoScenarios = new Set<DemoScenario>([
  "new",
  "first-run",
  "no-model",
  "thinking",
  "required-reasoning",
  "waiting-message",
  "working",
  "quiz",
  "folder-instructions",
  "approval",
  "connected-tool",
  "browser",
  "document",
  "done",
  "condensing",
  "loading",
  "plugins",
  "long",
  "damaged",
  "update",
]);

export function demoScenarioFromSearch(search: string): DemoScenario {
  const scenario = new URLSearchParams(search).get("scenario");
  return scenario && demoScenarios.has(scenario as DemoScenario)
    ? (scenario as DemoScenario)
    : "working";
}

/** The model the demo answers on, chosen and with its key saved. */
const demoModelReady: WindowState["provider"] = {
  provider: demoOpenRouterSettings,
  model: "anthropic/claude-sonnet-5",
  modelName: "Anthropic: Claude Sonnet 5",
  endpoint: "https://openrouter.ai/api/v1/chat/completions",
  credential: { status: "configured", source: "credentialStore" },
};

/**
 * The window a scenario opens on. Every scenario answers on a chosen model,
 * except a first run and the new-task page before a model is set up.
 */
export function createDemoWindowState(
  scenario: DemoScenario = "working",
): WindowState {
  const state = scenarioState(scenario);
  if (scenario === "first-run" || scenario === "no-model") return state;
  return {
    ...state,
    provider: {
      ...demoModelReady,
      ...(state.provider.reasoning
        ? { reasoning: state.provider.reasoning }
        : {}),
    },
  };
}

function scenarioState(scenario: DemoScenario): WindowState {
  // Before the welcome is answered: what for, the model, then the look.
  if (scenario === "first-run")
    return {
      ...createWindowState({
        connection: "ready",
        runtime: { tasks: "available", capabilities: "available" },
        preferences: { onboarded: false, interests: [] },
        plugins: demoPlugins,
      }),
      look: defaultLook,
    };

  // Welcomed, with the model left for later: the new-task page offers it.
  if (scenario === "no-model")
    return createWindowState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      plugins: demoPlugins,
      mcpServers: demoConnections,
      usage: demoUsage,
    });

  if (scenario === "loading") {
    return createWindowState({
      connection: "loading",
      runtime: { tasks: "available", capabilities: "available" },
      plugins: demoPlugins,
      mcpServers: demoConnections,
    });
  }

  // Filled by the stream that runs in it, the way the core fills the window.
  if (scenario === "long")
    return createWindowState({
      connection: "loading",
      runtime: { tasks: "available", capabilities: "available" },
    });

  if (scenario === "new") {
    return createWindowState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      tasks: historyTasks,
      plugins: demoPlugins,
      mcpServers: demoConnections,
      usage: demoUsage,
    });
  }

  // Two conversations that will not open, and a report about the whole app:
  // only the selected conversation's report shows, in its place.
  if (scenario === "damaged") {
    const kept =
      "C:\\Users\\sam\\AppData\\Roaming\\Zhiyin\\damaged-history\\history-2026-10-05T15-34-08-138Z";
    const damaged = [
      { id: "rapport", title: "Rapport enseignement en maternelle" },
      { id: "budget", title: "Budget 2026" },
    ];
    return createWindowState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      tasks: historyTasks,
      conversations: [
        ...damaged.map(({ id, title }) => ({
          id,
          title,
          titleSource: "generated" as const,
          updatedAt: "2026-10-05T10:00:00.000Z",
          updatedLabel: "Today",
        })),
        ...historyTasks.map(({ id, title, updatedAt, updatedLabel }) => ({
          id,
          title,
          titleSource: "generated" as const,
          updatedAt,
          updatedLabel,
        })),
      ],
      selectedTaskId: "rapport",
      issues: [
        ...damaged.map(({ id, title }) => ({
          message: `“${title}” is damaged and can't be opened. Your other conversations are unaffected.`,
          keptAt: kept,
          conversationId: id,
          canDelete: true as const,
        })),
        {
          message:
            "Plugins could not be refreshed. What is shown may be out of date.",
        },
      ],
      plugins: demoPlugins,
      mcpServers: demoConnections,
      usage: demoUsage,
    });
  }

  if (scenario === "plugins") {
    return createWindowState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      surface: "library",
      pluginDirectory: "ready",
      tasks: historyTasks,
      plugins: demoPlugins,
      mcpServers: demoConnections,
      usage: demoUsage,
    });
  }

  // A copy each scenario then changes in place.
  const task: { -readonly [Key in keyof WorkspaceTask]: WorkspaceTask[Key] } =
    structuredClone(releaseTask);
  task.updatedAt = new Date().toISOString();
  if (scenario === "thinking") {
    task.messages = task.messages.slice(0, 1);
    task.actions = [];
    task.plan = [];
    task.phase = { kind: "working", steps: [] };
  }
  // A model that always reasons: the composer's reasoning control cannot be
  // turned off. What it is reasoning shows under the status while it arrives.
  if (scenario === "required-reasoning" || scenario === "waiting-message") {
    task.title = "Cinema landing page";
    task.messages = [
      {
        id: "cinema-user",
        role: "user",
        text: "Build a landing page for the films we found. Give each film room to stand out, and make it work on smaller screens.",
        sequence: 0,
      },
      {
        id: "cinema-reasoning",
        role: "assistant",
        text: "",
        sequence: 1,
        reasoning: {
          status: "streaming",
          text: "The research is ready. I need to turn the film list into a page that feels like a cinema programme, with a clear way to compare the titles.\n\nI’ll start with a wide featured film, then a grid for the remaining titles. Each card should carry the title, genre, and a short description. The visual hierarchy should come from typography and spacing, so it still works without poster images.\n\nOn a narrow screen, the grid can become one column. The navigation should stay reachable by keyboard, and hover effects should have a focus equivalent.\n\nBefore writing the page, I’m checking that the layout can accommodate a long title without pushing the other cards out of alignment.",
        },
      },
    ];
    task.actions = [];
    task.plan = [];
    task.reasoning = { enabled: true, effort: "high" };
    task.phase = { kind: "working", steps: [], note: "Thinking" };
  }
  // What the person added while the model reasons: in the conversation at
  // once, waiting for the next step, the last of them long enough to wrap.
  if (scenario === "waiting-message") {
    task.guidance = [
      { id: "cinema-added-1", text: "Use the dark theme.", status: "pending" },
      {
        id: "cinema-added-2",
        text: "And put the opening times above the film list, not below it: people look for those first, then choose a film.",
        status: "pending",
      },
    ];
  }
  if (scenario === "quiz") {
    task.title = "Institutions de la Ve République";
    task.messages = [
      {
        id: "quiz-user",
        role: "user",
        text: "Fais-moi réviser les institutions de la Ve République.",
        sequence: 0,
      },
      {
        id: "quiz-assistant",
        role: "assistant",
        text: "Commençons par les pouvoirs propres du Président.",
        sequence: 1,
      },
    ];
    task.actions = [];
    task.plan = [];
    task.phase = {
      kind: "input",
      steps: [],
      prompt: {
        id: "quiz-preview",
        kind: "quiz",
        title: "Institutions de la Ve République — barreau",
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
            selection: "multiple",
            correctAnswerIds: ["appoint", "dissolve"],
            explanation:
              "La nomination du Premier ministre et la dissolution relèvent des pouvoirs propres énumérés par la Constitution.",
          },
          {
            id: "censure",
            prompt: "Pour qu’une motion de censure soit adoptée, il faut :",
            answers: [
              {
                id: "absolute-members",
                label: "La majorité absolue des membres composant l’Assemblée",
              },
              {
                id: "expressed",
                label: "La majorité absolue des suffrages exprimés",
              },
              {
                id: "two-thirds",
                label: "La majorité des deux tiers des suffrages exprimés",
              },
            ],
            selection: "single",
            correctAnswerIds: ["absolute-members"],
            explanation:
              "L’article 49 compte uniquement les votes favorables et exige la majorité des membres composant l’Assemblée.",
          },
        ],
      },
    };
  }
  // A folder's instructions long enough to scroll, asked before the first
  // answer: the question shares the window with the composer under it.
  if (scenario === "folder-instructions") {
    task.messages = task.messages.slice(0, 1);
    task.actions = [];
    task.plan = [];
    task.phase = {
      kind: "input",
      steps: [],
      prompt: {
        id: "folder-instructions-preview",
        kind: "folderInstructions",
        title: "Use these folder instructions?",
        path: "AGENTS.md",
        text: [
          "# Quarterly reports",
          "",
          ...Array.from(
            { length: 40 },
            (_, line) =>
              `${line + 1}. Figures come from the shared sheet; never round a percentage past one decimal.`,
          ),
        ].join("\n"),
        truncated: false,
      },
    };
  }
  if (scenario === "approval" || scenario === "connected-tool") {
    task.actions = [
      {
        id: "read-decisions",
        action: "Read architecture decisions",
        description: "Check the decisions that constrain the release summary.",
        descriptionBy: "model",
        target: "docs/decisions",
        status: "completed",
        sequence: 2,
        effects: { ...readsOnly, reads: "workspace" },
      },
      {
        id: "read-history",
        action: "Read recent commits",
        description: "Identify changes included in this release.",
        descriptionBy: "model",
        target: "12 commits on the current branch",
        status: "completed",
        sequence: 3,
        effects: { ...readsOnly, reads: "workspace" },
      },
    ];
    task.messages = [
      ...task.messages,
      {
        id: "release-assistant",
        role: "assistant",
        text: "The release draft is ready. Publishing is the remaining external action, so I need your decision before sending it to the documentation site.",
        sequence: 4,
      },
    ];
    task.plan = task.plan.map((item, index) => ({
      ...item,
      status: index < 2 ? "done" : "in_progress",
    }));
    task.phase = {
      kind: "approval",
      steps: [],
      prompt:
        scenario === "approval"
          ? {
              id: "publish",
              action: "Run a command",
              target: "pnpm docs:publish --production",
              reason:
                "Publish the reviewed draft to the public documentation site.",
              reasonByModel: true,
              command:
                'run_command({"command":"pnpm docs:publish --production"})',
              invocation: {
                name: "run_command",
                arguments: [
                  {
                    name: "command",
                    value: "pnpm docs:publish --production",
                    runs: true,
                  },
                  { name: "Stops after", value: "10 min", readable: true },
                ],
              },
              effects: {
                reads: "elsewhere",
                changes: "elsewhere",
                sends: "chosen",
                actsAsPerson: "none",
                runs: "full-access",
                lasting: false,
                brings: "outside",
              },
              why: { code: "full-access" },
            }
          : {
              id: "wiki",
              action: "Team wiki · Update page",
              target: "Team wiki",
              reason: "Add the release to the team's checklist page.",
              reasonByModel: true,
              command:
                'mcp__team-standards__wiki__update_page({"page_id":"release-checklist","body":"…"})',
              destinations: ["https://wiki.example.com/mcp"],
              invocation: {
                name: "update_page",
                via: "https://wiki.example.com/mcp",
                arguments: [
                  {
                    name: "page_id",
                    value: '"release-checklist"',
                    described: "The page to change.",
                  },
                  {
                    name: "body",
                    value:
                      '"## Release 0.4\n\n- Check the changelog\n- Tag the release"',
                    described: "The page's new text, in Markdown.",
                  },
                ],
              },
              why: { code: "connected-tool" },
              conversationRule: {
                label: "Team wiki · Update page",
                scope: "tool",
              },
            },
    };
  }
  if (scenario === "browser") {
    task.phase = {
      kind: "working",
      note: "Checking the documentation preview",
      steps: [
        {
          id: "preview",
          label: "Open the documentation preview",
          detail: "docs.zhiyin.app/releases/new",
          status: "active",
        },
      ],
    };
  }
  if (
    scenario === "done" ||
    scenario === "condensing" ||
    scenario === "document"
  ) {
    task.plan = task.plan.map((item) => ({ ...item, status: "done" }));
    task.messages = [
      ...task.messages,
      {
        id: "release-assistant",
        role: "assistant",
        text: `## Release notes ready

I checked the draft against the current branch and architecture decisions.

### Included

- A concise summary for non-technical readers
- Verified descriptions of the permission and usage work
- Links checked against their primary sources

| Check | Result |
| --- | --- |
| Commit claims | Verified |
| Architecture claims | Verified |
| Public links | Verified |

The final artifact is attached below.${
          scenario === "document"
            ? `

The revenue figures are on [page 2](${reportPlace.path}#page=2) of the report, and the trend is in [the chart](${chartPlace.path}). A citation past the end, [page 9](${reportPlace.path}#page=9), is refused.`
            : ""
        }`,
        sequence: 4,
      },
    ];
    task.phase = {
      kind: "completed",
      outcome: {
        title: "Release notes are ready",
        summary:
          "The draft was checked against project history and published with verified links.",
      },
    };
    task.actions = [
      {
        id: "read-decisions",
        action: "Read architecture decisions",
        description: "Check the decisions that constrain the release summary.",
        descriptionBy: "model",
        effects: { ...readsOnly, reads: "workspace" },
        target: "docs/decisions",
        status: "completed",
        sequence: 2,
      },
      {
        id: "read-history",
        action: "Read recent commits",
        description: "Identify changes included in this release.",
        descriptionBy: "model",
        effects: { ...readsOnly, reads: "workspace" },
        target: "12 commits on the current branch",
        status: "completed",
        sequence: 3,
      },
    ];
  }
  // The report the conversation compiled, shown beside it, with the browser
  // it checked the figures in still open: both surfaces, so the choice shows.
  if (scenario === "document")
    task.artifacts = [
      {
        ...reportPlace,
        change: "created",
        bytes: 3_639,
        updatedAt: "2026-10-03T09:00:00.000Z",
      },
      {
        ...chartPlace,
        change: "created",
        bytes: 6_146,
        updatedAt: "2026-10-03T09:00:00.000Z",
      },
      {
        path: "reports/q3-notes.md",
        name: "q3-notes.md",
        change: "updated",
        bytes: 1_204,
        updatedAt: "2026-10-03T09:00:00.000Z",
      },
    ];
  if (scenario === "condensing") {
    task.condensedThrough = "release-assistant-plan";
    task.condensings = [
      {
        id: "demo-condensing",
        sequence: 3.5,
        createdAt: "2026-10-02T09:00:00.000Z",
        targetTokens: 60_000,
        tokensBefore: 118_400,
        outcome: "condensed",
        revision: 1,
        throughMessageId: "release-assistant-plan",
        tokensAfter: 21_300,
        messages: 18,
        actions: 42,
        summary:
          "## Where things stand\n\nThe release notes are drafted and checked against `docs/decisions`.\n\n- Customers asked for a short version.\n- The budget is **not** approved yet.",
        carried: "Working folder: `C:/work/zhiyin-desktop`",
        reread: ["docs/release-notes.md"],
      },
      {
        id: "demo-condensing-failed",
        sequence: 4.5,
        createdAt: "2026-10-02T09:05:00.000Z",
        targetTokens: 60_000,
        tokensBefore: 131_000,
        outcome: "failed",
        reason: "request-failed",
        detail: "503 upstream timeout",
      },
    ];
  }

  return createWindowState({
    connection: "ready",
    runtime: { tasks: "available", capabilities: "available" },
    workspace: { path: "C:/work/zhiyin-desktop", name: "Zhiyin Desktop" },
    memory: demoMemory,
    ...(scenario === "update" ? { appUpdate: demoUpdateReady } : {}),
    ...(scenario === "browser"
      ? {
          beside: {
            [task.id]: {
              browser: {
                status: "opening" as const,
                url: "https://docs.zhiyin.app/releases/new",
                title: "Documentation preview",
                loading: true,
              },
              // The core opened the space on the browser's first use.
              view: "browser" as const,
            },
          },
        }
      : {}),
    ...(scenario === "document"
      ? {
          beside: {
            [task.id]: {
              browser: {
                status: "open" as const,
                url: "https://example.com/pricing",
                title: "Pricing — Example",
                loading: false,
                frame: { data: sampleBrowserFrame, width: 560, height: 420 },
              },
              document: shownReport,
              view: "document" as const,
            },
          },
        }
      : {}),
    ...(scenario === "required-reasoning"
      ? {
          provider: {
            ...createWindowState().provider,
            reasoning: {
              status: "available" as const,
              required: true,
              defaultEnabled: true,
              defaultEffort: "max" as const,
              efforts: ["max", "high", "low"] as const,
            },
          },
        }
      : {}),
    recentWorkspaces: [
      { path: "C:/work/zhiyin-desktop", name: "Zhiyin Desktop" },
      { path: "C:/work/quarterly-reports", name: "quarterly-reports" },
      { path: "C:/work/notes", name: "notes" },
      { path: "D:/Archive/2025/notes", name: "notes" },
    ],
    tasks: [task, ...historyTasks],
    selectedTaskId: task.id,
    plugins: demoPlugins,
    mcpServers: demoConnections,
    usage: demoUsage,
    spelling: demoSpelling,
  });
}
