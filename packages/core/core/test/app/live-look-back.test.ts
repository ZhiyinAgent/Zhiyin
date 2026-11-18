/**
 * A measure, not a test: how many rounds a look back uses on the tools of
 * ADR 0026. Each taped look back's first request is sent again, as the
 * conversation stood, with `remember` and `recall` as they are now, to each
 * lab's model; its calls are answered by a real memory in a temporary folder,
 * shared by the look backs of one tape in the order they ran. Never part of
 * the gate: it costs money and needs the tapes and the keyring.
 *
 *   $env:ZHIYIN_LOOK_BACK = "1"; $env:ZHIYIN_TAPES = "<tapes folder>"
 *   $env:ZHIYIN_LOOK_BACK_OUT = "<file.json>"
 *   npx vitest run --project live packages/core/core/test/app/live-look-back.test.ts
 *
 * ZHIYIN_LABS and ZHIYIN_LOOK_BACK_TAPES narrow it, by name, comma separated.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  ModelProviders,
  type ModelContentPart,
  type ModelMessage,
  type ModelTool,
  type ModelToolCall,
} from "@zhiyin/model-client";
import { FileMemory, closeEntriesCheck } from "@zhiyin/memory";

const live = process.env["ZHIYIN_LOOK_BACK"] === "1";
const tapes = process.env["ZHIYIN_TAPES"] ?? "";
const most = Number(process.env["ZHIYIN_ROUNDS"] ?? 8);

const labs = [
  {
    name: "deepseek",
    provider: "deepseek",
    region: "international",
    model: "deepseek-flash",
  },
  {
    name: "qwen",
    provider: "qwen",
    region: "international",
    model: "qwen3.8-flash",
  },
  { name: "openai", provider: "openai", model: "gpt-6-luna" },
  { name: "anthropic", provider: "anthropic", model: "claude-haiku-5-5" },
  {
    name: "zai",
    provider: "zai",
    region: "international",
    model: "glm-5.3-flash",
  },
  {
    name: "moonshot",
    provider: "moonshot",
    region: "international",
    model: "kimi-k2.6",
  },
  {
    name: "minimax",
    provider: "minimax",
    region: "international",
    model: "MiniMax-M2.7",
  },
  {
    name: "xiaomi",
    provider: "xiaomi",
    region: "international",
    model: "mimo-v2.6-flash",
  },
].filter(
  (lab) =>
    !process.env["ZHIYIN_LABS"] ||
    process.env["ZHIYIN_LABS"].split(",").includes(lab.name),
);

const reviewMark = "Before this conversation goes on";
const onlyMemory = {
  error:
    "The turn is over: its work waits for the person's next message. Only remember and recall can be called while looking back.",
};

type ChatMessage = {
  role: string;
  content?: unknown;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  reasoning_content?: string;
};

type LookBack = {
  tape: string;
  file: string;
  model: string;
  messages: ModelMessage[];
  tools: ModelTool[];
};

/** Each look back's first round, in the order the tape ran them. */
function lookBacks(tape: string): LookBack[] {
  const dir = join(tapes, tape, "tape");
  const found: LookBack[] = [];
  const seen = new Set<number>();
  for (const file of readdirSync(dir)
    .filter((name) => name.startsWith("look-back-"))
    .sort()) {
    const kept = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const body =
      typeof kept.request?.body === "string"
        ? JSON.parse(kept.request.body)
        : (kept.request?.body ?? kept.request);
    if (!Array.isArray(body?.messages)) continue;
    const chat = body.messages as ChatMessage[];
    const at = chat.findLastIndex((message) =>
      JSON.stringify(message.content ?? "").includes(reviewMark),
    );
    if (at < 0 || seen.has(at)) continue;
    seen.add(at);
    found.push({
      tape,
      file,
      model: kept.model,
      messages: modelMessages(chat.slice(0, at + 1)),
      tools: (body.tools ?? []).map(
        (tool: {
          function: {
            name: string;
            description?: string;
            parameters?: Record<string, unknown>;
          };
        }) => ({
          name: tool.function.name,
          description: tool.function.description ?? "",
          inputSchema: tool.function.parameters ?? { type: "object" },
        }),
      ),
    });
  }
  return found;
}

