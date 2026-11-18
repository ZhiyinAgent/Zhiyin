/**
 * A toolkit the model opens joins the request from the message it was opened
 * at (ADR 0017). A provider that loads tools mid-conversation for the chosen
 * model is sent them there, after everything it cached; any other is sent
 * none. Over Anthropic Messages the tools come in a `tool_addition` system
 * message under the `inline-tools-2026-09-15` beta, defined by value, from its
 * mid-conversation system messages guide (checked 2026-11-06).
 */

import { describe, expect, it } from "vitest";
import { ProviderModelClient } from "../src/client.js";
import type { ModelMessage, ModelTool } from "../src/index.js";
import type { SendInput } from "../src/provider.js";
import {
  labDialect,
  recording,
  sendOnce,
  sentBody,
  type Sent,
} from "./anthropic-messages-support.js";
import { drain } from "./lab-wire.js";
import {
  opened,
  setLighting,
  setMaterial,
  startingTools as tools,
  surfacing,
} from "./opened-toolkit.js";
import { testProvider } from "./test-provider.js";

const addition = (...added: ModelTool[]) => ({
  role: "system",
  content: added.map((one) => ({
    type: "tool_addition",
    tool: {
      type: "tool_definition",
      definition: {
        name: one.name,
        description: one.description,
        input_schema: one.inputSchema,
      },
    },
  })),
});

describe("a provider that does not load tools for the chosen model", () => {
  it("is sent no loads, and the request is otherwise as it was", async () => {
    const seen: SendInput[] = [];
    const client = new ProviderModelClient(
      testProvider(seen, { loadsTools: (model) => model === "model-2" }),
      { apiKey: async () => "key", model: "model-1" },
    );

    await drain(client, { messages: opened, tools, loads: [surfacing] });
    await drain(client, { messages: opened, tools });

    expect(seen[0]?.request).not.toHaveProperty("loads");
    expect(seen[0]?.request).toEqual(seen[1]?.request);
  });

  it("is sent none when it says nothing about loading", async () => {
    const seen: SendInput[] = [];
    const client = new ProviderModelClient(testProvider(seen), {
      apiKey: async () => "key",
      model: "model-1",
    });

    await drain(client, { messages: opened, tools, loads: [surfacing] });

    expect(seen[0]?.request).not.toHaveProperty("loads");
  });
});

describe("a provider that loads tools for the chosen model", () => {
  const loading = (seen: SendInput[]) =>
    new ProviderModelClient(
      testProvider(seen, { loadsTools: (model) => model === "model-1" }),
      { apiKey: async () => "key", model: "model-1" },
    );

  it("is sent each load, in the order they were opened", async () => {
    const seen: SendInput[] = [];
    const loads = [surfacing, { tools: [setLighting], after: 3 }];

    await drain(loading(seen), { messages: opened, tools, loads });

    expect(seen[0]?.request.loads).toEqual(loads);
    expect(seen[0]?.request.tools).toEqual(tools);
  });

  it("is sent a load at its message's place once a round's results are put after their calls", async () => {
    const seen: SendInput[] = [];
    const picture: ModelMessage = {
      role: "user",
      content: [{ kind: "image", mediaType: "image/png", data: "AAAA" }],
    };
    const round: ModelMessage[] = [
      { role: "user", content: "Look, then open surfacing." },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call_1", name: "look", arguments: "{}" },
          { id: "call_2", name: "open", arguments: "{}" },
        ],
      },
      { role: "tool", toolCallId: "call_1", name: "look", content: "Seen." },
      picture,
      { role: "tool", toolCallId: "call_2", name: "open", content: "Opened." },
    ];

    await drain(loading(seen), {
      messages: round,
      tools,
      loads: [{ tools: [setMaterial], after: 4 }],
    });

    // The picture goes after the round's last result, so that result is
    // message 3 now.
    expect(seen[0]?.request.messages[3]).toEqual(round[4]);
    expect(seen[0]?.request.loads).toEqual([
      { tools: [setMaterial], after: 3 },
    ]);
  });
});

