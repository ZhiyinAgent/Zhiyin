/**
 * Each lab reads its own failures first. What its documentation leaves to the
 * status alone reads the same on every lab that hands it on: a model the lab
 * does not offer points to the Model page, and a server that failed passes on
 * the lab's own sentence where it gave one.
 */

import { describe, expect, it } from "vitest";
import type { Provider } from "../src/provider.js";
import { labClient, refusal, untilFailure } from "./lab-wire.js";
import {
  deepSeek,
  miniMax,
  moonshot,
  openAi,
  qwen,
  xiaomi,
} from "./shipped-providers.js";

type Lab = {
  readonly name: string;
  readonly provider: Provider;
  readonly model: string;
  readonly region?: string;
};

const labs: readonly Lab[] = [
  {
    name: "DeepSeek",
    provider: deepSeek,
    model: "deepseek-flash",
    region: "international",
  },
  {
    name: "Kimi",
    provider: moonshot,
    model: "kimi-k3",
    region: "international",
  },
  {
    name: "MiniMax",
    provider: miniMax,
    model: "MiniMax-M3",
    region: "international",
  },
  { name: "OpenAI", provider: openAi, model: "gpt-6-luna" },
  {
    name: "Qwen",
    provider: qwen,
    model: "qwen3.8-flash",
    region: "international",
  },
  {
    name: "Xiaomi MiMo",
    provider: xiaomi,
    model: "mimo-v2.6-flash",
    region: "international",
  },
];

const hello = { messages: [{ role: "user" as const, content: "Hello" }] };

function failing(
  provider: Provider,
  model: string,
  region: string | undefined,
  status: number,
  body: unknown,
) {
  return labClient(provider, "sk-test", {
    model,
    ...(region ? { region } : {}),
    fetcher: refusal(status, body),
  });
}

describe("a failure only the status explains", () => {
  // MiniMax and Xiaomi say what their own 404 means.
  it.each(
    labs.filter(({ name }) => name !== "MiniMax" && name !== "Xiaomi MiMo"),
  )(
    "on $name, a model it cannot find is one it does not offer, named, and not sent again",
    async ({ name, provider, model, region }) => {
      const { error } = await untilFailure(
        failing(provider, model, region, 404, undefined),
        hello,
      );

      expect(error).toMatchObject({
        code: "modelUnavailable",
        retryable: false,
        message: `${name} does not offer the model "${model}" to this account. Choose another on the Model page.`,
      });
    },
  );

  it.each(labs)(
    "on $name, a server failure passes on the lab's own sentence",
    async ({ name, provider, model, region }) => {
      const { error } = await untilFailure(
        failing(provider, model, region, 500, {
          error: { message: "The backend is restarting." },
        }),
        hello,
      );

      expect(error).toMatchObject({
        code: "unexplainedError",
        message: `${name}'s server failed: The backend is restarting.`,
      });
    },
  );
});
