/**
 * What a conversation grants its sealed-off commands (ADR 0029): a request
 * the person allows becomes a grant holding the conversation's facts as its
 * card stated them; one the conversation outgrows is confirmed on one card
 * before a command reaches it, and taken back when it is not; and three
 * requests declined in a row end the turn.
 */

import { afterEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolCallInspection, ToolSpec } from "@zhiyin/contract";
import { GuardedPermissionEngine } from "@zhiyin/permission-engine";
import { TemporaryFolders } from "@zhiyin/test-support";
import { shellReach } from "../src/tools/shell-reach.js";
import {
  loopFrom,
  stubDependencies,
  until,
  type TurnTestApp,
} from "./support.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const effects = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
} as const;

const specs: ToolSpec[] = ["request_access", "fetch_page", "bash"].map(
  (name) => ({ name, description: name, inputSchema: { type: "object" } }),
);

type Call = { readonly name: string; readonly args: Record<string, unknown> };

/**
 * A conversation whose model makes `calls` one round each, against tools
 * that say what the shell's do: a request for a website, a page fetched from
 * outside, and a sealed-off command reaching what the conversation granted.
 */
async function conversation(calls: readonly Call[]) {
  const root = await folders.make("zhiyin-reach-");
  // A file of the person's: something private is within reach.
  await writeFile(join(root, "notes.md"), "Private notes.\n");
  const deps = stubDependencies(() => {});
  const ran: { readonly name: string; readonly hosts?: readonly string[] }[] =
    [];
  let taskId = "";
  const inspect = async (name: string): Promise<ToolCallInspection> => {
    if (name === "request_access")
      return {
        ok: true,
        action: "Let commands reach a website",
        target: "example.com and every name below it",
        command: "request_access(example.com)",
        asksEachTime: true,
        effects,
        grants: {
          kind: "website",
          label: "example.com and every name below it",
          hosts: ["example.com", "*.example.com"],
        },
      };
    if (name === "fetch_page")
      return {
        ok: true,
        action: "Fetch a page",
        target: "https://example.org",
        command: "fetch_page()",
        effects: { ...effects, brings: "outside" },
      };
    const reach = loop.shellReach(taskId);
    return {
      ok: true,
      action: "Run a sealed-off command",
      target: "ls",
      command: `bash(ls, ${reach.hosts.join(",")}, ${reach.registries})`,
      effects: {
        ...effects,
        reads: "workspace",
        runs: "sealed",
        sends: "service",
      },
      reachesGrants: true,
    };
  };
  let request = 0;
  const loop: TurnTestApp = loopFrom({
    ...deps,
    permissions: new GuardedPermissionEngine(),
    workspace: { ...deps.workspace, workspaceRoot: () => root },
    tools: {
      list: () => specs,
      inspect,
      execute: async (name) => {
        ran.push(
          name === "bash"
            ? { name, hosts: loop.shellReach(taskId).hosts }
            : { name },
        );
        return { ok: true, value: "Done." };
      },
    },
    model: {
      ...deps.model,
      send: async function* () {
        const call = calls[request];
        request += 1;
        if (call)
          yield {
            kind: "toolCallDelta" as const,
            index: 0,
            callId: `call-${request}`,
            name: call.name,
            argumentsDelta: JSON.stringify(call.args),
          };
        else yield { kind: "textDelta" as const, text: "Done." };
        yield { kind: "done" as const };
      },
    },
  });
  taskId = await loop.createTask();
  const task = () => loop.snapshot().tasks.find((each) => each.id === taskId)!;
  /** The next card, answered. */
  const answer = async (choice: "allow" | "deny") => {
    await until(() => task().phase.kind === "approval");
    const phase = task().phase;
    if (phase.kind !== "approval") throw new Error("Not asked");
    const asked = {
      action: phase.prompt.action,
      target: phase.prompt.target,
      reach: phase.prompt.reach,
    };
    await loop.resolveApproval(taskId, phase.prompt.id, choice);
    await until(
      () =>
        task().phase.kind !== "approval" ||
        (task().phase as { prompt: { id: string } }).prompt.id !==
          phase.prompt.id,
    );
    return asked;
  };
  return { loop, taskId, task, answer, ran };
}

