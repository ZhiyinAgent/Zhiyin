/** A conversation in which the model has just opened a toolkit. */

import type { ModelMessage, ModelTool } from "../src/model-client.js";

const tool = (name: string): ModelTool => ({
  name,
  description: `${name}.`,
  inputSchema: { type: "object" },
});

/** The tools the conversation started with. */
export const startingTools = [tool("find"), tool("open")];

export const setMaterial = tool("set_material");
export const setLighting = tool("set_lighting");

/** The model opened the surfacing toolkit; the result is message 3. */
export const opened: ModelMessage[] = [
  { role: "system", content: "You are Zhiyin." },
  { role: "user", content: "Make the stand look like oak." },
  {
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "call_1",
        name: "open",
        arguments: '{"id":"toolkit:3d/surfacing"}',
      },
    ],
  },
  { role: "tool", toolCallId: "call_1", name: "open", content: "Opened." },
];

/** The surfacing toolkit, joining after the result that opened it. */
export const surfacing = { tools: [setMaterial], after: 3 };
