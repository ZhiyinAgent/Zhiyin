/**
 * Reads the provider's model catalogue and, for one model, the upstreams that
 * serve it.
 *
 * Two things about the wire contract drive the shape here, verified against the
 * live provider on 2026-09-10:
 *
 * - The catalogue answers an unauthenticated request, but `latency` and
 *   `throughput` come back null unless the request carries a key. A picker
 *   without a key can therefore list models but cannot compare upstreams.
 * - Routing accepts an upstream slug including its variant suffix
 *   (`deepinfra/fp4`), which is exactly the `tag` each endpoint carries. A bare
 *   provider slug matches every variant.
 *
 * Wire fields do not escape: everything is translated to the contract's own
 * types before it leaves this module.
 */

import type {
  ModelCatalog,
  ModelCatalogEntry,
  ModelProviderList,
  ModelProviderOption,
} from "@zhiyin/contract";

const catalogUrl = "https://openrouter.ai/api/v1/models";
const endpointsUrl = (model: string) =>
  `https://openrouter.ai/api/v1/models/${model}/endpoints`;

/** How the catalogue is fetched. Replaced wholesale in tests. */
export type CatalogFetch = (
  url: string,
  init: { readonly headers: Readonly<Record<string, string>> },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

export type CatalogOptions = {
  readonly apiKey?: () => Promise<string | undefined>;
  readonly fetcher?: CatalogFetch;
  readonly timeoutMs?: number;
};

const defaultTimeoutMs = 15_000;

const defaultFetch: CatalogFetch = (url, init) =>
  fetch(url, {
    headers: init.headers,
    signal: AbortSignal.timeout(defaultTimeoutMs),
  });

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function usdPerMillion(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  // Priced per token on the wire; every price a person reads is per million.
  return Math.round(parsed * 1e6 * 1e6) / 1e6;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function percent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 10) / 10
    : null;
}

/** A quantile bundle on the wire; the median is the one a person can act on. */
function median(value: unknown): number | null {
  const bundle = record(value);
  const p50 = bundle?.["p50"];
  return typeof p50 === "number" && Number.isFinite(p50)
    ? Math.round(p50)
    : null;
}

function supports(value: unknown, parameter: string): boolean {
  return Array.isArray(value) && value.includes(parameter);
}

function modalities(architecture: unknown): readonly unknown[] {
  const input = record(architecture)?.["input_modalities"];
  return Array.isArray(input) ? input : [];
}

function entry(value: unknown): ModelCatalogEntry | undefined {
  const model = record(value);
  if (!model) return undefined;
  const id = model["id"];
  const name = model["name"];
  if (typeof id !== "string" || typeof name !== "string") return undefined;
  // Batch variants answer asynchronously and cannot serve an interactive turn.
  if (id.endsWith(":batch")) return undefined;
  if (!supports(model["supported_parameters"], "tools")) return undefined;

  const pricing = record(model["pricing"]);
  const input = usdPerMillion(pricing?.["prompt"]);
  const output = usdPerMillion(pricing?.["completion"]);
  const contextWindow = positive(model["context_length"]);
  if (
    input === undefined ||
    output === undefined ||
    contextWindow === undefined
  )
    return undefined;

  return {
    id,
    name,
    contextWindow,
    inputUsdPerMillion: input,
    outputUsdPerMillion: output,
    acceptsImages: modalities(model["architecture"]).includes("image"),
    reasoning: record(model["reasoning"]) !== undefined,
  };
}

function option(value: unknown): ModelProviderOption | undefined {
  const endpoint = record(value);
  if (!endpoint) return undefined;
  const slug = endpoint["tag"];
  const name = endpoint["provider_name"];
  if (typeof slug !== "string" || typeof name !== "string") return undefined;

  const pricing = record(endpoint["pricing"]);
  const input = usdPerMillion(pricing?.["prompt"]);
  const output = usdPerMillion(pricing?.["completion"]);
  const contextWindow = positive(endpoint["context_length"]);
  if (
    input === undefined ||
    output === undefined ||
    contextWindow === undefined
  )
    return undefined;

  const quantization = endpoint["quantization"];
  return {
    slug,
    name,
    quantization:
      typeof quantization === "string" && quantization !== "unknown"
        ? quantization
        : null,
    contextWindow,
    inputUsdPerMillion: input,
    outputUsdPerMillion: output,
    acceptsTools: supports(endpoint["supported_parameters"], "tools"),
    responseMs: median(endpoint["latency_last_30m"]),
    tokensPerSecond: median(endpoint["throughput_last_30m"]),
    uptimePercent: percent(endpoint["uptime_last_30m"]),
  };
}

type Read =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly reason: string };

async function read(url: string, options: CatalogOptions): Promise<Read> {
  const key = await options.apiKey?.().catch(() => undefined);
  const fetcher = options.fetcher ?? defaultFetch;
  let response: Awaited<ReturnType<CatalogFetch>>;
  try {
    response = await fetcher(url, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
  } catch {
    return { ok: false, reason: "The model list could not be reached." };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason:
        response.status === 401 || response.status === 403
          ? "The stored key was refused, so the model list is unavailable."
          : "The provider did not return a model list.",
    };
  }
  const body = record(await response.json().catch(() => undefined));
  const data = body?.["data"];
  if (data === undefined)
    return {
      ok: false,
      reason: "The provider returned an unreadable model list.",
    };
  return { ok: true, data };
}

export async function fetchOpenRouterCatalog(
  options: CatalogOptions = {},
): Promise<ModelCatalog> {
  const result = await read(catalogUrl, options);
  if (!result.ok) return { status: "unavailable", reason: result.reason };
  const data = result.data;
  if (!Array.isArray(data))
    return {
      status: "unavailable",
      reason: "The provider returned an unreadable model list.",
    };
  const models = data
    .map(entry)
    .filter((model): model is ModelCatalogEntry => model !== undefined);
  if (models.length === 0)
    return {
      status: "unavailable",
      reason: "The provider listed no model this app can use.",
    };
  return { status: "ready", models };
}

export async function fetchOpenRouterModelProviders(
  model: string,
  options: CatalogOptions = {},
): Promise<ModelProviderList> {
  const result = await read(endpointsUrl(model), options);
  if (!result.ok) return { status: "unavailable", reason: result.reason };
  const data = record(result.data);
  const endpoints = data?.["endpoints"];
  if (!Array.isArray(endpoints))
    return {
      status: "unavailable",
      reason: "The provider returned no upstream for this model.",
    };
  const providers = endpoints
    .map(option)
    .filter((item): item is ModelProviderOption => item !== undefined);
  if (providers.length === 0)
    return {
      status: "unavailable",
      reason: "No upstream currently serves this model.",
    };
  return { status: "ready", model, providers };
}