function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part: { type?: string; text?: string }) =>
        part.type === "text" ? (part.text ?? "") : "",
      )
      .join("");
  return "";
}

function parts(content: unknown): string | ModelContentPart[] {
  if (!Array.isArray(content)) return text(content);
  return content.flatMap(
    (part: {
      type?: string;
      text?: string;
      image_url?: { url?: string };
    }): ModelContentPart[] => {
      if (part.type === "text")
        return [{ kind: "text", text: part.text ?? "" }];
      const url = part.image_url?.url ?? "";
      const data = /^data:([^;]+);base64,(.*)$/s.exec(url);
      return data
        ? [{ kind: "image", mediaType: data[1]!, data: data[2]! }]
        : [];
    },
  );
}

function modelMessages(chat: readonly ChatMessage[]): ModelMessage[] {
  const names = new Map<string, string>();
  return chat.map((message): ModelMessage => {
    if (message.role === "system")
      return { role: "system", content: text(message.content) };
    if (message.role === "assistant") {
      const toolCalls: ModelToolCall[] = (message.tool_calls ?? []).map(
        (call) => {
          names.set(call.id, call.function.name);
          return {
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          };
        },
      );
      return {
        role: "assistant",
        content: text(message.content),
        ...(toolCalls.length ? { toolCalls } : {}),
        ...(message.reasoning_content
          ? { reasoning: message.reasoning_content }
          : {}),
      };
    }
    if (message.role === "tool")
      return {
        role: "tool",
        content: text(message.content),
        toolCallId: message.tool_call_id ?? "",
        name: names.get(message.tool_call_id ?? "") ?? "unknown",
      };
    return { role: "user", content: parts(message.content) };
  });
}

type RoundRecord = {
  calls: { name: string; input: string; answer: string }[];
  words: string;
  inputTokens?: number;
  cachedTokens?: number;
  costUsd?: number;
};

