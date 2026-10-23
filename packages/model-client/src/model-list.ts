/**
 * A lab's models as Zhiyin's model list gives them (ADR 0015, ADR 0031): what
 * each model can do, and its price on each of the lab's platforms, with the
 * day the entries were checked against the lab's own pages. The list ships
 * with the app and may be replaced by a newer signed one while it runs, so a
 * lab provider is answered from the list in force at each question, through
 * `fromModelList`.
 *
 * A model not on the list is not offered, and what the list does not state is
 * unknown rather than assumed.
 */

import type {
  ModelCatalog,
  ModelCatalogEntry,
  ModelPrice,
  ReasoningCapabilities,
} from "@zhiyin/contract";
import { catalogFetch } from "./keyed-fetch.js";
import type {
  CatalogFetch,
  CatalogOptions,
  ListedProvider,
  ModelAnswers,
  Provider,
} from "./provider.js";

/** The key a provider with a single platform lists its prices under. */
export const ONE_PLATFORM = "default";

export type ListedModel = {
  /** The lab's own id for the model, as requests name it. */
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  /** The longest reply, where the lab states it. */
  readonly maximumOutputTokens?: number;
  readonly acceptsImages: boolean;
  readonly reasoning: ReasoningCapabilities;
  /**
   * The platforms it is offered on, by region id (or `ONE_PLATFORM`), with
   * its price there. Null where it is offered at a price the list does not
   * know.
   */
  readonly offered: Readonly<
    Record<string, Omit<ModelPrice, "checked"> | null>
  >;
  /** Why an entry says what it says, where that is not obvious. */
  readonly note?: string;
};

/** One lab's part of the list. */
export type ModelList = {
  /** The day every entry was checked against the lab's own pages. */
  readonly checked: string;
  readonly models: readonly ListedModel[];
};

/** The lab's part of the list in force, by provider id. */
export interface ModelLists {
  lab(provider: string): ModelList | undefined;
}

/**
 * The ids a lab says the account can use now, where it lists its models by
 * API. A listed model missing from it is withdrawn and not offered.
 */
export type ListedByApi = (
  options: CatalogOptions,
) => Promise<ReadonlySet<string>>;

/**
 * A listing read as most labs answer it, `{ data: [{ id }, …] }`, at the
 * address for the account's platform, signed with its key where it has one.
 */
export function listedAt(
  name: string,
  address: (region: string | undefined) => string,
  sign: (apiKey: string) => Readonly<Record<string, string>>,
): ListedByApi {
  return async (options) => {
    const apiKey = await options.apiKey?.();
    const fetcher: CatalogFetch = options.fetcher ?? catalogFetch;
    const response = await fetcher(address(options.region), {
      headers: apiKey ? sign(apiKey) : {},
    });
    if (!response.ok)
      throw new Error(`${name}'s model listing is unavailable.`);
    const listing = (await response.json()) as { data?: unknown };
    if (!Array.isArray(listing.data))
      throw new Error(`${name}'s model listing is unreadable.`);
    return new Set(
      listing.data.flatMap((model: unknown) =>
        model &&
        typeof model === "object" &&
        "id" in model &&
        typeof model.id === "string"
          ? [model.id]
          : [],
      ),
    );
  };
}

const platform = (region: string | undefined) => region ?? ONE_PLATFORM;

/**
 * What `describe` answers for a listed model: which one, on which platform.
 * The questions asked of it read the list in force when they are asked, so a
 * newer list takes effect without describing the model again.
 */
class ListedDescription {
  constructor(
    readonly id: string,
    readonly region: string | undefined,
  ) {}
}

/**
 * The parts of a provider's profile its lab's part of the list answers:
 * `list` is that part, or where to read the one in force (absent when the
 * list has none for the lab).
 */
export function fromModelList(
  list: ModelList | (() => ModelList | undefined),
  listedByApi?: ListedByApi,
): ModelAnswers {
  const current = typeof list === "function" ? list : () => list;
  const offeredOn = (region: string | undefined) =>
    (current()?.models ?? []).filter(
      (model) => platform(region) in model.offered,
    );
  const find = (id: string, region: string | undefined) =>
    offeredOn(region).find((model) => model.id === id);
  const entry = (described: unknown): ListedModel | undefined =>
    described instanceof ListedDescription
      ? find(described.id, described.region)
      : undefined;
  const price = (
    model: ListedModel,
    region: string | undefined,
  ): ModelPrice | undefined => {
    const listed = model.offered[platform(region)];
    const checked = current()?.checked;
    return listed && checked ? { ...listed, checked } : undefined;
  };

  return {
    catalogue: {
      async models(options): Promise<ModelCatalog> {
        const listed = await listedByApi?.(options).catch(() => undefined);
        const models = offeredOn(options.region).filter(
          (model) => !listed || listed.has(model.id),
        );
        return {
          status: "ready",
          models: models.map((model): ModelCatalogEntry => {
            const known = price(model, options.region);
            return {
              id: model.id,
              name: model.name,
              contextWindow: model.contextWindow,
              acceptsImages: model.acceptsImages,
              reasoning: model.reasoning.status === "available",
              ...(known ? { price: known } : {}),
            };
          }),
        };
      },
      // Only OpenRouter routes a model between upstreams.
      providers: async (model) => ({ status: "ready", model, providers: [] }),
    },
    describe: async (model, options) =>
      find(model, options.region)
        ? new ListedDescription(model, options.region)
        : undefined,
    window: (_listed, _picked, described) => {
      const model = entry(described);
      if (!model) return {};
      return {
        contextWindow: model.contextWindow,
        ...(model.maximumOutputTokens !== undefined
          ? { maximumOutputTokens: model.maximumOutputTokens }
          : {}),
      };
    },
    reasoning: (described) =>
      entry(described)?.reasoning ?? {
        status: "unavailable",
        reason: "This model is not on Zhiyin's list for this provider.",
      },
    acceptsImages: (described) => entry(described)?.acceptsImages === true,
    price: (id, region) => {
      const model = find(id, region);
      return model ? price(model, region) : undefined;
    },
  };
}

/** A lab provider, answered from its part of the list in force. */
export function answeredFromList(
  definition: ListedProvider,
  lists: ModelLists,
): Provider {
  const { listed, ...provider } = definition;
  const lab = () => lists.lab(definition.id);
  return {
    ...provider,
    send: (input) => {
      const entry = lab()?.models.find(
        (model) =>
          model.id === input.chosen.model &&
          platform(input.region) in model.offered,
      );
      return definition.send(entry ? { ...input, listed: entry } : input);
    },
    ...fromModelList(lab, listed.byApi),
  };
}
