import {
  type WorkspaceState,
  type WorkspaceTask,
  createWorkspaceState,
} from "../ui/app/index.js";
import { demoUsage } from "./fixtures/usage.js";
import { demoPlugins, demoConnections } from "./fixtures/capabilities.js";
export { demoUsage } from "./fixtures/usage.js";
export { demoCatalog, demoProviders } from "./fixtures/models.js";
export { demoPlugins, demoConnections } from "./fixtures/capabilities.js";

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
    { id: "plan-1", title: "Review project evidence", status: "in_progress" },
    { id: "plan-2", title: "Prepare the release draft", status: "pending" },
    { id: "plan-3", title: "Publish after approval", status: "pending" },
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
        status: index < 2 ? "done" : "in_progress",
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
    if (task.plan) {
      task.plan = task.plan.map((item) => ({ ...item, status: "done" }));
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
