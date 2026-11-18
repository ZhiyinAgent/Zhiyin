/**
 * What the model opened of the catalog stays (ADR 0016): clearing old
 * results leaves a skill and a toolkit as they were, and after condensing
 * Zhiyin opens again what the summary replaced. A specialist's start names
 * only the tools it has.
 */

import { describe, expect, it } from "vitest";
import type { ModelRequest } from "@zhiyin/model-client";
import {
  overCatalog,
  toolNames,
  type MadeUpPlugin,
  type Step,
} from "./catalog-fixture.js";
import { until } from "./support.js";

const rendering: MadeUpPlugin = {
  id: "3d-rendering",
  cores: ["open_scene"],
  toolkits: [{ id: "surfacing", tools: ["set_material"] }],
  skills: [
    {
      id: "staging",
      description: "Stage a scene.",
      text: "Block out the scene before any detail.",
    },
  ],
};

const skillAnswer =
  '<zhiyin-notice kind="skill">Block out the scene before any detail.</zhiyin-notice>';

/** Text the size of `tokens` estimated tokens. */
function sized(tokens: number): string {
  return "report ".repeat(Math.ceil((tokens * 3) / 7));
}

function condensingAsked(request: ModelRequest): boolean {
  const last = request.messages.at(-1)?.content;
  return typeof last === "string" && last.includes('kind="condense"');
}

/** Opens what `opens` names, then reads in rounds of three, then answers. */
function openThenRead(opens: readonly string[], rounds: number) {
  let worked = 0;
  return (_request: number, sent: ModelRequest): Step => {
    if (condensingAsked(sent))
      return { text: JSON.stringify({ summary: "Staged and read." }) };
    worked += 1;
    const open = opens[worked - 1];
    if (open)
      return {
        calls: [{ name: "open", id: `open-${worked}`, args: { id: open } }],
      };
    if (worked > opens.length + rounds) return { text: "Done." };
    return {
      calls: [0, 1, 2].map((index) => ({
        name: "read_file",
        id: `read-${worked}-${index}`,
        args: { path: `part-${worked}-${index}` },
      })),
    };
  };
}

function contents(request: ModelRequest | undefined): string[] {
  return (request?.messages ?? []).flatMap((message) =>
    typeof message.content === "string" ? [message.content] : [],
  );
}

const endless = {
  maximumElapsedMs: 1e12,
  maximumTokens: 1e12,
  maximumProviderCostUsd: 1e9,
  maximumToolRounds: 1_000,
};

describe("a skill the model opened", () => {
  it("stays as it was when older results are cleared", async () => {
    const fixture = overCatalog({
      plugins: [rendering],
      script: openThenRead(["skill:3d-rendering/staging"], 20),
      answer: () => ({ text: sized(6_500) }),
      more: {
        workLimits: endless,
        modelWindow: {
          model: "wide",
          contextWindow: 1_000_000,
          maximumOutputTokens: 131_072,
        },
        defaultContextBudget: "ultra",
      },
    });
    await fixture.loop.start(await fixture.loop.createTask(), "Stage it");

    const last = fixture.requests.at(-1);
    expect(contents(last).some((text) => text.includes('kind="cleared"'))).toBe(
      true,
    );
    expect(contents(last)).toContain(skillAnswer);
  });

  it("is opened again by Zhiyin after condensing, and an opened toolkit is loaded again where it is", async () => {
    const fixture = overCatalog({
      plugins: [rendering],
      route: "native",
      script: openThenRead(
        ["skill:3d-rendering/staging", "toolkit:3d-rendering/surfacing"],
        12,
      ),
      answer: () => ({ text: sized(800) }),
      more: {
        workLimits: endless,
        modelWindow: {
          model: "small",
          contextWindow: 16_000,
          maximumOutputTokens: 100,
        },
      },
    });
    const taskId = await fixture.loop.createTask();
    await fixture.loop.start(taskId, "Stage it");

    const asked = fixture.requests.findIndex(condensingAsked);
    expect(asked).toBeGreaterThan(0);
    const after = fixture.requests[asked + 1];
    expect(contents(after)).toContain(skillAnswer);
    const reopened = (after?.messages ?? []).find(
      (message) =>
        message.role === "assistant" &&
        message.toolCalls?.some((call) => call.name === "open"),
    );
    expect(reopened).toEqual({
      role: "assistant",
      content: "",
      toolCalls: [
        expect.objectContaining({
          name: "open",
          arguments: JSON.stringify({ id: "skill:3d-rendering/staging" }),
        }),
        expect.objectContaining({
          name: "open",
          arguments: JSON.stringify({ id: "toolkit:3d-rendering/surfacing" }),
        }),
      ],
    });
    const toolkitAnswer = (after?.messages ?? []).findIndex(
      (message) =>
        message.role === "tool" &&
        message.content.startsWith('<zhiyin-notice kind="toolkit">'),
    );
    expect(after?.loads).toEqual([
      {
        tools: [expect.objectContaining({ name: "set_material" })],
        after: toolkitAnswer,
      },
    ]);
    // Reopened from what the conversation did, not as a new action of its own.
    expect(
      fixture.loop
        .snapshot()
        .tasks[0]?.actions?.filter((action) => action.toolName === "open"),
    ).toHaveLength(2);
  });
});

