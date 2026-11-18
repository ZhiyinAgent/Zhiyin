/**
 * A file change by Zhiyin's own tools, as the person meets it: allowed once,
 * or for the conversation by the file or its folder, the conversation's own
 * folder included. Outside that folder it is asked for by its whole real
 * path, backed up first and put back by going back. Zhiyin's own folders are
 * never written, whatever is approved.
 */

import { afterEach, describe, expect, it } from "vitest";
import { ConversationRewind } from "@zhiyin/rewind-planner";
import { GuardedPermissionEngine } from "@zhiyin/permission-engine";
import { FileRecovery } from "@zhiyin/recovery";
import { WorkspaceTools } from "@zhiyin/tools";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { TemporaryFolders } from "@zhiyin/test-support";
import { loopFrom, stubDependencies, until } from "./support.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

type Call = { readonly name: string; readonly args: Record<string, unknown> };
type Answer = "allow" | "allow-file" | "allow-folder" | "deny";

/**
 * One turn whose model makes `calls` in order, each approval answered from
 * `answers` in order. Says what each approval asked about.
 */
async function turn(options: {
  readonly calls: (place: Places) => readonly Call[];
  readonly answers: readonly Answer[];
  readonly between?: (place: Places, index: number) => Promise<void>;
  readonly mcp?: (
    place: Places,
    deps: ReturnType<typeof stubDependencies>,
  ) => ReturnType<typeof stubDependencies>["mcp"];
}) {
  const parent = await folders.make("zhiyin-outside-");
  const root = join(parent, "workspace");
  const elsewhere = join(parent, "elsewhere");
  const beside = join(parent, "beside");
  const data = join(parent, "zhiyin-data");
  for (const folder of [root, elsewhere, beside, data])
    await mkdir(folder, { recursive: true });
  // The person's own folder, where a change asks (ADR 0012).
  await writeFile(join(root, "notes.md"), "The person's notes.", "utf8");
  const place: Places = { root, elsewhere, beside, data };
  const calls = options.calls(place);
  const tools = new WorkspaceTools(root, { shell: undefined, protect: [data] });
  const deps = stubDependencies(() => {});
  let request = 0;
  const agent = loopFrom({
    ...deps,
    ...(options.mcp ? { mcp: options.mcp(place, deps) } : {}),
    permissions: new GuardedPermissionEngine(),
    tools,
    workspace: tools,
    recovery: new FileRecovery(join(data, "recovery")),
    rewind: new ConversationRewind(() => `rewind-${request}`),
    model: {
      ...deps.model,
      send: async function* () {
        request += 1;
        const call = calls[request - 1];
        if (call) {
          await options.between?.(place, request - 1);
          yield {
            kind: "toolCallDelta",
            index: 0,
            callId: `call-${request}`,
            name: call.name,
            argumentsDelta: JSON.stringify(call.args),
          };
        } else yield { kind: "textDelta", text: "Done." };
        yield { kind: "done" };
      },
    },
  });
  await agent.selectWorkspace(root);
  const taskId = await agent.createTask();
  const asked: {
    target: string;
    fileRules?: readonly { choice: string; label: string }[];
  }[] = [];
  let finished = false;
  const running = agent.start(taskId, "Write the files").finally(() => {
    finished = true;
  });
  for (const answer of options.answers) {
    await until(
      () => finished || agent.snapshot().tasks[0]?.phase.kind === "approval",
    );
    const phase = agent.snapshot().tasks[0]!.phase;
    if (phase.kind !== "approval") break;
    asked.push({
      target: phase.prompt.target,
      ...(phase.prompt.fileRules ? { fileRules: phase.prompt.fileRules } : {}),
    });
    await agent.resolveApproval(taskId, phase.prompt.id, answer);
    await until(
      () =>
        finished ||
        agent.snapshot().tasks[0]?.phase.kind !== "approval" ||
        (agent.snapshot().tasks[0]!.phase as { prompt?: { id: string } }).prompt
          ?.id !== phase.prompt.id,
    );
  }
  await running;
  return { agent, taskId, asked, place };
}

type Places = {
  readonly root: string;
  readonly elsewhere: string;
  readonly beside: string;
  readonly data: string;
};

const write = (path: string, content: string): Call => ({
  name: "write_file",
  args: { path, content },
});

