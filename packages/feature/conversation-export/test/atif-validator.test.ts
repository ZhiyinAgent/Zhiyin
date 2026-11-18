/**
 * The saved trajectory against ATIF's own validator: the one in the Harbor
 * project's `harbor` package, at the version checked when the format was
 * chosen. The .zip is opened with Windows' own `tar`, and the validator reads
 * what came out, pictures included.
 *
 * Skipped unless `uv` is named in the environment, because the gate installs
 * nothing; CI names it. uv installs harbor alone, without the services it
 * also depends on, and the one library its validator uses.
 *
 *   $env:ZHIYIN_UV = "…\uv.exe"; npx vitest run packages/feature/conversation-export
 */

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { emptyConversationLists, type WorkspaceTask } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import { conversationExport } from "../src/index.js";

const uv = process.env["ZHIYIN_UV"];
const harbor = "harbor==0.25.0";
const pydantic = "pydantic==2.14.1";

/** Windows' own tar, which a PATH with Git's tools would otherwise hide. */
const windowsTar = join(
  process.env["SystemRoot"] ?? "C:\\Windows",
  "System32",
  "tar.exe",
);

const folders = new TemporaryFolders();
afterAll(() => folders.removeAll());

const validate = [
  "import sys",
  "from harbor.utils.trajectory_validator import TrajectoryValidator",
  "checked = TrajectoryValidator()",
  "valid = checked.validate(sys.argv[1])",
  "print('\\n'.join(checked.get_errors() if hasattr(checked, 'get_errors') else checked.errors))",
  "sys.exit(0 if valid else 1)",
].join("\n");

function run(command: string, args: readonly string[], env = process.env) {
  const ran = spawnSync(command, args, { encoding: "utf8", env });
  return { status: ran.status, output: `${ran.stdout}${ran.stderr}` };
}

/** A conversation with every kind of step, a picture and a specialist. */
function conversation(): WorkspaceTask {
  return {
    ...emptyConversationLists,
    id: "task-1",
    title: "比较两张图表",
    titleSource: "generated",
    updatedAt: "2026-11-06T11:00:00.000Z",
    updatedLabel: "Today",
    phase: { kind: "completed", outcome: { title: "Done", summary: "Done." } },
    messages: [
      {
        id: "m1",
        role: "user",
        text: "哪个季度卖得更多？ “Q1” or “Q2”",
        attachments: [
          {
            kind: "picture",
            id: "p1",
            name: "q1.png",
            mediaType: "image/png",
            bytes: 5,
            source: "picture-1",
          },
        ],
        sequence: 0,
      },
      { id: "m2", role: "assistant", text: "第二季度。", sequence: 5 },
    ],
    modelHistory: [
      { id: "h1", kind: "message", messageId: "m1" },
      {
        id: "h2",
        kind: "calls",
        roundId: "r1",
        text: "",
        reasoning: "Both are needed.",
        calls: [
          { id: "c1", name: "read_file", arguments: '{"path":"q2.csv"}' },
          {
            id: "d1",
            name: "delegate_specialist",
            arguments: '{"id":"engineering/reviewer","task":"Check it."}',
          },
        ],
      },
      {
        id: "h3",
        kind: "result",
        callId: "c1",
        name: "read_file",
        content: "q2: 140",
      },
      {
        id: "h4",
        kind: "result",
        callId: "d1",
        name: "delegate_specialist",
        content: '{"ok":true,"runId":"run-1"}',
        runId: "run-1",
      },
      {
        id: "h5",
        kind: "pictures",
        text: "The chart.",
        pictures: [{ mediaType: "image/png", source: "picture-1" }],
      },
      { id: "h6", kind: "notice", content: "Today is Friday." },
      { id: "h7", kind: "message", messageId: "m2", roundId: "r2" },
    ],
    modelResponses: [
      {
        roundId: "r1",
        model: "deepseek/deepseek-v4",
        finishReason: "tool_calls",
        termination: "finishReason",
        complete: true,
        startedAt: "2026-11-06T11:00:01.000Z",
        usage: {
          inputTokens: 900,
          outputTokens: 40,
          cacheReadTokens: 800,
          costUsd: 0.001,
        },
      },
      {
        roundId: "r2",
        finishReason: "stop",
        termination: "finishReason",
        complete: true,
        usage: { inputTokens: 1000, outputTokens: 10 },
      },
    ],
    condensings: [
      {
        id: "k1",
        sequence: 4,
        createdAt: "2026-11-06T11:00:03.000Z",
        targetTokens: 60_000,
        tokensBefore: 90_000,
        outcome: "condensed",
        revision: 1,
        throughMessageId: "m1",
        tokensAfter: 20_000,
        messages: 1,
        actions: 1,
        summary: "The person asked which quarter sold more.",
      },
    ],
    specialistRuns: [
      {
        id: "run-1",
        specialist: {
          id: "engineering/reviewer",
          name: "Reviewer",
          description: "Reviews work.",
          instructions: "Review the evidence.",
          provenance: { source: "plugin", pluginId: "engineering" },
        },
        task: "Check it.",
        depth: 1,
        status: "completed",
        startedAt: "2026-11-06T11:00:02.000Z",
        finishedAt: "2026-11-06T11:00:03.000Z",
        sequence: 2,
        actionIds: [],
        handoff: { report: "It holds." },
        transcript: [
          {
            id: "s1",
            kind: "calls",
            roundId: "sr1",
            text: "",
            calls: [
              {
                id: "f1",
                name: "finish_specialist",
                arguments: '{"report":"It holds."}',
              },
            ],
          },
        ],
        modelResponses: [
          {
            roundId: "sr1",
            finishReason: "tool_calls",
            termination: "finishReason",
            complete: true,
            usage: { inputTokens: 300, outputTokens: 20 },
          },
        ],
      },
    ],
  };
}

describe.skipIf(!uv)("the trajectory against ATIF's validator", () => {
  it("is a valid ATIF trajectory, and the .zip opens with its pictures", async () => {
    const folder = await folders.make("zhiyin-atif-");
    const zip = join(folder, "export.zip");
    const saved = await conversationExport(() => ({
      appVersion: "0.1.0-alpha.3",
      exportedAt: new Date("2026-11-06T12:00:00.000Z"),
    })).save(
      conversation(),
      "trajectory",
      async () => zip,
      async () => ({
        status: "ready",
        mediaType: "image/png",
        data: "aGVsbG8=",
      }),
    );
    expect(saved).toEqual({ status: "saved", destination: zip });

    const opened = join(folder, "opened");
    expect(
      run("powershell", [
        "-NoProfile",
        "-Command",
        `New-Item -ItemType Directory '${opened}' | Out-Null`,
      ]).status,
    ).toBe(0);
    const unpacked = run(windowsTar, ["-xf", zip, "-C", opened]);
    expect(unpacked.output).toBe("");
    expect(
      await readFile(join(opened, "images", "picture-1.png"), "utf8"),
    ).toBe("hello");

    const site = join(folder, "site");
    const installed = run(uv as string, [
      "pip",
      "install",
      "--no-deps",
      "--target",
      site,
      harbor,
    ]);
    expect(installed.status, installed.output).toBe(0);
    const checked = run(
      uv as string,
      [
        "run",
        "--no-project",
        "--isolated",
        "--python",
        "3.12",
        "--with",
        pydantic,
        "python",
        "-c",
        validate,
        join(opened, "trajectory.json"),
      ],
      { ...process.env, PYTHONPATH: site, PYTHONUTF8: "0" },
    );
    expect(checked.status, checked.output).toBe(0);
  }, 300_000);
});