describe("a specialist", () => {
  const studio: MadeUpPlugin = {
    id: "studio",
    cores: ["browser_preview"],
    toolkits: [{ id: "surfacing", tools: ["set_material"] }],
    specialists: [
      {
        id: "painter",
        description: "Paints what it is told to.",
        tools: ["read_file", "set_material"],
      },
    ],
  };

  /** The turn delegates once; the specialist reports at once. */
  function delegating(
    specialistRequests: ModelRequest[],
  ): (request: number, sent: ModelRequest) => Step {
    let delegated = false;
    return (_request, sent) => {
      if (JSON.stringify(sent.messages).includes('kind=\\"delegation\\"')) {
        specialistRequests.push(sent);
        return {
          calls: [
            {
              name: "finish_specialist",
              id: `finish-${specialistRequests.length}`,
              args: { report: "Painted." },
            },
          ],
        };
      }
      if (delegated) return { text: "Done." };
      delegated = true;
      return {
        calls: [
          {
            name: "delegate_specialist",
            id: "delegate",
            args: { id: "studio/painter", task: "Paint the cube." },
          },
        ],
      };
    };
  }

  it("of a plugin not yet active activates it, and has the toolkit tools its definition names", async () => {
    const specialistRequests: ModelRequest[] = [];
    const fixture = overCatalog({
      plugins: [studio],
      script: delegating(specialistRequests),
    });
    const taskId = await fixture.loop.createTask();
    await fixture.loop.start(taskId, "Paint the cube");
    await until(() => specialistRequests.length > 0);

    expect(fixture.loop.snapshot().tasks[0]?.activatedPlugins).toEqual([
      "studio",
    ]);
    expect(toolNames(specialistRequests[0])).toEqual(
      expect.arrayContaining(["read_file", "set_material"]),
    );
  });

  it("is started naming only the tools it has", async () => {
    const specialistRequests: ModelRequest[] = [];
    const fixture = overCatalog({
      plugins: [studio],
      script: delegating(specialistRequests),
    });
    await fixture.loop.start(
      await fixture.loop.createTask(["studio"]),
      "Paint the cube",
    );
    await until(() => specialistRequests.length > 0);

    const [request] = specialistRequests;
    expect(toolNames(fixture.requests[0])).toContain("browser_preview");
    expect(toolNames(request)).not.toContain("browser_preview");
    const system = String(request?.messages[0]?.content);
    expect(system).not.toContain("workspace-preview tool");
    expect(JSON.stringify(request?.messages)).not.toContain(
      "Plugins the person enabled",
    );
  });
});
