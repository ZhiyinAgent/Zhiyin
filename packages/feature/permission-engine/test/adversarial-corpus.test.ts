import { describe, expect, it } from "vitest";
import type { ActionEffects } from "@zhiyin/contract";
import {
  GuardedPermissionEngine,
  type Action,
  type Decision,
} from "../src/index.js";

type CorpusCase = {
  readonly name: string;
  readonly rationale: string;
  readonly action: Action;
  readonly decision: Decision;
};

/** The decisions the cases expect, each with the reason it gives. */
const decisions = {
  contained: {
    outcome: "allow",
    reason:
      "Nothing this does needs a decision: it is contained, or Zhiyin can put it back.",
  },
  pluginRead: {
    outcome: "allow",
    reason: "This reads what an enabled plugin contains.",
  },
  connected: {
    outcome: "ask",
    covers: "tool",
    why: "connected-tool",
    reason:
      "This action uses a connected tool and requires an explicit decision.",
  },
  undeclared: {
    outcome: "ask",
    covers: "never",
    reason:
      "This does not say what it does, so it is decided as the worst it could do, and requires an explicit decision each time.",
  },
  fullAccess: {
    outcome: "ask",
    covers: "never",
    why: "full-access",
    reason:
      "This runs code with the person's full access, and requires an explicit decision each time.",
  },
  outsideFolder: {
    outcome: "ask",
    covers: "file-or-folder",
    why: "outside-folder",
    reason:
      "This reaches outside the selected folder, and requires an explicit decision for its file or folder.",
  },
  outsideRead: {
    outcome: "ask",
    covers: "never",
    why: "outside-folder",
    reason:
      "This reaches outside the selected folder, and requires an explicit decision each time.",
  },
  cannotUndo: {
    outcome: "ask",
    covers: "never",
    why: "cannot-undo",
    reason:
      "This changes the workspace in a way Zhiyin cannot put back, and requires an explicit decision each time.",
  },
  runsLater: {
    outcome: "ask",
    covers: "never",
    why: "runs-later",
    reason:
      "This leaves something that runs later without anyone starting it, and requires an explicit decision each time.",
  },
  pluginBeyondRead: {
    outcome: "ask",
    covers: "never",
    why: "plugin-beyond-read",
    reason:
      "A plugin or skill may only read what it holds; anything more requires an explicit decision each time.",
  },
} as const satisfies Record<string, Decision>;

/** An action that does nothing at all, to which each case adds what it does. */
const nothing: ActionEffects = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
};

/**
 * What the shell tool declares of a command sealed off in its container,
 * whatever its text (ADR 0029): it reads and changes the workspace, runs
 * code sealed off, and sends only to the hosts on the conversation's list.
 */
const sealedShell: Partial<ActionEffects> = {
  reads: "workspace",
  changes: "workspace",
  sends: "service",
  runs: "sealed",
};

/** What the shell tool declares of a command with full access, whatever its text (ADR 0012). */
const shell: Partial<ActionEffects> = {
  reads: "elsewhere",
  changes: "elsewhere",
  sends: "chosen",
  runs: "full-access",
  brings: "outside",
};

/**
 * `does` is what the implementation declared its action does; absent, it
 * declared nothing. It is deliberately separate from the tool's name: the
 * whole point of the rules under test is that authority follows a
 * declaration from an implementation the app owns, never a name anyone can
 * choose. Every case is decided in a conversation where outside content and
 * something private have met, so nothing passes for want of either.
 */
const action = (
  owner: Action["owner"],
  name: string,
  arguments_: unknown,
  does?: Partial<ActionEffects>,
  declared: Pick<
    Partial<Action>,
    "builtInConnection" | "effectsDeclaredByZhiyin"
  > = {},
): Action => ({
  kind: "tool",
  owner,
  name,
  arguments: arguments_,
  action: "Exercise the permission boundary",
  target: "adversarial fixture",
  command: `${name}(${JSON.stringify(arguments_)})`,
  ...(does ? { effects: { ...nothing, ...does } } : {}),
  conversation: { outsideContent: true, privateWithinReach: true },
  ...declared,
});