describe("writing outside the conversation's folder", () => {
  it("asks by the whole real path, offering the file or its folder, and goes back by removing the file it made", async () => {
    const { agent, taskId, asked, place } = await turn({
      calls: ({ elsewhere }) => [
        write(join(elsewhere, "report.md"), "Report."),
      ],
      answers: ["allow"],
    });
    const report = join(place.elsewhere, "report.md");

    expect(asked).toEqual([
      {
        target: report,
        fileRules: [
          { choice: "file", label: "report.md" },
          { choice: "folder", label: `${place.elsewhere}${sep}` },
        ],
      },
    ]);
    expect(await readFile(report, "utf8")).toBe("Report.");

    const request = agent.snapshot().tasks[0]!.messages[0]!;
    const preview = await agent.rewinds.preview(taskId, request.id);
    const result = await agent.commitRewind(taskId, preview.id, "restore");

    expect(result.files).toEqual([
      { path: report.replaceAll("\\", "/"), status: "removed" },
    ]);
    await expect(stat(report)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("puts back the content a file outside had when going back over its change", async () => {
    const { agent, taskId } = await turn({
      calls: ({ elsewhere }) => [
        { name: "read_file", args: { path: join(elsewhere, "notes.md") } },
        write(join(elsewhere, "notes.md"), "Rewritten."),
      ],
      answers: ["allow", "allow"],
      between: async ({ elsewhere }, index) => {
        if (index === 0)
          await writeFile(join(elsewhere, "notes.md"), "The person's notes.");
      },
    });
    const notes = agent.snapshot().tasks[0]!.messages[0]!;
    const preview = await agent.rewinds.preview(taskId, notes.id);
    await agent.commitRewind(taskId, preview.id, "restore");

    const target = preview.files[0]!.path;
    expect(await readFile(target, "utf8")).toBe("The person's notes.");
  });

  it("allowed for the file, writes it again without asking, until it is changed elsewhere", async () => {
    const { asked, place } = await turn({
      calls: ({ elsewhere }) => [
        write(join(elsewhere, "plan.md"), "One."),
        write(join(elsewhere, "plan.md"), "Two."),
        { name: "read_file", args: { path: join(elsewhere, "plan.md") } },
        write(join(elsewhere, "plan.md"), "Three."),
      ],
      answers: ["allow-file", "allow", "allow"],
      between: async ({ elsewhere }, index) => {
        if (index === 2)
          await writeFile(join(elsewhere, "plan.md"), "Edited elsewhere.");
      },
    });
    const plan = join(place.elsewhere, "plan.md");

    // The first write, the read outside, and the write after the change
    // elsewhere: the second write ran under the grant.
    expect(asked.map((one) => one.target.replaceAll("\\", "/"))).toEqual(
      Array(3).fill(plan.replaceAll("\\", "/")),
    );
    expect(await readFile(plan, "utf8")).toBe("Three.");
  });

  it("allowed for the folder, writes any file in it or its folders without asking, and asks for one beside it", async () => {
    const { asked, place } = await turn({
      calls: ({ elsewhere, beside }) => [
        write(join(elsewhere, "a.md"), "A."),
        write(join(elsewhere, "deeper", "b.md"), "B."),
        write(join(beside, "c.md"), "C."),
      ],
      answers: ["allow-folder", "allow"],
    });

    expect(asked.map((one) => one.target)).toEqual([
      join(place.elsewhere, "a.md"),
      join(place.beside, "c.md"),
    ]);
    expect(
      await readFile(join(place.elsewhere, "deeper", "b.md"), "utf8"),
    ).toBe("B.");
  });

  it("edits a file outside by its path once it was read, asking by that path", async () => {
    const { asked, place } = await turn({
      calls: ({ elsewhere }) => [
        { name: "read_file", args: { path: join(elsewhere, "todo.md") } },
        {
          name: "multi_edit",
          args: {
            edits: [
              {
                path: join(elsewhere, "todo.md"),
                replacements: [{ find: "milk", replace: "bread" }],
              },
            ],
          },
        },
      ],
      answers: ["allow", "allow"],
      between: async ({ elsewhere }, index) => {
        if (index === 0)
          await writeFile(join(elsewhere, "todo.md"), "Buy milk.\n");
      },
    });
    const todo = join(place.elsewhere, "todo.md");

    expect(asked[1]).toMatchObject({
      target: todo,
      fileRules: [
        { choice: "file", label: "todo.md" },
        { choice: "folder", label: `${place.elsewhere}${sep}` },
      ],
    });
    expect(await readFile(todo, "utf8")).toBe("Buy bread.\n");
  });

  it("backs up a PDF a shipped connection compiles over outside, and puts it back by going back", async () => {
    const { agent, taskId, asked } = await turn({
      calls: () => [{ name: "compile_document", args: {} }],
      answers: ["allow"],
      between: async ({ elsewhere }) => {
        await writeFile(join(elsewhere, "paper.pdf"), "The first PDF.");
      },
      mcp: ({ elsewhere }, deps) => ({
        ...deps.mcp,
        availableTools: async () => [
          {
            name: "compile_document",
            description: "Compile a document.",
            inputSchema: { type: "object" },
          },
        ],
        inspect: async () => ({
          ok: true,
          action: "Compile a document",
          target: join(elsewhere, "paper.pdf"),
          command: "compile_document({})",
          // As the document compiler declares a PDF it writes outside.
          effects: {
            reads: "workspace" as const,
            changes: "elsewhere" as const,
            sends: "service" as const,
            actsAsPerson: "none" as const,
            runs: "none" as const,
            lasting: false,
            brings: "none" as const,
          },
          builtInConnection: true as const,
          changes: [
            { path: join(elsewhere, "paper.pdf"), change: "updated" as const },
          ],
        }),
        execute: async () => {
          await writeFile(join(elsewhere, "paper.pdf"), "The compiled PDF.");
          return { ok: true, value: "Compiled." };
        },
      }),
    });
    expect(asked).toHaveLength(1);
    const notes = agent.snapshot().tasks[0]!.messages[0]!;
    const preview = await agent.rewinds.preview(taskId, notes.id);
    await agent.commitRewind(taskId, preview.id, "restore");

    expect(await readFile(preview.files[0]!.path, "utf8")).toBe(
      "The first PDF.",
    );
  });

  it("never writes in Zhiyin's own folder, and asks nothing for it", async () => {
    const { asked, place } = await turn({
      calls: ({ data }) => [write(join(data, "approved.json"), "{}")],
      answers: ["allow"],
    });

    expect(asked).toEqual([]);
    await expect(stat(join(place.data, "approved.json"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  });
});

describe("moving files", () => {
  const move = (from: string, to: string): Call => ({
    name: "move_file",
    args: { from, to },
  });

  it("moves inside the folder, and going back puts the file back and takes the new one away", async () => {
    const { agent, taskId, place } = await turn({
      calls: () => [move("notes.md", "kept/notes.md")],
      answers: ["allow"],
    });
    expect(await readFile(join(place.root, "kept", "notes.md"), "utf8")).toBe(
      "The person's notes.",
    );

    const request = agent.snapshot().tasks[0]!.messages[0]!;
    const preview = await agent.rewinds.preview(taskId, request.id);
    await agent.commitRewind(taskId, preview.id, "restore");

    expect(await readFile(join(place.root, "notes.md"), "utf8")).toBe(
      "The person's notes.",
    );
    await expect(
      stat(join(place.root, "kept", "notes.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("asks by the whole real path for a move out of the folder, offering no grant, and goes back from it", async () => {
    const { agent, taskId, asked, place } = await turn({
      calls: ({ elsewhere }) => [move("notes.md", join(elsewhere, "notes.md"))],
      answers: ["allow"],
    });
    const moved = join(place.elsewhere, "notes.md");

    expect(asked).toEqual([{ target: "notes.md" }]);
    expect(await readFile(moved, "utf8")).toBe("The person's notes.");

    const request = agent.snapshot().tasks[0]!.messages[0]!;
    const preview = await agent.rewinds.preview(taskId, request.id);
    await agent.commitRewind(taskId, preview.id, "restore");

    expect(await readFile(join(place.root, "notes.md"), "utf8")).toBe(
      "The person's notes.",
    );
    await expect(stat(moved)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never moves anything into Zhiyin's own folder, and asks nothing for it", async () => {
    const { asked, place } = await turn({
      calls: ({ data }) => [move("notes.md", join(data, "notes.md"))],
      answers: ["allow"],
    });

    expect(asked).toEqual([]);
    expect(await readFile(join(place.root, "notes.md"), "utf8")).toBe(
      "The person's notes.",
    );
  });
});
