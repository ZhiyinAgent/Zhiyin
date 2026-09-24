import { useCallback, useEffect, useState } from "react";
import type {
  ModelCatalog,
  ModelCatalogEntry,
  ModelProviderList,
  ProviderSettings,
  ApiKeySaveOutcome,
  ContextBudgetChoice,
} from "@zhiyin/contract";
import { CloseButton, Icon } from "../shared/index.js";
import { ApiKeyDialog } from "./ApiKeyDialog.js";
import { DefaultContextBudget } from "./DefaultContextBudget.js";
import { ModelList, type ModelFilter, type ModelOrder } from "./ModelList.js";
import { ProviderTable, type ProviderOrder } from "./ProviderTable.js";
import styles from "./model.module.css";

/**
 * Choosing the model and the upstreams that may serve it.
 *
 * The choice is a draft until it is saved, because a half-made one — a model
 * picked, its providers not yet chosen — must not reach the next turn. Save
 * applies both together; Discard returns to what is stored.
 */
export function ModelSettings({
  settings,
  onClose,
  onListModels,
  onListModelProviders,
  onSelectModel,
  onSaveApiKey,
  onClearApiKey,
  defaultBudget,
  fixedTokens,
  onSetDefaultBudget,
}: {
  settings: ProviderSettings;
  onClose: () => void;
  onListModels: () => Promise<ModelCatalog>;
  onListModelProviders: (model: string) => Promise<ModelProviderList>;
  onSelectModel: (model: string, providers: readonly string[]) => Promise<void>;
  onSaveApiKey: (apiKey: string) => Promise<ApiKeySaveOutcome>;
  onClearApiKey: () => Promise<void>;
  defaultBudget: ContextBudgetChoice;
  /** Instructions and tool definitions, as the last request measured them. */
  fixedTokens?: number;
  onSetDefaultBudget: (budget: ContextBudgetChoice) => Promise<void>;
}) {
  const keyMissing = settings.credential.status !== "configured";
  const savedProviders = settings.providers ?? [];

  const [model, setModel] = useState(settings.model);
  const [providers, setProviders] = useState<readonly string[]>(savedProviders);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [list, setList] = useState<ModelProviderList | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<readonly ModelFilter[]>([]);
  const [modelOrder, setModelOrder] = useState<ModelOrder>("match");
  const [providerOrder, setProviderOrder] = useState<ProviderOrder>("price");
  const [keyOpen, setKeyOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const dirty =
    model !== settings.model ||
    providers.length !== savedProviders.length ||
    providers.some((slug) => !savedProviders.includes(slug));

  // Nothing has been asked for yet is the same thing as still waiting for it,
  // so waiting is derived rather than tracked. A flag set at the top of an
  // effect is a second source of truth that can disagree with the first.
  const loadingCatalog = !keyMissing && catalog === null;
  const loadingProviders = !keyMissing && model !== "" && list === null;

  useEffect(() => {
    if (keyMissing) return;
    let cancelled = false;
    onListModels()
      .then((result) => {
        if (!cancelled) setCatalog(result);
      })
      .catch(() => {
        if (!cancelled)
          setCatalog({
            status: "unavailable",
            reason: "The model list could not be loaded.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [keyMissing, onListModels]);

  useEffect(() => {
    if (keyMissing || !model) return;
    let cancelled = false;
    onListModelProviders(model)
      .then((result) => {
        if (!cancelled) setList(result);
      })
      .catch(() => {
        if (!cancelled)
          setList({
            status: "unavailable",
            reason: "The provider list could not be loaded.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [keyMissing, model, onListModelProviders]);

  const chooseModel = useCallback((entry: ModelCatalogEntry) => {
    setModel(entry.id);
    // A provider list belongs to the model it was chosen for; both the choice
    // and the list of what could be chosen are dropped together.
    setProviders([]);
    setList(null);
  }, []);

  const toggleProvider = useCallback((slug: string) => {
    setProviders((current) =>
      current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [...current, slug],
    );
  }, []);

  const toggleFilter = useCallback((filter: ModelFilter) => {
    setFilters((current) =>
      current.includes(filter)
        ? current.filter((item) => item !== filter)
        : [...current, filter],
    );
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    try {
      await onSelectModel(model, providers);
    } catch {
      setFailure("The choice could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setModel(settings.model);
    setProviders(settings.providers ?? []);
    setFailure(null);
  }

  const chosenName =
    catalog?.status === "ready"
      ? catalog.models.find((entry) => entry.id === settings.model)?.name
      : settings.modelName;

  /**
   * A stored model the catalogue no longer lists. Only ever concluded from a
   * catalogue that actually arrived: a list that failed to load says nothing
   * about whether a model still exists, and treating those the same would tell
   * somebody their model had been withdrawn every time the network was down.
   *
   * The choice is left exactly as it is. Replacing it silently would answer the
   * next turn as a model nobody picked.
   */
  const withdrawn =
    catalog?.status === "ready" &&
    settings.model !== "" &&
    !catalog.models.some((entry) => entry.id === settings.model);

  return (
    <section className={styles["model-settings"]} aria-label="Model">
      <header className={styles["model-settings__head"]}>
        <div>
          <p className="instrument-label">Workspace / Settings</p>
          <h1>Model</h1>
        </div>
        <div className={styles["model-settings__actions"]}>
          {failure && (
            <span className={styles["model-settings__failed"]} role="alert">
              {failure}
            </span>
          )}
          {dirty && !failure && (
            <span className={styles["model-settings__dirty"]}>
              Not saved yet
            </span>
          )}
          <button
            className="button"
            type="button"
            disabled={!dirty || saving}
            onClick={discard}
          >
            Discard
          </button>
          <button
            className="button button--accent"
            type="button"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            className={`${styles["model-icon-button"]}${keyMissing ? ` ${styles["model-icon-button--alert"]}` : ""}`}
            type="button"
            aria-label="OpenRouter API key"
            title="OpenRouter API key"
            onClick={() => setKeyOpen(true)}
          >
            <Icon name="settings" />
          </button>
          <CloseButton label="Close settings" onClick={onClose} />
        </div>
      </header>

      <p className={styles["model-settings__current"]}>
        <span className={styles["model-settings__label"]}>Now using</span>
        <strong>{chosenName ?? settings.model}</strong>
        <code>{settings.model}</code>
        <span className={styles["model-settings__routing"]}>
          {savedProviders.length === 0
            ? "Any provider"
            : savedProviders.length === 1
              ? "1 provider"
              : `${savedProviders.length} providers`}
        </span>
        {withdrawn && (
          <span className={styles["model-settings__withdrawn"]} role="status">
            No longer offered by OpenRouter. Choose another model below.
          </span>
        )}
      </p>

      <DefaultContextBudget
        settings={settings}
        budget={defaultBudget}
        {...(fixedTokens !== undefined ? { fixedTokens } : {})}
        onChoose={(budget) => void onSetDefaultBudget(budget)}
      />

      <div className={styles["model-settings__columns"]}>
        <ModelList
          catalog={catalog}
          loading={loadingCatalog}
          selected={model}
          query={query}
          onQueryChange={setQuery}
          activeFilters={filters}
          onToggleFilter={toggleFilter}
          order={modelOrder}
          onOrderChange={setModelOrder}
          onSelect={chooseModel}
          onAddKey={() => setKeyOpen(true)}
          keyMissing={keyMissing}
        />
        <ProviderTable
          list={list}
          loading={loadingProviders}
          selected={providers}
          order={providerOrder}
          onOrderChange={setProviderOrder}
          onToggle={toggleProvider}
          onAutomatic={() => setProviders([])}
          onAddKey={() => setKeyOpen(true)}
          keyMissing={keyMissing}
        />
      </div>

      {keyOpen && (
        <ApiKeyDialog
          credential={settings.credential}
          onClose={() => setKeyOpen(false)}
          onSaveApiKey={onSaveApiKey}
          onClearApiKey={onClearApiKey}
        />
      )}
    </section>
  );
}
