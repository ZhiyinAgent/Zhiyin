import type {
  ComponentContent,
  McpServerState,
  PluginState,
} from "@zhiyin/contract";

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
        id: "engineering/issues",
        kind: "connection",
        name: "Issue tracker",
        description: "Reads and files issues in the team's tracker.",
        enabled: true,
        status: "unchecked",
        editing: "none",
        access: "Works without an account.",
        dataDestination: "Issue text is sent to issues.example.com.",
      },
      {
        id: "engineering/board",
        kind: "connection",
        name: "Project board",
        description: "Reads and moves cards on the team's project board.",
        enabled: true,
        status: "setup-required",
        editing: "none",
        access: "Acts with what your board account allows.",
        dataDestination: "Card text is sent to board.example.com.",
        detail: "Sign in to use this connector.",
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
        setup: {
          url: "https://github.com/settings/personal-access-tokens/new",
          keyName: "personal access token",
          advice:
            "Choose the repositories Zhiyin should work with, or all of them. Under Repository permissions, set Contents, Issues and Pull requests to Read and write: that covers searching, reading and making commits, branches, issues and pull requests. Add Workflows too if it should change GitHub Actions files.",
        },
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
  {
    id: "engineering/issues",
    name: "Issue tracker",
    url: "https://issues.example.com/mcp",
    enabled: true,
    status: "unchecked",
    toolCount: 0,
    tools: [],
    credential: { status: "none" },
  },
  {
    id: "engineering/board",
    name: "Project board",
    url: "https://board.example.com/mcp",
    enabled: true,
    status: "unauthorized",
    toolCount: 0,
    tools: [],
    reason: "Sign in to use this connector.",
    credential: { status: "none" },
    signIn: true,
  },
];

/** Each demo skill's and specialist's instructions, by component id. */
const demoInstructions: Record<string, string> = {
  "engineering/frontend-design-systems":
    "Start from the design system's tokens and components. Check contrast, keyboard use and the smallest window before calling a screen done.",
  "engineering/test-driven-development":
    "Write the failing test, then the smallest change that makes it pass.",
  "engineering/code-reviewer":
    "Read the change against its intent. Report defects first, then risks, then style.",
  "publishing/latex-typst-authoring":
    "Keep sources compiling after every change. Read the compiler's first error before the rest.",
  "team-standards/review-checklist":
    "Check the tests, the changelog entry and the migration notes before approving.",
  "release-notes/release-notes-writing":
    "Group the changes by what a reader gains, and link each to its pull request.",
};

/**
 * What opening a demo component shows: that component's own words, and, for
 * one a person edited, the version the plugin ships beside the edit.
 */
export async function demoComponentContent(
  id: string,
): Promise<ComponentContent | undefined> {
  const component = demoPlugins
    .flatMap((plugin) => plugin.components)
    .find((item) => item.id === id);
  if (!component || component.kind === "connection") return undefined;
  const instructions = demoInstructions[id] ?? "";
  return {
    id,
    kind: component.kind,
    name: component.name,
    description: component.description,
    instructions,
    editing: component.editing === "authored" ? "authored" : "override",
    ...(component.overridden
      ? {
          shipped: {
            name: component.name,
            description: component.description,
            instructions: component.shippedChanged
              ? "Write the failing test first, and keep each change small."
              : instructions,
          },
          shippedChanged: component.shippedChanged ?? false,
        }
      : {}),
  };
}

/**
 * What the demo installs when a person imports a plugin, standing in for the
 * folder they would pick in Windows' folder picker.
 */
export const demoImportedPlugin: PluginState = {
  id: "trip-planning",
  name: "Trip Planning",
  version: "1.2.0",
  description: "Plan trips around the weather, with routes and packing lists.",
  category: "Other",
  publisher: "A colleague",
  source: "personal",
  editing: "override",
  rollbackAvailable: false,
  enabled: true,
  status: "ready",
  defaultPrompts: ["Plan a weekend in the Alps for next month."],
  components: [
    {
      id: "trip-planning/packing-lists",
      kind: "skill",
      name: "packing-lists",
      description: "Use when someone is getting ready for a trip.",
      enabled: true,
      status: "ready",
      editing: "override",
    },
  ],
};

/** What a demo connector answers when a person checks it. */
export async function demoCheck(id: string): Promise<McpServerState> {
  const server = demoConnections.find((item) => item.id === id);
  if (!server) throw new Error("The demo has no such connector.");
  return server.status === "unchecked"
    ? {
        ...server,
        status: "connected",
        toolCount: 1,
        tools: [{ name: "search_issues", enabled: true }],
        checkedAt: Date.now(),
      }
    : { ...server, checkedAt: Date.now() };
}
