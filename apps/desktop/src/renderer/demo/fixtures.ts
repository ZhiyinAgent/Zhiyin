import type {
  McpServerState,
  ModelCatalog,
  ModelProviderOption,
  PluginState,
} from "@zhiyin/contract";
import {
  type UsageState,
  type WorkspaceState,
  type WorkspaceTask,
  createWorkspaceState,
} from "../ui/app/index.js";

function distribute(total: number, days: number) {
  const weights = Array.from(
    { length: days },
    (_, index) => 3 + ((index * 7) % 11),
  );
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const values = weights.map((value) =>
    Math.floor((total * value) / weightTotal),
  );
  values[values.length - 1]! +=
    total - values.reduce((sum, value) => sum + value, 0);
  return values;
}

function dateAtOffset(offset: number) {
  const date = new Date(Date.UTC(2026, 8, 2 + offset));
  return date.toISOString().slice(0, 10);
}

function demoRange(days: 7 | 30, requests: number, costUsd: number) {
  const dailyRequests = distribute(requests, days);
  return {
    days,
    requests,
    inputTokens: days === 7 ? 7_000_000 : 28_000_000,
    outputTokens: days === 7 ? 2_600_000 : 10_400_000,
    costUsd,
    pricedRequests: requests,
    activity: dailyRequests.map((count, index) => ({
      date: dateAtOffset(index - days + 1),
      requests: count,
      costUsd: Number(((count / requests) * costUsd).toFixed(6)),
    })),
    models: [
      {
        model: "z-ai/glm-5.3-flash",
        requests: Math.round(requests * 0.62),
        inputTokens: days === 7 ? 4_500_000 : 18_000_000,
        outputTokens: days === 7 ? 1_700_000 : 6_800_000,
        costUsd: Number((costUsd * 0.51).toFixed(6)),
      },
      {
        model: "openai/gpt-5.6-luna",
        requests: Math.round(requests * 0.25),
        inputTokens: days === 7 ? 1_800_000 : 7_000_000,
        outputTokens: days === 7 ? 650_000 : 2_500_000,
        costUsd: Number((costUsd * 0.31).toFixed(6)),
      },
      {
        model: "anthropic/claude-sonnet-4.5",
        requests:
          requests - Math.round(requests * 0.62) - Math.round(requests * 0.25),
        inputTokens: days === 7 ? 700_000 : 3_000_000,
        outputTokens: days === 7 ? 250_000 : 1_100_000,
        costUsd: Number((costUsd * 0.18).toFixed(6)),
      },
    ],
  };
}

/**
 * A slice of the real catalogue, shaped as the app receives it. Prices, context
 * windows and measurements are values the provider actually returned on
 * 2026-09-10 rather than invented ones, so the lab shows the layout under real
 * numbers — including an upstream that cannot run tools and one with no
 * measurements at all.
 */
export const demoCatalog: ModelCatalog = {
  status: "ready",
  models: [
    {
      id: "z-ai/glm-5.3-flash",
      name: "Z.ai: GLM 5.3 Flash",
      contextWindow: 1_310_720,
      inputUsdPerMillion: 0.075,
      outputUsdPerMillion: 0.25,
      acceptsImages: true,
      reasoning: true,
    },
    {
      id: "anthropic/claude-sonnet-5",
      name: "Anthropic: Claude Sonnet 5",
      contextWindow: 1_000_000,
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 10,
      acceptsImages: true,
      reasoning: true,
    },
    {
      id: "openai/gpt-5.4",
      name: "OpenAI: GPT-5.4",
      contextWindow: 1_050_000,
      inputUsdPerMillion: 2.5,
      outputUsdPerMillion: 15,
      acceptsImages: true,
      reasoning: true,
    },
    {
      id: "minimax/minimax-m2.5",
      name: "MiniMax: MiniMax M2.5",
      contextWindow: 204_800,
      inputUsdPerMillion: 0.27,
      outputUsdPerMillion: 1.08,
      acceptsImages: false,
      reasoning: true,
    },
  ],
};

