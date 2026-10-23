import { useMemo } from "react";
import type { ModelCatalog, ModelCatalogEntry } from "@zhiyin/contract";
import {
  LoadingSkeleton,
  moveAmongChoices,
  tabStopOf,
} from "../shared/index.js";
import { fuzzyMatch, fuzzySegments } from "./fuzzy.js";
import { perMillion, tokenCount } from "./format.js";
import styles from "./model.module.css";

export type ModelOrder = "match" | "price" | "context" | "name";
export type ModelFilter = "image" | "reasoning" | "large" | "cheap";

const orders: readonly {
  readonly value: ModelOrder;
  readonly label: string;
}[] = [
  { value: "match", label: "Best match" },
  { value: "price", label: "Lowest price" },
  { value: "context", label: "Largest context window" },
  { value: "name", label: "Name" },
];

const filters: readonly {
  readonly value: ModelFilter;
  readonly label: string;
}[] = [
  { value: "image", label: "Image" },
  { value: "reasoning", label: "Reasoning" },
  { value: "large", label: "Large context window" },
  { value: "cheap", label: "Lower cost" },
];

const largeContextWindow = 200_000;
/**
 * Below this price per million input tokens, in each currency a list is priced
 * in, a model counts as lower cost: about the same amount in each.
 */
const lowerCostPerMillion: Readonly<Record<string, number>> = {
  USD: 1,
  CNY: 7,
};

/**
 * What a model costs per million tokens: OpenRouter's price in US dollars, or
 * a lab's own price in its own currency. Absent where neither is listed.
 */
function listedPrice(model: ModelCatalogEntry) {
  if (
    model.inputUsdPerMillion !== undefined &&
    model.outputUsdPerMillion !== undefined
  )
    return {
      currency: "USD",
      input: model.inputUsdPerMillion,
      output: model.outputUsdPerMillion,
    };
  return model.price;
}

type Row = {
  readonly model: ModelCatalogEntry;
  readonly score: number;
  readonly nameHits: readonly number[];
  readonly idHits: readonly number[];
};

function rows(
  models: readonly ModelCatalogEntry[],
  query: string,
  active: readonly ModelFilter[],
  order: ModelOrder,
): readonly Row[] {
  const matched = models
    .map((model): Row | null => {
      const name = fuzzyMatch(query, model.name);
      const id = fuzzyMatch(query, model.id);
      if (!name && !id) return null;
      return {
        model,
        score: Math.max(name?.score ?? 0, id?.score ?? 0),
        nameHits:
          (name?.score ?? -1) >= (id?.score ?? -1) ? (name?.hits ?? []) : [],
        idHits: (id?.score ?? -1) > (name?.score ?? -1) ? (id?.hits ?? []) : [],
      };
    })
    .filter((row): row is Row => row !== null)
    .filter((row) =>
      active.every((filter) => {
        switch (filter) {
          case "image":
            return row.model.acceptsImages;
          case "reasoning":
            return row.model.reasoning;
          case "large":
            return row.model.contextWindow >= largeContextWindow;
          // Each currency has its own threshold; a price is never converted.
          case "cheap": {
            const price = listedPrice(row.model);
            const threshold = price && lowerCostPerMillion[price.currency];
            return (
              price !== undefined &&
              threshold !== undefined &&
              price.input < threshold
            );
          }
        }
      }),
    );

  const byName = (a: Row, b: Row) => a.model.name.localeCompare(b.model.name);
  switch (order) {
    case "price":
      // Prices in one currency are compared with each other, and a model
      // with no listed price comes last.
      return [...matched].sort((a, b) => {
        const left = listedPrice(a.model);
        const right = listedPrice(b.model);
        if (!left || !right) return (left ? 0 : 1) - (right ? 0 : 1);
        return (
          left.currency.localeCompare(right.currency) ||
          left.input - right.input
        );
      });
    case "context":
      return [...matched].sort(
        (a, b) => b.model.contextWindow - a.model.contextWindow,
      );
    case "name":
      return [...matched].sort(byName);
    case "match":
      return [...matched].sort((a, b) => b.score - a.score || byName(a, b));
  }
}

function ListedPrice({ model }: { model: ModelCatalogEntry }) {
  const price = listedPrice(model);
  if (!price) return <>Price not listed</>;
  return (
    <>
      {perMillion(price.input, price.currency)} in /{" "}
      {perMillion(price.output, price.currency)} out
    </>
  );
}