const shipped = { builtInConnection: true } as const;

const corpus: readonly CorpusCase[] = [
  {
    name: "known workspace file reads do not need repetitive approval",
    rationale:
      "The built-in implementation constrains the resolved path to the selected workspace and has no write effect.",
    action: action(
      "built-in",
      "read_file",
      { path: "notes.md" },
      {
        reads: "workspace",
      },
    ),
    decision: decisions.contained,
  },
  {
    name: "known bounded directory listings do not need repetitive approval",
    rationale:
      "The built-in implementation stays inside the selected workspace, does not follow links, and bounds its result.",
    action: action(
      "built-in",
      "list_directory",
      { path: "." },
      {
        reads: "workspace",
      },
    ),
    decision: decisions.contained,
  },
  {
    name: "a workspace search does not need repetitive approval",
    rationale:
      "Searching is a read the built-in implementation confines to the selected workspace; it produces no durable effect.",
    action: action(
      "built-in",
      "search_files",
      { query: "budget" },
      {
        reads: "workspace",
      },
    ),
    decision: decisions.contained,
  },
  {
    name: "a safe-looking external read remains approval-required",
    rationale:
      "An MCP server owns its behavior; its name, its read-only annotations and the effects it claims are untrusted descriptions, not authority.",
    action: action(
      "mcp",
      "read_file",
      { path: "notes.md" },
      {
        reads: "workspace",
      },
    ),
    decision: decisions.connected,
  },
  {
    name: "a connected tool that declares nothing is asked about as a connected tool",
    rationale:
      "A connection Zhiyin does not ship is decided by the person tool by tool, whatever it says or leaves out.",
    action: action("mcp", "tavily_search", { query: "current news" }),
    decision: decisions.connected,
  },
  {
    name: "a connected tool cannot borrow a skill's read",
    rationale:
      "Only the owner the app assigned carries the rule; an MCP server naming its tool load_skill and declaring a read of Zhiyin's records gains nothing.",
    action: action(
      "mcp",
      "load_skill",
      { id: "publishing/typst" },
      {
        reads: "app",
      },
    ),
    decision: decisions.connected,
  },
  {
    name: "a connected tool cannot claim to be one Zhiyin ships by its effects",
    rationale:
      "That a connection is shipped, or that its effects come from Zhiyin's manifest, is said by the connection feature; effects alone from a server buy nothing, even ones that would run unasked.",
    action: action("mcp", "cad_api", { name: "extrude" }, { reads: "app" }),
    decision: decisions.connected,
  },
  {
    name: "a read of a connection Zhiyin ships does not need approval",
    rationale:
      "Zhiyin wrote the connection's code, which declares the read; that it is built in is said by the connection feature, never by the connection.",
    action: action(
      "mcp",
      "cad_api",
      { name: "extrude" },
      { reads: "app" },
      shipped,
    ),
    decision: decisions.contained,
  },
  {
    name: "a sealed build of code the model wrote runs, and its changes in the workspace can be put back",
    rationale:
      "Sealed-off code can change only what Zhiyin backs up first (ADR 0012); whether the person ran the same script before decides nothing.",
    action: action(
      "mcp",
      "cad_build",
      { file: "plate.py" },
      { reads: "workspace", changes: "workspace", runs: "sealed" },
      shipped,
    ),
    decision: decisions.contained,
  },
  {
    name: "a script given a folder outside the workspace asks for that folder",
    rationale:
      "A sealed-off program changing files elsewhere reaches past the folder the person chose; a grant for that folder may cover it.",
    action: action(
      "mcp",
      "blender_script",
      { code: "pass" },
      { reads: "elsewhere", changes: "elsewhere", runs: "sealed" },
      shipped,
    ),
    decision: decisions.outsideFolder,
  },
  {
    name: "a git change runs the repository's hooks with the person's full access, so it asks every time",
    rationale:
      "A shipped connection's word is trusted, and what it declares here is code no seal holds.",
    action: action(
      "mcp",
      "git_commit",
      { message: "x" },
      {
        reads: "workspace",
        changes: "workspace-for-good",
        runs: "full-access",
      },
      shipped,
    ),
    decision: decisions.fullAccess,
  },
  {
    name: "a git read of a repository reaching beyond the folder asks every time",
    rationale:
      "Containment is what makes a read safe to run unasked, for a shipped connection as for a built-in tool. A grant covers changes outside the folder, never reads there.",
    action: action("mcp", "git_status", {}, { reads: "elsewhere" }, shipped),
    decision: decisions.outsideRead,
  },
  {
    name: "a shipped connection's call that declares nothing asks every time",
    rationale:
      "Silence is not a claim, for a connection Zhiyin ships as for a built-in tool.",
    action: action("mcp", "blender_add_objects", { objects: [] }, undefined, {
      ...shipped,
    }),
    decision: decisions.undeclared,
  },
  {
    name: "reading an offered skill's instructions does not need approval",
    rationale:
      "The app loads the instructions of a plugin the person enabled. Reading them changes nothing and grants nothing; skills never carry permission.",
    action: action(
      "skill",
      "load_skill",
      { id: "publishing/typst" },
      {
        reads: "app",
      },
    ),
    decision: decisions.pluginRead,
  },
  {
    name: "listing an enabled plugin's contents does not need approval",
    rationale:
      "The app describes a plugin the person enabled, without activating anything.",
    action: action(
      "plugin",
      "inspect_plugin",
      { id: "publishing" },
      {
        reads: "app",
      },
    ),
    decision: decisions.pluginRead,
  },
  ...(["skill", "plugin"] as const).map((owner): CorpusCase => ({
    name: `a ${owner} read naming the workspace is still a plugin read`,
    rationale:
      "Reading what an enabled plugin contains is allowed as such; naming the workspace does not make it a contained workspace read.",
    action: action(
      owner,
      "load_skill",
      { id: "research" },
      {
        reads: "workspace",
      },
    ),
    decision: decisions.pluginRead,
  })),
  ...(["skill", "plugin"] as const).map((owner): CorpusCase => ({
    name: `a ${owner} action that declares nothing remains approval-required`,
    rationale:
      "Silence is not a claim, for skills and plugins as for built-ins: instructions can influence later work but never grant themselves authority.",
    action: action(owner, "load_skill", { id: "publishing/typst" }),
    decision: decisions.undeclared,
  })),
  ...(["skill", "plugin"] as const).map((owner): CorpusCase => ({
    name: `a ${owner} action that changes the workspace asks every time`,
    rationale:
      "Only a plugin's reads of what it holds run on their own; even a change Zhiyin could put back is the person's decision.",
    action: action(
      owner,
      "inspect_plugin",
      { id: "publishing" },
      {
        changes: "workspace",
      },
    ),
    decision: decisions.pluginBeyondRead,
  })),
  {
    name: "a plugin read that reaches elsewhere on this computer asks every time",
    rationale:
      "What a plugin holds is in Zhiyin's records; a read beyond them is more than reading what it holds.",
    action: action(
      "plugin",
      "inspect_plugin",
      { id: "publishing" },
      {
        reads: "elsewhere",
      },
    ),
    decision: decisions.pluginBeyondRead,
  },
  {
    name: "an unknown built-in that declares nothing asks every time",
    rationale:
      "Adding a new tool must not silently inherit the authority of an existing read-only tool by leaving out what it does.",
    action: action("built-in", "read_everything", {}),
    decision: decisions.undeclared,
  },
  {
    name: "a write in the workspace runs, since Zhiyin backs it up first",
    rationale:
      "A change Zhiyin can put back is shown with a way back rather than asked about (ADR 0012).",
    action: action(
      "built-in",
      "write_file",
      { path: "report.md", content: "report" },
      { reads: "workspace", changes: "workspace" },
    ),
    decision: decisions.contained,
  },
  {
    name: "a deletion for good asks every time",
    rationale:
      "A file deleted past the Recycle Bin is one Zhiyin cannot put back.",
    action: action(
      "built-in",
      "delete_file",
      { paths: ["notes.tmp"], permanent: true },
      { reads: "workspace", changes: "workspace-for-good" },
    ),
    decision: decisions.cannotUndo,
  },
  {
    name: "a write into Git's folder asks every time, with no grant to cover it",
    rationale:
      "A hook or setting written there runs at a later git command, before anyone could undo it.",
    action: action(
      "built-in",
      "write_file",
      { path: ".git/hooks/pre-commit", content: "x" },
      { reads: "workspace", changes: "workspace", lasting: true },
    ),
    decision: decisions.runsLater,
  },
  {
    name: "a read outside the selected workspace asks every time",
    rationale:
      "The chosen folder is the scope a person consented to. Reaching past it is a new decision, not a continuation of the old one, and no grant covers a read there.",
    action: action(
      "built-in",
      "read_file",
      { path: "C:/Users/someone/.ssh/id_rsa" },
      { reads: "elsewhere" },
    ),
    decision: decisions.outsideRead,
  },
  {
    name: "a change outside the folder asks for its file or folder",
    rationale: "A change elsewhere on this computer is not the workspace's.",
    action: action(
      "built-in",
      "write_file",
      { path: "C:/elsewhere/a.md", content: "x" },
      { reads: "elsewhere", changes: "elsewhere" },
    ),
    decision: decisions.outsideFolder,
  },
  ...(
    [
      ["a shell deletion", "rm -- notes.tmp", "Delete one temporary file."],
      [
        "a broad deletion behind a benign claim",
        "rm -rf -- /",
        "List the current folder.",
      ],
      [
        "chained commands",
        "git status && rm -rf -- .git",
        "Show repository status.",
      ],
      [
        "an interpreter",
        "node -e \"require('fs').rmSync('data',{recursive:true})\"",
        "Run a Node helper.",
      ],
      [
        "a command that reads like a look around",
        "git status",
        "Show what changed.",
      ],
    ] as const
  ).flatMap(([what, command, purpose]): CorpusCase[] => [
    {
      name: `${what} with full access asks every time`,
      rationale:
        "The shell tool declares a command with full access as code with the person's full access: nothing in a command string, or the model's explanation of it, bounds what it reaches (ADR 0012).",
      action: action(
        "built-in",
        "bash",
        { command, purpose, full_access: true },
        shell,
      ),
      decision: decisions.fullAccess,
    },
    {
      name: `${what} sealed off is decided by its container, not its text`,
      rationale:
        "A sealed-off command declares what its container allows, which the tool's code sets: the workspace, copied first, and the hosts the person allowed. What the command says it does neither widens nor narrows that (ADR 0029).",
      action: action("built-in", "bash", { command, purpose }, sealedShell),
      decision: decisions.contained,
    },
    {
      name: `${what} sealed off with a folder granted for changing asks for that folder`,
      rationale:
        "A folder outside the workspace that the container may change is covered only by a grant for that folder (ADR 0029, ADR 0012).",
      action: action(
        "built-in",
        "bash",
        { command, purpose },
        { ...sealedShell, changes: "elsewhere" },
      ),
      decision: decisions.outsideFolder,
    },
  ]),
];

describe("adversarial permission corpus", () => {
  const engine = new GuardedPermissionEngine();

  for (const fixture of corpus) {
    it(`${fixture.name} — ${fixture.rationale}`, async () => {
      await expect(engine.decide(fixture.action)).resolves.toEqual(
        fixture.decision,
      );
    });
  }
});