export const demoProviders: readonly ModelProviderOption[] = [
  {
    slug: "deepinfra/fp4",
    name: "DeepInfra",
    quantization: "fp4",
    tier: null,
    region: null,
    contextWindow: 1_048_576,
    maximumOutputTokens: 131_072,
    inputUsdPerMillion: 0.075,
    outputUsdPerMillion: 0.25,
    acceptsTools: true,
    responseMs: 1845,
    tokensPerSecond: 15,
    uptimePercent: 95,
  },
  {
    slug: "z-ai/fp8",
    name: "Z.AI",
    quantization: "fp8",
    tier: null,
    region: null,
    contextWindow: 1_048_576,
    maximumOutputTokens: 131_072,
    inputUsdPerMillion: 0.075,
    outputUsdPerMillion: 0.25,
    acceptsTools: false,
    responseMs: 3726,
    tokensPerSecond: 38,
    uptimePercent: 86.1,
  },
  {
    slug: "crusoe/fp4",
    name: "Crusoe",
    quantization: "fp4",
    tier: null,
    region: null,
    contextWindow: 1_048_576,
    maximumOutputTokens: 131_072,
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.5,
    acceptsTools: true,
    responseMs: 780,
    tokensPerSecond: 132,
    uptimePercent: 100,
  },
  {
    slug: "fireworks",
    name: "Fireworks",
    quantization: null,
    tier: null,
    region: null,
    contextWindow: 1_048_576,
    maximumOutputTokens: 131_072,
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.5,
    acceptsTools: true,
    responseMs: null,
    tokensPerSecond: null,
    uptimePercent: null,
  },
];

export const demoUsage: UsageState = {
  status: "ready",
  costSource: "provider-reported",
  ranges: {
    "7": demoRange(7, 1_284, 18.42),
    "30": demoRange(30, 5_238, 64.9),
  },
};

/**
 * The plugin directory the demo shows: the shipped verticals in the states a
 * person meets them in, and one plugin a person made.
 */
