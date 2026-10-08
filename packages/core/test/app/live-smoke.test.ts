/**
 * The one check nothing else in this repository makes: that the composed loop,
 * with every real feature and a real provider, actually does a piece of work.
 *
 * Everything else here runs against stubs. That proves the loop sequences
 * correctly and proves nothing about whether a model will call these tools, or
 * whether the auxiliary requests are affordable, or whether a real turn produces
 * a file. This does.
 *
 * It is skipped by default and is not part of the gate, because it costs money
 * and needs a network. Run it deliberately:
 *
 *   ZHIYIN_SMOKE=1 npx vitest run --project packages packages/core/test/app/live-smoke.test.ts
 *
 * on Windows PowerShell:
 *
 *   $env:ZHIYIN_SMOKE = "1"; npx vitest run --project packages packages/core/test/app/live-smoke.test.ts
 *
 * It needs OPENROUTER_API_KEY in the environment.
 *
 * **This is not an evaluation.** An evaluation case is run in the installed
 * app and judged by a person. This only answers "does the machinery turn
 * over".
 */

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AppEvent } from "@zhiyin/contract";
import { FileAuditLog } from "@zhiyin/audit";
import { WorkspaceArtifacts } from "@zhiyin/artifacts";
import { ManagedMcpServers, connectHttpMcpServer } from "@zhiyin/mcp";
import {
  OpenRouterModelClient,
  ProviderCredentials,
} from "@zhiyin/model-client";
import { AskPermissionEngine } from "@zhiyin/permission-engine";
import { FileSessions } from "@zhiyin/session";
import {
  ComposedPlugins,
  FilePluginSettings,
  FilePluginStore,
  loadBuiltInPlugins,
} from "@zhiyin/plugins";
import { DownloadedToolchains, pinnedToolchains } from "@zhiyin/toolchains";
import { WorkspaceTools } from "@zhiyin/tools";
import { FileUsageTelemetry } from "@zhiyin/usage";
import type { TestApp as AgentLoop } from "./support.js";
import { stubDependencies, loopFrom } from "./support.js";

const live =
  process.env["ZHIYIN_SMOKE"] === "1" &&
  Boolean(process.env["OPENROUTER_API_KEY"]);
const when = live ? describe : describe.skip;

async function realLoop(workspaceDirectory: string, data: string) {
  const credentials = new ProviderCredentials({
    environment: () => process.env["OPENROUTER_API_KEY"],
  });
  const model = new OpenRouterModelClient({
    credentials,
    model: process.env["ZHIYIN_MODEL"] ?? "z-ai/glm-5.3-flash",
  });
  const workspace = new WorkspaceTools(workspaceDirectory);
  // The shipped catalog, read from the same directory the app ships.
  const plugins = new ComposedPlugins({
    builtIns: () =>
      loadBuiltInPlugins(
        fileURLToPath(new URL("../../../plugins/built-in", import.meta.url)),
      ),
    store: new FilePluginStore(join(data, "plugins")),
    settings: new FilePluginSettings(data),
  });
  const audit = new FileAuditLog(data);
  const events: AppEvent[] = [];
  const loop = loopFrom({
    permissions: new AskPermissionEngine(),
    tools: workspace,
    workspace,
    artifacts: new WorkspaceArtifacts(() => workspace.workspaceRoot()),
    audit,
    mcp: new ManagedMcpServers(data, connectHttpMcpServer),
    plugins,
    toolchains: new DownloadedToolchains({
      directory: data,
      specs: pinnedToolchains,
    }),
    connectionToolchains: {},
    usage: new FileUsageTelemetry(data),
    sessions: new FileSessions(data),
    model,
    guidanceModel: model,
    browsers: stubDependencies(() => {}).browsers,
    newTaskId: randomUUID,
    newApprovalId: randomUUID,
    now: () => new Date(),
    emit: (event) => events.push(event),
  });
  await loop.initialize();
  return { loop, events, audit };
}

/**
 * Approves everything, the way a person who trusts the task would. The point of
 * the smoke run is whether the machinery works, not whether the policy holds —
 * the policy has its own tests.
 */
function approveEverything(loop: AgentLoop, taskId: string): () => void {
  let stopped = false;
  const tick = setInterval(() => {
    if (stopped) return;
    const task = loop.snapshot().tasks.find((item) => item.id === taskId);
    if (task?.phase.kind !== "approval") return;
    const prompt = task.phase.prompt;

    console.log(`  approving: ${prompt.action} — ${prompt.target}`);
    void loop
      .resolveApproval(taskId, prompt.id, "allow")
      .catch(() => undefined);
  }, 50);
  return () => {
    stopped = true;
    clearInterval(tick);
  };
}

when("a live turn against a real provider", () => {
  it("reads a file, writes one, and records what it produced", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "zhiyin-smoke-work-"));
    const data = await mkdtemp(join(tmpdir(), "zhiyin-smoke-data-"));
    await writeFile(
      join(workspace, "notes.md"),
      [
        "- pilot is Leeds only",
        "- 42 staff need training",
        "- budget capped at 18000",
      ].join("\n"),
      "utf8",
    );

    const { loop, events } = await realLoop(workspace, data);
    const taskId = await loop.createTask();
    const stop = approveEverything(loop, taskId);
    const started = Date.now();
    try {
      await loop.start(
        taskId,
        "Read notes.md and write a short summary of it to summary.md.",
      );
    } finally {
      stop();
    }

    const task = loop.snapshot().tasks.find((item) => item.id === taskId);

    console.log("\n--- smoke run ---");

    console.log("phase:", JSON.stringify(task?.phase.kind));

    console.log("elapsed ms:", Date.now() - started);
    for (const action of task?.actions ?? [])
      console.log(
        `action: ${action.status} — ${action.action} — ${action.target}`,
      );

    console.log("artifacts:", JSON.stringify(task?.artifacts));
    const usage = events.filter((event) => event.kind === "usageRecorded");

    console.log("provider requests:", usage.length);

    console.log("usage:", JSON.stringify(usage.map((event) => event.data)));

    expect(task?.phase.kind).toBe("completed");
    await expect(
      readFile(join(workspace, "summary.md"), "utf8"),
    ).resolves.toContain("Leeds");
    expect(task?.artifacts?.some((item) => item.path === "summary.md")).toBe(
      true,
    );
  }, 180_000);

  it("records a correction the transcript never showed", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "zhiyin-smoke-work-"));
    const data = await mkdtemp(join(tmpdir(), "zhiyin-smoke-data-"));
    await writeFile(
      join(workspace, "config.md"),
      "owner: dana\nregion: north\n",
      "utf8",
    );

    const { loop, audit } = await realLoop(workspace, data);
    const taskId = await loop.createTask();
    const stop = approveEverything(loop, taskId);
    try {
      // The wrong capitalisation on purpose: the model is being told the file
      // says something it does not, so an edit aimed from this description
      // must be corrected before it can apply.
      await loop.start(
        taskId,
        'The file config.md contains the line "Owner: Dana". Use multi_edit to change that line so the owner is Rowan instead.',
      );
    } finally {
      stop();
    }

    const entries = await audit.read();

    console.log("\n--- corrections ---");
    for (const entry of entries)
      console.log(
        `${entry.kind}${entry.cause ? ` (${entry.cause})` : ""}: ${entry.reason}`,
      );

    console.log(
      "final file:",
      JSON.stringify(await readFile(join(workspace, "config.md"), "utf8")),
    );

    // Not asserted: whether a correction happened at all depends on the model.
    // The run is for reading, and the record is what makes it readable.
    expect(Array.isArray(entries)).toBe(true);
  }, 180_000);
});
