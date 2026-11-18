/**
 * DeepSeek: one host for every account, over Chat Completions. Its platform
 * bills an account in US dollars or in yuan; the region the person chooses
 * says which, and so which price list estimates its costs, and the key check
 * holds the two to agree (balance reference, checked 2026-10-09). Thinking is on
 * unless turned off, and with tools in a request every earlier turn's
 * reasoning goes back as `reasoning_content`, or DeepSeek refuses it (API
 * documentation, thinking mode guide, checked 2026-10-09).
 */

import type { ModelChoiceValue } from "../../choice.js";
import { ModelClientError } from "../../failures.js";
import type { ModelRequest } from "../../model-client.js";
import { listedAt } from "../../model-list.js";
import type { CatalogFetch, KeyCheck, ListedProvider } from "../../provider.js";
import {
  chatMessages,
  chatTools,
} from "../../wires/chat-completions/messages.js";
import {
  sendChatCompletions,
  type ChatCompletionsDialect,
} from "../../wires/chat-completions/send.js";
import { classifyFailure, failedFinish } from "./failures.js";

const host = "https://api.deepseek.com";
const endpoint = `${host}/chat/completions`;

/** One platform serves both: its documentation names no billing page. */
const pages = {
  keys: "https://platform.deepseek.com/api_keys",
  billing: "https://platform.deepseek.com/",
};

function reasoningFields(request: ModelRequest) {
  if (!request.reasoning) return {};
  if (!request.reasoning.enabled) return { thinking: { type: "disabled" } };
  return {
    thinking: { type: "enabled" },
    ...(request.reasoning.effort
      ? { reasoning_effort: request.reasoning.effort }
      : {}),
  };
}

const dialect: ChatCompletionsDialect = {
  name: "DeepSeek",
  headers: (apiKey) => ({
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }),
  body: (chosen: ModelChoiceValue, request: ModelRequest) => ({
    model: chosen.model,
    stream: true,
    // Usage arrives only when asked for, on the last chunk.
    stream_options: { include_usage: true },
    ...(request.maximumOutputTokens !== undefined
      ? { max_tokens: request.maximumOutputTokens }
      : {}),
    ...reasoningFields(request),
    messages: chatMessages(request.messages, [], {
      reasoning: "reasoning_content",
      reasoningOnEveryTurn: true,
    }),
    ...(request.tools?.length ? { tools: chatTools(request.tools) } : {}),
  }),
  classify: classifyFailure,
  failedFinish,
};

/** Each platform's currency, which its accounts are billed in. */
const platforms = [
  {
    region: "international",
    name: "International",
    currency: "USD",
    in: "US dollars",
  },
  { region: "mainland", name: "Mainland China", currency: "CNY", in: "yuan" },
] as const;

/**
 * The account's balance: a request that proves the key and spends nothing.
 * It names the currency the account is billed in, which is the one thing that
 * tells the two platforms apart, so a key is kept only on a platform whose
 * currency the balance lists, or when it lists none of the two yet.
 */
async function checkKey(
  apiKey: string,
  fetcher: CatalogFetch,
  region?: string,
): Promise<KeyCheck> {
  const response = await fetcher(`${host}/user/balance`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.ok) {
    const currencies = currenciesOf(await response.json());
    const billing = platforms.filter((platform) =>
      currencies.includes(platform.currency),
    );
    const billed = billing[0];
    return billed && !billing.some((platform) => platform.region === region)
      ? {
          accepted: false,
          error: new ModelClientError(
            "unauthorized",
            `This DeepSeek account is billed in ${billed.in}. Choose ${billed.name}, then add the key there.`,
          ),
        }
      : { accepted: true };
  }
  return {
    accepted: false,
    error:
      response.status === 401 || response.status === 403
        ? new ModelClientError("unauthorized", "DeepSeek rejected the API key.")
        : classifyFailure({ status: response.status }),
  };
}

function currenciesOf(balance: unknown): string[] {
  const infos: unknown =
    balance && typeof balance === "object" && "balance_infos" in balance
      ? balance.balance_infos
      : undefined;
  return (Array.isArray(infos) ? (infos as unknown[]) : []).flatMap((info) =>
    info &&
    typeof info === "object" &&
    "currency" in info &&
    typeof info.currency === "string"
      ? [info.currency]
      : [],
  );
}

/** The models the account can use now, by DeepSeek's own listing. */
const listedByApi = listedAt(
  "DeepSeek",
  () => `${host}/models`,
  (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
);

export const deepSeek: ListedProvider = {
  id: "deepseek",
  name: "DeepSeek",
  keyName: "a DeepSeek API key",
  keyVariable: "ZHIYIN_DEEPSEEK_API_KEY",
  reasoningSentBack: true,
  regions: [
    { id: "international", name: "International", endpoint, pages },
    {
      id: "mainland",
      name: "Mainland China",
      keyVariable: "ZHIYIN_DEEPSEEK_CN_API_KEY",
      endpoint,
      pages,
    },
  ],
  send: (input) => sendChatCompletions(dialect, input),
  listed: { byApi: listedByApi },
  checkKey,
};
