import { useMemo } from "react";
import type { ModelCatalog, ModelCatalogEntry } from "@zhiyin/contract";
import { LoadingSkeleton } from "../shared/index.js";
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
const lowerCostPerMillion = 1;

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
          case "cheap":
            return row.model.inputUsdPerMillion < lowerCostPerMillion;
        }
      }),
    );

  const byName = (a: Row, b: Row) => a.model.name.localeCompare(b.model.name);
  switch (order) {
    case "price":
      return [...matched].sort(
        (a, b) => a.model.inputUsdPerMillion - b.model.inputUsdPerMillion,
      );
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
            Clear a filter, or search by the part of the name after the slash.
          </p>
        </div>
      ) : (
        <div
          className={styles["model-list"]}
          role="radiogroup"
          aria-label="Models"
        >
          {visible.map(({ model, nameHits, idHits }) => (
            <button
              key={model.id}
              className={styles["model-row"]}
              type="button"
              role="radio"
              aria-checked={selected === model.id}
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
                  {perMillion(model.inputUsdPerMillion)} in /{" "}
                  {perMillion(model.outputUsdPerMillion)} out
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