describe("what sealed-off commands are granted", () => {
  it("keeps a website the person allowed as a grant with the facts its card stated, which commands then reach", async () => {
    const { loop, taskId, task, answer, ran } = await conversation([
      { name: "request_access", args: { host: "example.com" } },
      { name: "bash", args: { command: "ls" } },
    ]);

    const running = loop.start(taskId, "Fetch the data");
    await answer("allow");
    await running;

    expect(task().conversationPermissions).toEqual([
      expect.objectContaining({
        kind: "reach-host",
        hosts: ["example.com", "*.example.com"],
        facts: { outsideContent: false, privateWithinReach: true },
      }),
    ]);
    expect(ran).toEqual([
      { name: "request_access" },
      { name: "bash", hosts: ["example.com", "*.example.com"] },
    ]);
  });

  it("says on a website's card that what the conversation can read could be sent there, once something private is within reach", async () => {
    const { loop, taskId, task } = await conversation([
      { name: "request_access", args: { host: "example.com" } },
    ]);

    const running = loop.start(taskId, "Fetch the data");
    await until(() => task().phase.kind === "approval");
    const phase = task().phase;
    if (phase.kind !== "approval") throw new Error("Not asked");

    expect(phase.prompt.detail).toContain(
      "could be sent to anyone who uses that website",
    );
    await loop.resolveApproval(taskId, phase.prompt.id, "deny");
    await running;
  });

  it("confirms on one card each grant the conversation outgrew, with the registries, and takes back what the person declines", async () => {
    const { loop, taskId, task, answer, ran } = await conversation([
      { name: "request_access", args: { host: "example.com" } },
      { name: "fetch_page", args: {} },
      { name: "bash", args: { command: "ls" } },
    ]);

    const running = loop.start(taskId, "Fetch the data");
    const granting = await answer("allow");
    const confirming = await answer("deny");
    await running;

    expect(granting.reach).toEqual({ kind: "grant" });
    expect(confirming).toEqual({
      action: "Keep letting commands reach these?",
      target:
        "Commands may reach example.com and every name below it; Commands may reach the package registries and Git hosts Zhiyin lists",
      reach: {
        kind: "confirm",
        places: [
          {
            label: "Commands may reach example.com and every name below it",
            kind: "website",
          },
          {
            label:
              "Commands may reach the package registries and Git hosts Zhiyin lists",
            kind: "website",
          },
        ],
        since:
          "This conversation has now read content from outside, and something private is within reach: a command could send what it reads to these places, or download something that steers the work.",
      },
    });
    expect(task().conversationPermissions).toEqual([
      expect.objectContaining({ kind: "reach-registries", declined: true }),
    ]);
    expect(loop.shellReach(taskId)).toEqual({
      hosts: [],
      read: [],
      change: [],
      registries: false,
    });
    expect(ran.at(-1)).toEqual({ name: "bash", hosts: [] });
  });

  it("keeps what the person confirms, asking no more while the facts stay", async () => {
    const { loop, taskId, task, answer, ran } = await conversation([
      { name: "request_access", args: { host: "example.com" } },
      { name: "fetch_page", args: {} },
      { name: "bash", args: { command: "ls" } },
      { name: "bash", args: { command: "ls" } },
    ]);

    const running = loop.start(taskId, "Fetch the data");
    await answer("allow");
    await answer("allow");
    await running;

    expect(task().conversationPermissions).toEqual([
      expect.objectContaining({
        kind: "reach-host",
        facts: { outsideContent: true, privateWithinReach: true },
      }),
      expect.objectContaining({ kind: "reach-registries" }),
    ]);
    expect(ran.filter((each) => each.name === "bash")).toHaveLength(2);
  });

  it("holds a grant only in the folder the conversation worked in when it was made", () => {
    const granted = {
      conversationPermissions: [
        {
          id: "g1",
          at: "2026-11-21T00:00:00.000Z",
          kind: "reach-folder" as const,
          label: "Commands may read C:\\Data",
          toolName: "bash",
          folder: "C:\\Data",
          workspaceRoot: "C:\\Work\\one",
          facts: { outsideContent: false, privateWithinReach: true },
        },
      ],
    };

    expect(shellReach(granted, "C:\\work\\ONE").read).toEqual(["C:\\Data"]);
    expect(shellReach(granted, "C:\\Work\\two").read).toEqual([]);
  });

  it("ends the turn, saying why, when the person declines three requests in a row", async () => {
    const asking = { name: "request_access", args: { host: "example.com" } };
    const { loop, taskId, task, answer, ran } = await conversation([
      asking,
      asking,
      asking,
      asking,
    ]);

    const running = loop.start(taskId, "Fetch the data");
    await answer("deny");
    await answer("deny");
    await answer("deny");
    await running;

    expect(task().phase).toEqual({
      kind: "interrupted",
      reason: expect.stringContaining("declined 3 requests in a row"),
    });
    expect(ran).toEqual([]);
  });
});