export const demoPlugins: PluginState[] = [
  {
    id: "engineering",
    name: "Full-Stack Software Engineering",
    version: "1.0.0",
    description:
      "Design, build, test, debug, and review software in a real project, from the interface to the database.",
    category: "Development",
    publisher: "Zhiyin",
    source: "built-in",
    editing: "override",
    rollbackAvailable: false,
    enabled: true,
    status: "partial",
    defaultPrompts: [
      "Review this project and propose the next change.",
      "Find out why this test fails and fix it.",
    ],
    accessSummary:
      "Works in the project folder you chose, through tools you approve.",
    dataDestination:
      "Nothing leaves this computer unless the browser opens a site or you connect GitHub.",
    components: [
      {
        id: "engineering/frontend-design-systems",
        kind: "skill",
        name: "frontend-design-systems",
        description:
          "Use when building or reshaping a user interface: components, layout, styling, and accessibility.",
        enabled: true,
        status: "ready",
        editing: "override",
      },
      {
        id: "engineering/test-driven-development",
        kind: "skill",
        name: "test-driven-development",
        description:
          "Use when changing behavior: write the failing test first and prevent regressions.",
        enabled: true,
        status: "ready",
        editing: "override",
        overridden: true,
        shippedChanged: true,
      },
      {
        id: "engineering/code-reviewer",
        kind: "specialist",
        name: "Code reviewer",
        description:
          "Reviews a change for defects, security problems, and architecture violations.",
        enabled: true,
        status: "ready",
        editing: "override",
      },
      {
        id: "engineering/github",
        kind: "connection",
        name: "GitHub",
        description:
          "Searches and works with repositories, issues, and pull requests.",
        enabled: true,
        status: "setup-required",
        editing: "none",
        access:
          "Needs a GitHub personal access token, and acts with that token's permissions.",
        dataDestination:
          "Repository, issue, and pull request data is sent to api.githubcopilot.com.",
        detail:
          "This server refused the access token. Save a current token to sign in again.",
      },
      {
        id: "engineering/browser",
        kind: "connection",
        name: "Browser",
        description:
          "Opens pages in a browser window Zhiyin controls, to test interfaces.",
        enabled: true,
        status: "ready",
        editing: "none",
        appConnector: true,
        access: "Opens and operates pages in its own window.",
        dataDestination: "The sites it is asked to open.",
      },
    ],
  },
  {
    id: "publishing",
    name: "Technical & Academic Publishing",
    version: "1.0.0",
    description:
      "Write, structure, and typeset technical and academic documents, with sound citations and diagrams.",
    category: "Writing",
    publisher: "Zhiyin",
    source: "built-in",
    editing: "override",
    rollbackAvailable: false,
    enabled: true,
    status: "partial",
    defaultPrompts: ["Turn these notes into a Typst paper and compile it."],
    accessSummary: "Works with documents in your project folder.",
    dataDestination:
      "Compiling may download fonts or TeX packages the document uses.",
    components: [
      {
        id: "publishing/latex-typst-authoring",
        kind: "skill",
        name: "latex-typst-authoring",
        description:
          "Use when writing or fixing LaTeX or Typst sources and compiler errors.",
        enabled: true,
        status: "ready",
        editing: "override",
      },
      {
        id: "publishing/compiler",
        kind: "connection",
        name: "Document compiler",
        description:
          "Compiles Typst and LaTeX documents in your workspace to PDF.",
        enabled: true,
        status: "setup-required",
        editing: "none",
        appConnector: true,
        toolchain: {
          status: "missing",
          downloads: [
            {
              name: "Typst",
              version: "0.15.1",
              bytes: 22_463_684,
              source: "github.com/typst/typst",
            },
          ],
        },
        access: "Reads source files and writes the compiled PDF.",
        dataDestination: "Installing downloads Typst and Tectonic from GitHub.",
      },
    ],
  },
  {
    id: "team-standards",
    name: "Team Standards",
    version: "2.1.0",
    description: "The review checklist and writing rules this team agreed on.",
    category: "Other",
    publisher: "A colleague",
    source: "personal",
    editing: "override",
    rollbackAvailable: true,
    enabled: true,
    status: "ready",
    defaultPrompts: [],
    components: [
      {
        id: "team-standards/review-checklist",
        kind: "skill",
        name: "review-checklist",
        description: "The checks this team asks for before a change merges.",
        enabled: true,
        status: "ready",
        editing: "override",
        overridden: true,
      },
    ],
  },
  {
    id: "release-notes",
    name: "Release Notes",
    version: "0.0.3",
    description: "Draft release notes from a diff and a milestone.",
    category: "Other",
    publisher: "You",
    source: "personal",
    editing: "authored",
    rollbackAvailable: true,
    enabled: false,
    status: "off",
    defaultPrompts: [],
    components: [
      {
        id: "release-notes/release-notes-writing",
        kind: "skill",
        name: "release-notes-writing",
        description: "Turns a diff and a milestone into readable notes.",
        enabled: true,
        status: "ready",
        editing: "authored",
      },
    ],
  },
];

export const demoConnections: McpServerState[] = [
  {
    id: "browser",
    name: "Zhiyin's browser",
    url: "",
    enabled: true,
    builtIn: true,
    status: "connected",
    toolCount: 1,
    tools: [{ name: "navigate", enabled: true }],
    credential: { status: "none" },
  },
  {
    id: "engineering/github",
    name: "GitHub",
    url: "https://api.githubcopilot.com/mcp/",
    enabled: true,
    status: "unauthorized",
    toolCount: 0,
    tools: [],
    reason:
      "This server refused the access token. Save a current token to sign in again.",
    credential: { status: "saved" },
  },
];

