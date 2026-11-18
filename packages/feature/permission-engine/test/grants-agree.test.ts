/**
 * The engine says which kind of grant for the conversation may answer a
 * question; the standing grant rules say which grant can be offered. Both
 * read one description of the call, its effects, so they cannot disagree:
 * across every combination of effects the policy tells apart, the engine
 * names a kind of grant exactly when the rules offer a grant of that kind.
 */

import { describe, expect, it } from "vitest";
import type {
  ActionEffects,
  ConversationPermission,
  ToolCallInspection,
} from "@zhiyin/contract";
import {
  GuardedPermissionEngine,
  StandingGrantRules,
  type Action,
  type ConversationFacts,
  type Covers,
  type GrantAnswer,
} from "../src/index.js";

type Inspection = Extract<ToolCallInspection, { readonly ok: true }>;

const places = () => ({
  home: "C:\\Users\\lin",
  startup: [
    "C:\\Users\\lin\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup",
  ],
});

/** A file outside the workspace, and a folder, neither near the person's user folder. */
const outsideFile = "D:\\Projects\\Prints\\bracket.step";
const outsideFolder = "D:\\Projects\\Renders";
/** A workspace file too large to copy, by its whole path. */
const largeFile = "C:\\Users\\lin\\Documents\\Stand\\stand.blend";

/** Whose code made the call, as the app knows it. */
const callers = {
  "a built-in tool": { owner: "built-in" },
  "a connection Zhiyin ships": { owner: "mcp", builtInConnection: true },
  "a connection whose effects Zhiyin's manifest declares": {
    owner: "mcp",
    effectsDeclaredByZhiyin: true,
  },
  "a connection a person added": { owner: "mcp" },
  "a plugin": { owner: "plugin" },
} as const;
type Caller = (typeof callers)[keyof typeof callers];

const conversations: Record<
  string,
  { facts: ConversationFacts; seen: boolean }
> = {
  clean: {
    facts: { outsideContent: false, privateWithinReach: false },
    seen: false,
  },
  exposed: {
    facts: { outsideContent: true, privateWithinReach: true },
    seen: false,
  },
  "exposed, address known": {
    facts: { outsideContent: true, privateWithinReach: true },
    seen: true,
  },
};

/** Each value every part of the effects may take; undefined leaves it out. */
const choices: Record<keyof ActionEffects, readonly unknown[]> = {
  reads: ["none", "workspace", "app", "elsewhere", "account"],
  changes: ["none", "app", "workspace", "workspace-for-good", "elsewhere"],
  sends: ["none", "service", "chosen"],
  actsAsPerson: ["none", "once", "for-good"],
  runs: ["none", "sealed", "full-access"],
  lasting: [false, true],
  brings: ["none", "outside"],
  carries: [undefined, "address", "nothing"],
  destination: [undefined, "https://example.com/a"],
  uncopied: [undefined, [largeFile]],
};

/** Every combination of what an action may declare it does. */
function everyEffects(): ActionEffects[] {
  let combinations: Record<string, unknown>[] = [{}];
  for (const [part, values] of Object.entries(choices))
    combinations = combinations.flatMap((partial) =>
      values.map((value) =>
        value === undefined ? partial : { ...partial, [part]: value },
      ),
    );
  return combinations as ActionEffects[];
}

/** A change elsewhere names whole files or whole folders; nothing else does. */
function namings(effects: ActionEffects): ("files" | "folders")[] {
  return effects.changes === "elsewhere" ? ["files", "folders"] : ["files"];
}

/**
 * The call as a tool that declared these effects would describe it, with
 * everything a grant is bound to that is not an effect: the connection it
 * goes to, the files or folders it names by whole paths, and a built-in
 * tool's word that a file grant can cover its change.
 */
function inspecting(
  caller: Caller,
  effects: ActionEffects,
  names: "files" | "folders",
): Inspection {
  const elsewhere = effects.changes === "elsewhere";
  return {
    ok: true,
    action: "Act",
    target: "somewhere",
    command: "act({})",
    effects,
    ...(caller.owner === "mcp"
      ? { connection: "Studio", connectionId: "studio", identity: "call-v1" }
      : {}),
    ...("builtInConnection" in caller ? { builtInConnection: true } : {}),
    ...("effectsDeclaredByZhiyin" in caller
      ? { effectsDeclaredByZhiyin: true }
      : {}),
    ...(caller.owner === "built-in" ? { grantableByFile: true } : {}),
    ...(elsewhere && names === "files"
      ? { changes: [{ path: outsideFile, change: "updated" }] }
      : {}),
    ...(elsewhere && names === "folders"
      ? { changesAnyFile: { writable: [], outside: [outsideFolder] } }
      : {}),
  };
}

function acting(
  caller: Caller,
  inspection: Inspection,
  conversation: { facts: ConversationFacts; seen: boolean },
): Action {
  return {
    kind: "tool",
    owner: caller.owner,
    name: "act",
    arguments: {},
    action: inspection.action,
    target: inspection.target,
    command: inspection.command,
    ...("builtInConnection" in caller ? { builtInConnection: true } : {}),
    ...("effectsDeclaredByZhiyin" in caller
      ? { effectsDeclaredByZhiyin: true }
      : {}),
    ...(inspection.effects ? { effects: inspection.effects } : {}),
    conversation: conversation.facts,
    ...(conversation.seen ? { destinationSeen: true } : {}),
  };
}

/** The kinds of grant an answer offers, in the engine's terms. */
function offered(answer: GrantAnswer): Covers[] {
  const kinds = new Set<Covers>();
  const kindOf = (scope: { readonly kind: ConversationPermission["kind"] }) =>
    scope.kind === "connector-tool"
      ? "tool"
      : scope.kind === "destination"
        ? "destination"
        : scope.kind === "uncopied-file"
          ? "uncopied-file"
          : "file-or-folder";
  if (answer.candidate) kinds.add(kindOf(answer.candidate));
  if (answer.files?.file) kinds.add(kindOf(answer.files.file));
  if (answer.files?.folder) kinds.add(kindOf(answer.files.folder));
  return [...kinds];
}

describe("the engine and the grant rules", () => {
  it("agree, for every combination of effects, on which kind of grant may cover a call", async () => {
    const engine = new GuardedPermissionEngine();
    const rules = new StandingGrantRules(places);
    // One example of each kind of disagreement, by who made the call and
    // what each side said.
    const disagreements = new Map<string, string>();
    let walked = 0;
    for (const [who, caller] of Object.entries(callers))
      for (const [held, conversation] of Object.entries(conversations))
        for (const effects of everyEffects())
          for (const names of namings(effects)) {
            walked += 1;
            const inspection = inspecting(caller, effects, names);
            const decision = await engine.decide(
              acting(caller, inspection, conversation),
            );
            const answer = await rules.grants({
              owner: caller.owner,
              name: "act",
              inspection,
              decision,
              granted: [],
              digest: async () => "now",
              standing: async () => "now",
            });
            const said =
              decision.outcome === "ask" && decision.covers !== "never"
                ? [decision.covers ?? "tool"]
                : [];
            const offers = offered(answer);
            const kind = `${who}: the engine says ${said.join() || "no grant"} covers it; the rules offer ${offers.join() || "none"}`;
            if (said.join() !== offers.join() && !disagreements.has(kind))
              disagreements.set(
                kind,
                `${kind}, as for ${JSON.stringify(effects)} in a ${held} conversation, naming ${names}`,
              );
          }

    expect(walked).toBeGreaterThan(100_000);
    expect([...disagreements.values()]).toEqual([]);
  });
});