describe("loading tools over Anthropic Messages", () => {
  const changing = labDialect([], {
    toolChanges: { "anthropic-beta": "inline-tools-2026-09-15" },
  });

  it("defines the opened tools in a system message right after the message they join at, and leaves the tools and every message before it as they were", async () => {
    const without = await sentBody({ messages: opened, tools }, changing);
    const body = await sentBody(
      { messages: opened, tools, loads: [surfacing] },
      changing,
    );

    expect(body["tools"]).toEqual(without["tools"]);
    expect(body["system"]).toEqual(without["system"]);
    expect(body["messages"]).toEqual([
      ...(without["messages"] as unknown[]),
      addition(setMaterial),
    ]);
  });

  it("keeps each load where it was as the conversation goes on, so what came before stays cached", async () => {
    const later: ModelMessage[] = [
      ...opened,
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "toolu_2", name: "set_material", arguments: "{}" }],
      },
      {
        role: "tool",
        toolCallId: "toolu_2",
        name: "set_material",
        content: "Oak set.",
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "toolu_3", name: "open", arguments: "{}" }],
      },
      { role: "tool", toolCallId: "toolu_3", name: "open", content: "Opened." },
    ];

    const body = await sentBody(
      {
        messages: later,
        tools,
        loads: [surfacing, { tools: [setLighting], after: 7 }],
      },
      changing,
    );

    const messages = body["messages"] as { role: string }[];
    expect(messages.map((one) => one.role)).toEqual([
      "user",
      "assistant",
      "user",
      "system",
      "assistant",
      "user",
      "assistant",
      "user",
      "system",
    ]);
    expect(messages[3]).toEqual(addition(setMaterial));
    expect(messages[8]).toEqual(addition(setLighting));
  });

  it("withdraws an opened tool with the others when a request may call fewer", async () => {
    const lookBack: ModelMessage[] = [
      ...opened,
      { role: "user", content: "What should be remembered?" },
    ];
    for (const after of [3, 4]) {
      const body = await sentBody(
        {
          messages: lookBack,
          tools,
          loads: [surfacing],
          callable: { tools: ["open"], after },
        },
        changing,
      );

      const changes = (body["messages"] as { role: string; content: [] }[])
        .filter((one) => one.role === "system")
        .flatMap(
          (one) => one.content as { type: string; tool: { name?: string } }[],
        );
      const removed = changes
        .filter((change) => change.type === "tool_removal")
        .map((change) => change.tool.name);
      expect(removed).toEqual(["find", "set_material"]);
      // The tool is defined before it is withdrawn.
      expect(changes.map((change) => change.type).at(-1)).toBe("tool_removal");
    }
  });

  it("names the dialect's beta when it loads a tool, and only then", async () => {
    const sent: Sent[] = [];
    const fetcher = recording(sent);

    await sendOnce(
      { messages: opened, tools, loads: [surfacing] },
      { fetcher, dialect: changing },
    );
    await sendOnce({ messages: opened, tools }, { fetcher, dialect: changing });

    expect(sent[0]?.headers["anthropic-beta"]).toBe("inline-tools-2026-09-15");
    expect(sent[1]?.headers["anthropic-beta"]).toBeUndefined();
  });

  it("adds the opened tools after the others where Anthropic would not take a system message, so they can still be called", async () => {
    // After the model's own turn, not after one of the person's.
    const body = await sentBody(
      { messages: opened, tools, loads: [{ tools: [setMaterial], after: 2 }] },
      changing,
    );

    expect(
      (body["tools"] as { name: string }[]).map((one) => one.name),
    ).toEqual(["find", "open", "set_material"]);
    expect(
      (body["messages"] as { role: string }[]).some(
        (one) => one.role === "system",
      ),
    ).toBe(false);
  });

  it("sends nothing of a load over a dialect that cannot change tools mid-conversation", async () => {
    const without = await sentBody({ messages: opened, tools });
    const body = await sentBody({
      messages: opened,
      tools,
      loads: [surfacing],
    });

    expect(body).toEqual(without);
  });
});
