import { describe, expect, it } from "vitest";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { WorkspaceTools } from "@zhiyin/tools";
import { GuardedPermissionEngine } from "@zhiyin/permission-engine";
import { stubDependencies, until, loopFrom } from "./support.js";

/**
 * The engine decides on what the implementation declared, and the loop is the
 * only thing that carries the declaration across. These run the real tools
 * through the real engine, because a stub on either side would prove that the
 * stub agrees with itself.
 */
describe("read scope", () => {
  async function readWith(path: string) {
    const parent = await mkdtemp(join(tmpdir(), "zhiyin-read-scope-"));
    const root = join(parent, "workspace");
    await mkdir(root);
    await writeFile(join(root, "inside.txt"), "in", "utf8");
    await writeFile(join(parent, "outside.txt"), "out", "utf8");
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      permissions: new GuardedPermissionEngine(),
      tools: workspace,
      workspace,
      model: {
        ...deps.model,
        send: (function () {
          let requests = 0;
          return async function* () {
            requests += 1;
            if (requests === 1) {
              yield {
                kind: "toolCallDelta" as const,
                index: 0,
                callId: "read-1",
                name: "read_file",
                argumentsDelta: JSON.stringify({
                  path:
                    path === "inside"
                      ? "inside.txt"
                      : join(parent, "outside.txt"),
                }),
              };
            } else {
              yield { kind: "textDelta" as const, text: "Read." };
            }
            yield { kind: "done" as const };
          };
        })(),
      },
    });
    const taskId = await loop.createTask();
    return { loop, taskId };
  }

  it("reads a workspace file without interrupting anyone", async () => {
    const { loop, taskId } = await readWith("inside");

    await loop.start(taskId, "Read the note");

    expect(loop.snapshot().tasks[0]?.phase.kind).toBe("completed");
    expect(loop.snapshot().tasks[0]?.actions).toEqual([
      expect.objectContaining({ status: "completed" }),
    ]);
  });

  it("asks before reading a file outside the selected folder", async () => {
    const { loop, taskId } = await readWith("outside");

    const running = loop.start(taskId, "Read the other note");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "approval");
    const phase = loop.snapshot().tasks[0]?.phase;
    if (phase?.kind !== "approval") throw new Error("Missing approval");

    // The prompt's wording is the presentation layer's; what this pins is that
    // a person was asked at all, and that the file they were asked about is
    // the one outside the folder they chose.
    expect(phase.prompt.target).toContain("outside.txt");
    await loop.resolveApproval(taskId, phase.prompt.id, "deny");
    await running;
  });
});