const releaseTask: WorkspaceTask = {
  id: "release",
  title: "Prepare v0.1 release notes",
  updatedLabel: "Now",
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
    {
      id: "plan-1",
      title: "Review project evidence",
      criterion:
        "The release summary is supported by architecture decisions and commit history.",
      status: "active",
    },
    {
      id: "plan-2",
      title: "Prepare the release draft",
      criterion:
        "The draft explains user-visible changes without unsupported claims.",
      status: "pending",
    },
    {
      id: "plan-3",
      title: "Publish after approval",
      criterion: "The approved draft is available on the documentation site.",
      status: "pending",
    },
  ],
  phase: {
    kind: "working",
    note: "Reading docs/decisions and the last 12 commits",
    steps: [],
  },
  context: {
    kind: "workspace",
    project: "Zhiyin Desktop",
    files: [
      { name: "release-notes.md", meta: "Edited · moments ago" },
      { name: "changelog.md", meta: "Read" },
      { name: "docs/decisions", meta: "12 files scanned" },
    ],
    changes: "+42 −8",
  },
};

const historyTasks: WorkspaceTask[] = [
  {
    id: "audit",
    title: "Audit dependencies",
    updatedLabel: "Yesterday",
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
    messages: [],
    phase: { kind: "interrupted" },
  },
  {
    id: "permission",
    title: "Review permission boundaries",
    updatedLabel: "Aug 29",
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

export type DemoScenario =
  | "new"
  | "thinking"
  | "reasoning"
  | "reasoning-interrupted"
  | "working"
  | "quiz"
  | "approval"
  | "browser"
  | "done"
  | "loading"
  | "plugins";

const demoScenarios = new Set<DemoScenario>([
  "new",
  "thinking",
  "reasoning",
  "reasoning-interrupted",
  "working",
  "quiz",
  "approval",
  "browser",
  "done",
  "loading",
  "plugins",
]);

export function demoScenarioFromSearch(search: string): DemoScenario {
  const scenario = new URLSearchParams(search).get("scenario");
  return scenario && demoScenarios.has(scenario as DemoScenario)
    ? (scenario as DemoScenario)
    : "working";
}

export function createDemoWorkspaceState(
  scenario: DemoScenario = "working",
): WorkspaceState {
  if (scenario === "loading") {
    return createWorkspaceState({
      connection: "loading",
      runtime: { tasks: "available", capabilities: "available" },
      plugins: demoPlugins,
      mcpServers: demoConnections,
    });
  }

  if (scenario === "new") {
    return createWorkspaceState({
      connection: "ready",
      runtime: { tasks: "available", capabilities: "available" },
      tasks: historyTasks,
      plugins: demoPlugins,
      mcpServers: demoConnections,
      usage: demoUsage,
    });
  }

  if (scenario === "plugins") {
    return createWorkspaceState({
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

  const task: WorkspaceTask = structuredClone(releaseTask);
  task.updatedAt = new Date().toISOString();
  if (scenario === "thinking") {
    task.messages = task.messages.slice(0, 1);
    task.actions = [];
    task.plan = [];
    task.phase = { kind: "working", steps: [] };
  }
  if (scenario === "reasoning" || scenario === "reasoning-interrupted") {
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
          status: scenario === "reasoning" ? "streaming" : "interrupted",
          text: "The research is ready. I need to turn the film list into a page that feels like a cinema programme, with a clear way to compare the titles.\n\nI’ll start with a wide featured film, then a grid for the remaining titles. Each card should carry the title, genre, and a short description. The visual hierarchy should come from typography and spacing, so it still works without poster images.\n\nOn a narrow screen, the grid can become one column. The navigation should stay reachable by keyboard, and hover effects should have a focus equivalent.\n\nBefore writing the page, I’m checking that the layout can accommodate a long title without pushing the other cards out of alignment.",
        },
      },
    ];
    task.actions = [];
    task.plan = [];
    task.reasoning = { enabled: true, effort: "high" };
    task.phase =
      scenario === "reasoning"
        ? { kind: "working", steps: [] }
        : {
            kind: "interrupted",
            reason:
              "The response was stopped. The reasoning received so far is kept above.",
          };
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
    delete task.context;
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
  if (scenario === "approval") {
    task.actions = [
      {
        id: "read-decisions",
        action: "Read architecture decisions",
        description: "Check the decisions that constrain the release summary.",
        target: "docs/decisions",
        status: "completed",
        sequence: 2,
      },
      {
        id: "read-history",
        action: "Read recent commits",
        description: "Identify changes included in this release.",
        target: "12 commits on the current branch",
        status: "completed",
        sequence: 3,
      },
    ];
    task.messages.push({
      id: "release-assistant",
      role: "assistant",
      text: "The release draft is ready. Publishing is the remaining external action, so I need your decision before sending it to the documentation site.",
      sequence: 4,
    });
    if (task.plan) {
      task.plan = task.plan.map((item, index) => ({
        ...item,
        status: index < 2 ? "verified" : "active",
        ...(index === 0
          ? {
              verification:
                "Architecture decisions and recent commits were reviewed.",
            }
          : index === 1
            ? {
                verification:
                  "The draft separates verified changes from open work.",
              }
            : {}),
      }));
    }
    task.phase = {
      kind: "approval",
      steps: [],
      prompt: {
        id: "publish",
        action: "Publish the release notes",
        target: "docs.zhiyin.app",
        reason:
          "This sends the reviewed draft to the public documentation site.",
        command: "pnpm docs:publish --production",
      },
    };
  }
  if (scenario === "browser") {
    task.phase = {
      kind: "browser",
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
    task.context = {
      kind: "browser",
      title: "Zhiyin documentation",
      url: "docs.zhiyin.app/releases/new",
    };
  }
  if (scenario === "done") {
    const verification = [
      "Architecture decisions and recent commits were reviewed.",
      "The draft separates verified changes from open work.",
      "The release notes artifact is ready for review.",
    ];
    if (task.plan) {
      task.plan = task.plan.map((item, index) => ({
        ...item,
        status: "verified",
        verification:
          verification[index] ??
          "The demo plan and verification fixture are out of sync.",
      }));
    }
    task.messages.push({
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

The final artifact is attached below.`,
      sequence: 4,
    });
    task.phase = {
      kind: "completed",
      outcome: {
        title: "Release notes are ready",
        summary:
          "The draft was checked against project history and published with verified links.",
        file: "release-notes.md",
      },
    };
    task.actions = [
      {
        id: "read-decisions",
        action: "Read architecture decisions",
        description: "Check the decisions that constrain the release summary.",
        target: "docs/decisions",
        status: "completed",
        sequence: 2,
      },
      {
        id: "read-history",
        action: "Read recent commits",
        description: "Identify changes included in this release.",
        target: "12 commits on the current branch",
        status: "completed",
        sequence: 3,
      },
    ];
  }

  return createWorkspaceState({
    connection: "ready",
    runtime: { tasks: "available", capabilities: "available" },
    workspace: { path: "C:/work/zhiyin-desktop", name: "Zhiyin Desktop" },
    ...(scenario === "browser"
      ? {
          browser: {
            status: "opening" as const,
            url: "https://docs.zhiyin.app/releases/new",
            title: "Documentation preview",
            loading: true,
          },
        }
      : {}),
    ...(scenario === "reasoning" || scenario === "reasoning-interrupted"
      ? {
          provider: {
            ...createWorkspaceState().provider,
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
    ],
    tasks: [task, ...historyTasks],
    selectedTaskId: task.id,
    plugins: demoPlugins,
    mcpServers: demoConnections,
    usage: demoUsage,
  });
}