function Emphasised({ text, hits }: { text: string; hits: readonly number[] }) {
  return (
    <>
      {fuzzySegments(text, hits).map((segment, index) =>
        segment.matched ? (
          <mark key={index}>{segment.text}</mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export function ModelList({
  catalog,
  loading,
  selected,
  query,
  onQueryChange,
  activeFilters,
  onToggleFilter,
  order,
  onOrderChange,
  onSelect,
}: {
  catalog: ModelCatalog | null;
  loading: boolean;
  selected: string;
  query: string;
  onQueryChange: (query: string) => void;
  activeFilters: readonly ModelFilter[];
  onToggleFilter: (filter: ModelFilter) => void;
  order: ModelOrder;
  onOrderChange: (order: ModelOrder) => void;
  onSelect: (model: ModelCatalogEntry) => void;
}) {
  const visible = useMemo(
    () =>
      catalog?.status === "ready"
        ? rows(catalog.models, query, activeFilters, order)
        : [],
    [catalog, query, activeFilters, order],
  );
  const stop = tabStopOf(
    visible.map((row) => row.model),
    (model) => model.id === selected,
  );

  return (
    <section
      className={`${styles["model-column"]} ${styles["model-column--models"]}`}
      aria-label="Models"
    >
      <div className={styles["model-column__top"]}>
        <div className={styles["model-search"]}>
          <input
            id="model-search"
            type="search"
            placeholder="Search by name"
            aria-label="Search models"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
        <div className={styles["model-controls"]}>
          <div
            className={`${styles["model-control"]} ${styles["model-control--grow"]}`}
          >
            <span className={styles["model-control__label"]}>Show only</span>
            <div className={styles["model-checks"]}>
              {filters.map((filter) => (
                <label className={styles["model-check"]} key={filter.value}>
                  <input
                    type="checkbox"
                    checked={activeFilters.includes(filter.value)}
                    onChange={() => onToggleFilter(filter.value)}
                  />
                  {filter.label}
                </label>
              ))}
            </div>
            {/*
              Not a filter: Zhiyin works by calling tools, so a model without
              them is unusable rather than a narrower choice. Said so the
              exclusion is visible instead of silent.
            */}
            <p className={styles["model-checks__note"]}>
              Showing only models that can use tools, which Zhiyin needs.
            </p>
          </div>
          <div className={styles["model-control"]}>
            <label
              className={styles["model-control__label"]}
              htmlFor="model-order"
            >
              Order by
            </label>
            <select
              className={styles["model-select"]}
              id="model-order"
              value={order}
              onChange={(event) =>
                onOrderChange(event.target.value as ModelOrder)
              }
            >
              {orders.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton label="Loading models" />
      ) : catalog?.status === "unavailable" ? (
        <div className={styles["model-empty"]} role="status">
          <strong>The model list is unavailable</strong>
          <p>{catalog.reason}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className={styles["model-empty"]}>
          <strong>Nothing matches</strong>
          <p>
            {catalog?.status === "ready" &&
            catalog.models.some((model) => model.id.includes("/"))
              ? "Clear a filter, or search by the part of the name after the slash."
              : "Clear a filter, or search for another part of the name."}
          </p>
        </div>
      ) : (
        <div
          className={styles["model-list"]}
          role="radiogroup"
          aria-label="Models"
          onKeyDown={moveAmongChoices}
        >
          {visible.map(({ model, nameHits, idHits }) => (
            <button
              key={model.id}
              className={styles["model-row"]}
              type="button"
              role="radio"
              aria-checked={selected === model.id}
              tabIndex={model === stop ? 0 : -1}
              /*
                Named explicitly. The emphasis around matched characters splits
                the name into separate inline elements, and a name computed from
                that content loses the spaces between them — so a reader would
                hear "ClaudeSonnet5".
              */
              aria-label={`${model.name} ${model.id}`}
              onClick={() => onSelect(model)}
            >
              <span className={styles["model-row__title"]}>
                <strong>
                  <Emphasised text={model.name} hits={nameHits} />
                </strong>
                <span className={styles["model-row__price"]}>
                  <ListedPrice model={model} />
                </span>
              </span>
              <span className={styles["model-row__id"]}>
                <Emphasised text={model.id} hits={idHits} />
              </span>
              <span className={styles["model-row__tags"]}>
                {model.acceptsImages && (
                  <span
                    className={`${styles["model-badge"]} ${styles["model-badge--good"]}`}
                  >
                    Image
                  </span>
                )}
                {model.reasoning && (
                  <span
                    className={`${styles["model-badge"]} ${styles["model-badge--accent"]}`}
                  >
                    Reasoning
                  </span>
                )}
                <span className={styles["model-badge"]}>
                  {tokenCount(model.contextWindow)} token context window
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