describe("approval binding", () => {
  it("rejects an out-of-workspace path before permission or execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-authority-"));
    const outside = join(dirname(root), "outside-authority.txt");
    const workspace = new WorkspaceTools(root, { shell: undefined });
    let permissionChecks = 0;
    let modelRequests = 0;
    const deps = stubDependencies(() => {});
    const loop = loopFrom({
      ...deps,
      permissions: {
        decide: async () => {
          permissionChecks += 1;
          return { outcome: "allow", reason: "Would allow if reached." };
        },
      },
      tools: workspace,
      workspace,
      model: {
        ...deps.model,
        send: async function* () {
          modelRequests += 1;
          if (modelRequests === 1) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "escape",
              name: "write_file",
              // `text`, not `content`: with the wrong field name this call is
              // refused for its shape before the path is ever examined, and
              // the test passes without exercising the boundary it names.
              argumentsDelta: JSON.stringify({
                path: "../outside-authority.txt",
                text: "escaped",
              }),
            };
          } else {
            yield { kind: "textDelta", text: "The path was rejected." };
          }
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Write outside the workspace");

    expect(permissionChecks).toBe(0);
    await expect(access(outside)).rejects.toMatchObject({ code: "ENOENT" });
    expect(loop.snapshot().tasks[0]?.actions).toEqual([
      expect.objectContaining({ status: "failed" }),
    ]);
  });

  it("does not let a stale decision approve a later call that reused a model call id", async () => {
    let requestCount = 0;
    const executed: string[] = [];
    const loop = loopFrom({
      ...stubDependencies(() => {}),
      permissions: {
        decide: async () => ({ outcome: "ask", reason: "Review it." }),
      },
      tools: {
        list: () => [
          {
            name: "write_file",
            description: "Write a file.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async (_name, args) => {
          const path = (args as { path: string }).path;
          return {
            ok: true,
            action: "Write a workspace file",
            target: path,
            command: `write_file(${JSON.stringify(args)})`,
          };
        },
        execute: async (_name, args) => {
          executed.push((args as { path: string }).path);
          return { ok: true, value: {} };
        },
      },
      model: {
        ...stubDependencies(() => {}).model,
        send: async function* () {
          requestCount += 1;
          if (requestCount <= 2) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "model-reused-this-id",
              name: "write_file",
              argumentsDelta: JSON.stringify({
                path: requestCount === 1 ? "first.md" : "second.md",
                content: "content",
              }),
            };
          } else {
            yield { kind: "textDelta", text: "Done." };
          }
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    const running = loop.start(taskId, "Write two files");
    await until(() => loop.snapshot().tasks[0]?.phase.kind === "approval");
    const firstPhase = loop.snapshot().tasks[0]?.phase;
    if (firstPhase?.kind !== "approval") throw new Error("Missing approval");
    const firstApprovalId = firstPhase.prompt.id;
    await loop.resolveApproval(taskId, firstApprovalId, "allow");

    await until(() => {
      const phase = loop.snapshot().tasks[0]?.phase;
      return phase?.kind === "approval" && phase.prompt.target === "second.md";
    });
    const secondPhase = loop.snapshot().tasks[0]?.phase;
    if (secondPhase?.kind !== "approval") throw new Error("Missing approval");

    expect(secondPhase.prompt.id).not.toBe(firstApprovalId);
    await expect(
      loop.resolveApproval(taskId, firstApprovalId, "allow"),
    ).rejects.toThrow("no longer active");
    expect(executed).toEqual(["first.md"]);

    await loop.resolveApproval(taskId, secondPhase.prompt.id, "allow");
    await running;
    expect(executed).toEqual(["first.md", "second.md"]);
  });
});

/**
 * Going back over a turn warns only when the turn may have changed something,
 * so the record says which actions the app itself knows changed nothing. That
 * is the engine's own trust rule: a read declared by code the app wrote.
 */
describe("what an action is recorded as having changed", () => {
  it("marks only an app-declared read as changing nothing; a write and a connector that calls itself read-only are not", async () => {
    const root = await mkdtemp(join(tmpdir(), "zhiyin-read-only-"));
    await writeFile(join(root, "notes.md"), "notes", "utf8");
    const workspace = new WorkspaceTools(root, { shell: undefined });
    const deps = stubDependencies(() => {});
    let requests = 0;
    const loop = loopFrom({
      ...deps,
      permissions: {
        decide: async () => ({ outcome: "allow", reason: "Allowed here." }),
      },
      tools: workspace,
      workspace,
      mcp: {
        ...deps.mcp,
        availableTools: async () => [
          {
            name: "external_lookup",
            description: "Look up external data.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true,
          action: "Look up external data",
          target: "test service",
          command: "external_lookup({})",
          access: "read",
          scope: "workspace",
        }),
        execute: async () => ({ ok: true, value: { answer: 42 } }),
      },
      model: {
        ...deps.model,
        send: async function* () {
          requests += 1;
          if (requests === 1) {
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "read",
              name: "read_file",
              argumentsDelta: JSON.stringify({ path: "notes.md" }),
            };
            yield {
              kind: "toolCallDelta",
              index: 1,
              callId: "write",
              name: "write_file",
              argumentsDelta: JSON.stringify({
                path: "answer.md",
                text: "answer",
              }),
            };
            yield {
              kind: "toolCallDelta",
              index: 2,
              callId: "lookup",
              name: "external_lookup",
              argumentsDelta: "{}",
            };
          } else {
            yield { kind: "textDelta", text: "Done." };
          }
          yield { kind: "done" };
        },
      },
    });
    const taskId = await loop.createTask();

    await loop.start(taskId, "Read, write and look up");

    const recorded = loop.snapshot().tasks[0]?.actions ?? [];
    expect(
      recorded.map((action) => [action.toolName, action.readOnly ?? false]),
    ).toEqual([
      ["read_file", true],
      ["write_file", false],
      ["external_lookup", false],
    ]);
  });
});
