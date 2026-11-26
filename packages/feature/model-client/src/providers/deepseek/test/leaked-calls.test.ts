/**
 * A tool call whose name runs on into DeepSeek's own call markup. The taped
 * calls are fed through the DeepSeek connection as DeepSeek streamed them.
 */

import { describe, expect, it } from "vitest";
import type { ModelEvent } from "../../../model-client.js";
import { chunksThenDone } from "../../../../test/lab-wire.js";
import { deepSeekClient, drain } from "./support.js";
import {
  deskCamera,
  deskLighting,
  hingeRender,
  type TapedCall,
} from "./taped-leaks.js";

/**
 * An answer that makes `calls`, each streamed fragment by fragment, each
 * fragment's chunk carrying `beside` as well.
 */
function answerCalling(
  calls: readonly TapedCall[],
  beside: Record<string, unknown> = {},
) {
  const chunk = (delta: unknown, rest: Record<string, unknown> = {}) => ({
    id: "answer-1",
    model: "deepseek-flash",
    choices: [{ index: 0, delta, ...rest }],
  });
  return chunksThenDone([
    ...calls.flatMap((call, index) => [
      chunk({
        tool_calls: [
          {
            index,
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: "" },
          },
        ],
      }),
      ...call.fragments.map((fragment) =>
        chunk({
          ...beside,
          tool_calls: [{ index, function: { arguments: fragment } }],
        }),
      ),
    ]),
    {
      ...chunk({ content: "" }, { finish_reason: "tool_calls" }),
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    },
  ]);
}

/** Each call the events make, by index: its id, name and arguments read. */
function callsIn(events: readonly ModelEvent[]) {
  const calls = new Map<number, { id: string; name: string; text: string }>();
  for (const event of events) {
    if (event.kind !== "toolCallDelta") continue;
    const call = calls.get(event.index) ?? { id: "", name: "", text: "" };
    if (event.callId) call.id = event.callId;
    call.name += event.name ?? "";
    call.text += event.argumentsDelta ?? "";
    calls.set(event.index, call);
  }
  return [...calls.values()].map((call) => ({
    id: call.id,
    name: call.name,
    arguments: JSON.parse(call.text) as unknown,
  }));
}

async function sent(
  calls: readonly TapedCall[],
  beside: Record<string, unknown> = {},
) {
  return drain(deepSeekClient({ fetcher: answerCalling(calls, beside) }), {
    messages: [{ role: "user", content: "Adjust the render." }],
  });
}

const streamed = (fragments: readonly string[]): TapedCall => ({
  id: "call_00_test",
  name: "call",
  fragments,
});

describe("a DeepSeek call whose name runs on into its call markup", () => {
  it("is read as the call to the named tool, with the input the markup holds", async () => {
    expect(callsIn(await sent([hingeRender]))).toEqual([
      {
        id: "call_00_OkN6cPGiBicA3c3J596f5994",
        name: "call",
        arguments: {
          name: "mcp__blender__blender_render",
          arguments: {
            background: "white",
            engine: "cycles",
            exposure: -0.3,
            output: "hinge-box/pictures/hinge-detail.png",
            purpose:
              "Render the hinge close-up a touch darker so the PLA colour reads true",
            samples: 160,
          },
        },
      },
    ]);
  });

  it("is read even when each of its fragments comes with empty text", async () => {
    const [call] = callsIn(await sent([hingeRender], { content: "" }));
    expect(call?.arguments).toMatchObject({
      name: "mcp__blender__blender_render",
      arguments: { samples: 160 },
    });
  });

  it("is read for each call of an answer that makes two", async () => {
    expect(callsIn(await sent([deskCamera, deskLighting]))).toEqual([
      {
        id: "call_00_ET_455AshHWymdPYLJDeChX9247",
        name: "call",
        arguments: {
          name: "mcp__blender__blender_set_camera",
          arguments: {
            exposure: -0.45,
            lens: 22,
            location: [0.03, -0.8, 1.24],
            look_at: [0.02, 0.06, 0.79],
            tone: "neutral",
            purpose:
              "Take the exposure down half a stop so the plain colours keep their strength.",
          },
        },
      },
      {
        id: "call_01_ET_90HExgexrRj9kpB7R8P95419",
        name: "call",
        arguments: {
          name: "mcp__blender__blender_set_lighting",
          arguments: {
            background: {
              color: "#ded8cf",
              environment: "studio",
              strength: 0.5,
            },
            lights: [
              {
                kelvin: 5200,
                kind: "area",
                location: [1.7, -1.5, 2.1],
                look_at: [0, 0, 0.8],
                name: "Window_key",
                power: 85,
                shape: "square",
                size: [1.6, 1.6],
              },
            ],
            purpose:
              "Dim the surroundings a little so the key does the shaping.",
          },
        },
      },
    ]);
  });

  it("takes the markup's input in place of an input the call left empty", async () => {
    const events = await sent([
      streamed([
        '{"name": "set_material\\">\\n<｜｜DSML｜｜ parameter name=\\"arguments\\" string=\\"false\\">{\\"path\\": \\"cube\\"}',
        '", "arguments": {}}',
      ]),
    ]);
    expect(callsIn(events)[0]?.arguments).toEqual({
      name: "set_material",
      arguments: { path: "cube" },
    });
  });

  it("is left as it came when its markup does not read", async () => {
    const unreadable =
      '{"name": "set_material\\">\\n<｜｜DSML｜｜ parameter name=\\"arguments\\" string=\\"false\\">{\\"path\\": cube"}';
    const events = await sent([
      streamed([unreadable.slice(0, 40), unreadable.slice(40)]),
    ]);
    expect(callsIn(events)[0]?.arguments).toEqual(JSON.parse(unreadable));
  });
});

describe("a DeepSeek call without markup", () => {
  it("is passed on as it streams, unchanged", async () => {
    const fragments = [
      '{"path": "notes/a.txt", ',
      '"text": "She said \\"hi\\">',
      ' then left."}',
    ];
    const events = await sent([streamed(fragments)]);
    const pieces = events.flatMap((event) =>
      event.kind === "toolCallDelta" && event.argumentsDelta
        ? [event.argumentsDelta]
        : [],
    );
    expect(pieces[0]).toBe('{"path": "notes/a.txt", ');
    expect(pieces.join("")).toBe(fragments.join(""));
  });
});