async function measure(
  lab: (typeof labs)[number],
  lookBack: LookBack,
  memory: FileMemory,
) {
  const client = new ModelProviders({
    fixed: {
      provider: lab.provider,
      ...(lab.region ? { region: lab.region } : {}),
      model: lab.model,
    },
    environment: () => undefined,
  });
  const check = closeEntriesCheck(memory);
  const tools = [
    ...lookBack.tools.filter(
      (tool) => tool.name !== "remember" && tool.name !== "recall",
    ),
    memory.rememberToolFor(false),
    memory.recallTool,
  ].map((spec) => ({
    name: spec.name,
    description: spec.description,
    inputSchema: "inputSchema" in spec ? spec.inputSchema : {},
  })) as ModelTool[];
  const history: ModelMessage[] = [];
  const rounds: RoundRecord[] = [];
  const context = {
    conversation: { id: `${lookBack.tape}`, title: lookBack.tape },
    personsWords: lookBack.messages
      .filter((message) => message.role === "user")
      .map((message) =>
        typeof message.content === "string" ? message.content : "",
      ),
    held: {},
  };
  for (let round = 0; round < most; round += 1) {
    const calls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let words = "";
    const record: RoundRecord = { calls: [], words: "" };
    for await (const event of client.send({
      messages: [...lookBack.messages, ...history],
      tools,
      session: `look-back-${lookBack.tape}-${lab.name}`,
      cacheAfter: [lookBack.messages.length - 1],
      callable: {
        tools: ["remember", "recall"],
        after: lookBack.messages.length - 1,
      },
    })) {
      if (event.kind === "textDelta") words += event.text;
      if (event.kind === "toolCallDelta") {
        const call = calls.get(event.index) ?? {
          id: "",
          name: "",
          arguments: "",
        };
        if (event.callId) call.id = event.callId;
        if (event.name) call.name += event.name;
        if (event.argumentsDelta) call.arguments += event.argumentsDelta;
        calls.set(event.index, call);
      }
      if (event.kind === "usage") {
        record.inputTokens = event.usage.inputTokens;
        if (event.usage.cacheReadTokens !== undefined)
          record.cachedTokens = event.usage.cacheReadTokens;
        const cost = event.usage.costUsd ?? event.usage.estimatedCost?.amount;
        if (cost !== undefined) record.costUsd = cost;
      }
    }
    record.words = words.slice(0, 300);
    rounds.push(record);
    if (!calls.size) break;
    const asked = [...calls.values()].map((call, index) => ({
      ...call,
      id: call.id || `call-${round}-${index}`,
    }));
    history.push({ role: "assistant", content: words, toolCalls: asked });
    for (const call of asked) {
      let input: unknown;
      try {
        input = JSON.parse(call.arguments || "{}");
      } catch {
        input = undefined;
      }
      let answer: Record<string, unknown>;
      try {
        if (input === undefined)
          answer = { error: "The input is not valid JSON." };
        else if (call.name === "recall")
          answer = { ...(await memory.recall(input)).answer };
        else if (call.name === "remember") {
          const kept = await memory.remember(input, context);
          answer = kept.ok
            ? {
                ...kept.answer,
                ...((await check.run({ input, answer: kept.answer })) ?? {}),
              }
            : { error: kept.reason };
        } else answer = onlyMemory;
      } catch (error) {
        // A defect of memory's own, kept with the input that met it.
        throw new Error(
          `${call.name} ${call.arguments}
${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
          { cause: error },
        );
      }
      const said = JSON.stringify(answer);
      record.calls.push({
        name: call.name,
        input: call.arguments.slice(0, 600),
        answer: said.slice(0, 400),
      });
      history.push({
        role: "tool",
        content: said,
        toolCallId: call.id,
        name: call.name,
      });
    }
  }
  return rounds;
}

const when = live && existsSync(tapes) ? describe : describe.skip;

when("the rounds a look back uses", () => {
  const folders = new TemporaryFolders();
  afterEach(() => folders.removeAll());
  it("is measured on each taped look back, in each lab", async () => {
    const chosen = (process.env["ZHIYIN_LOOK_BACK_TAPES"] ?? "")
      .split(",")
      .filter(Boolean);
    const names = readdirSync(tapes).filter(
      (name) =>
        (!chosen.length || chosen.includes(name)) &&
        existsSync(join(tapes, name, "tape")),
    );
    const results: unknown[] = [];
    const out = process.env["ZHIYIN_LOOK_BACK_OUT"];
    for (const lab of labs) {
      for (const tape of names) {
        const folder = await folders.make("zhiyin-look-back-");
        const memory = new FileMemory({
          folder: join(folder, "memory"),
          now: () => new Date(),
          newId: () => crypto.randomUUID(),
          broadFolders: [],
        });
        for (const lookBack of lookBacks(tape)) {
          try {
            const rounds = await measure(lab, lookBack, memory);
            results.push({
              lab: lab.name,
              tape,
              file: lookBack.file,
              taped: lookBack.model,
              rounds,
            });
          } catch (error) {
            results.push({
              lab: lab.name,
              tape,
              file: lookBack.file,
              failed: error instanceof Error ? error.message : String(error),
            });
          }
          if (out) writeFileSync(out, JSON.stringify(results, null, 1));
        }
        results.push({
          lab: lab.name,
          tape,
          kept: (await memory.state()).entries.map((entry) => ({
            number: entry.number,
            scope: entry.scope,
            section: entry.section,
            title: entry.title,
            summary: entry.summary,
          })),
        });
        if (out) writeFileSync(out, JSON.stringify(results, null, 1));
      }
    }
  }, 3_600_000);
});
