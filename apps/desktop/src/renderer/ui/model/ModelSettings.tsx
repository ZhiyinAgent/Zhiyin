import { useCallback, useEffect, useState } from "react";
import type {
  ModelCatalog,
  ModelCatalogEntry,
  ModelProviderList,
  ProviderSettings,
  ProviderSummary,
  ProviderTarget,
  ApiKeySaveOutcome,
} from "@zhiyin/contract";
import { CloseButton } from "../shared/index.js";
import { AccountBar } from "./AccountBar.js";
import { ApiKeyDialog } from "./ApiKeyDialog.js";
import { hostOf } from "./format.js";
import { ModelDetails } from "./ModelDetails.js";
import { ModelList, type ModelFilter, type ModelOrder } from "./ModelList.js";
import { ProviderColumn } from "./ProviderColumn.js";
import { ProviderTable, type ProviderOrder } from "./ProviderTable.js";
import styles from "./model.module.css";

const sameTarget = (
  a: ProviderTarget | undefined,
  b: ProviderTarget | undefined,
) => a?.provider === b?.provider && a?.region === b?.region;

/**
 * Choosing who requests go to: the provider, its platform where the lab runs
 * two, the model, and on a provider that routes between upstreams, the
 * upstreams that may serve it. A lab serves its models itself, so in place of
 * upstreams it shows what the model chosen costs there and what it can do.
 *
 * The choice is a draft until it is saved, because a half-made one — a model
 * picked, its upstreams not yet chosen, or a provider without a model — must
 * not reach the next turn. Save applies all of it together; Discard returns to
 * what is stored. The key belongs to the provider and platform shown, so one
 * can be added before anything is saved.
 */
export function ModelSettings({
  settings,
  onClose,
  onListProviders,
  onListModels,
  onListModelProviders,
  onSelectModel,
  onSaveApiKey,
  onClearApiKey,
  onOpenExternalUrl,
  openKeyDialog = false,
}: {
  settings: ProviderSettings;
  onClose: () => void;
  onListProviders: () => Promise<readonly ProviderSummary[]>;
  onListModels: (target?: ProviderTarget) => Promise<ModelCatalog>;
  onListModelProviders: (
    model: string,
    target?: ProviderTarget,
  ) => Promise<ModelProviderList>;
  onSelectModel: (
    model: string,
    providers: readonly string[],
    target?: ProviderTarget,
  ) => Promise<void>;
  onSaveApiKey: (
    apiKey: string,
    target?: ProviderTarget,
  ) => Promise<ApiKeySaveOutcome>;
  onClearApiKey: (target?: ProviderTarget) => Promise<void>;
  onOpenExternalUrl?: (url: string) => Promise<void>;
  /** Opens on the key dialog, for a person sent here to change the key. */
  openKeyDialog?: boolean;
}) {
  const saved = settings.provider;
  const savedTarget: ProviderTarget | undefined = saved
    ? {
        provider: saved.id,
        ...(saved.region ? { region: saved.region.id } : {}),
      }
    : undefined;
  const savedUpstreams = settings.providers ?? [];
  /** Empty until the person chooses a model. */
  const savedModel = settings.model ?? "";

  const [summaries, setSummaries] = useState<
    readonly ProviderSummary[] | "failed" | null
  >(null);
  const [target, setTarget] = useState(savedTarget);
  const [model, setModel] = useState(savedModel);
  const [upstreams, setUpstreams] = useState<readonly string[]>(savedUpstreams);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [list, setList] = useState<ModelProviderList | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<readonly ModelFilter[]>([]);
  const [modelOrder, setModelOrder] = useState<ModelOrder>("match");
  const [providerOrder, setProviderOrder] = useState<ProviderOrder>("price");
  const [keyOpen, setKeyOpen] = useState(openKeyDialog);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const showsSaved = sameTarget(target, savedTarget);
  const summary =
    summaries === "failed"
      ? undefined
      : summaries?.find((each) => each.id === target?.provider);
  const account = summary?.accounts.find(
    (each) => each.region?.id === target?.region,
  );
  /*
   * The stored provider's key is read from its settings, which follow every
   * change to it as it happens; another provider's from the list, read again
   * whenever one of its keys changes here.
   */
  const credential = showsSaved
    ? settings.credential
    : (account?.credential ?? settings.credential);
  const providerName = summary?.name ?? saved?.name;
  const pages = account?.pages ?? (showsSaved ? saved?.pages : undefined);
  const routes = summary ? summary.upstreams === true : saved?.upstreams;
  const keyMissing = credential.status !== "configured";

  const dirty =
    !showsSaved ||
    model !== savedModel ||
    upstreams.length !== savedUpstreams.length ||
    upstreams.some((slug) => !savedUpstreams.includes(slug));

  // Nothing has been asked for yet is the same thing as still waiting for it,
  // so waiting is derived rather than tracked. A flag set at the top of an
  // effect is a second source of truth that can disagree with the first.
  const loadingCatalog = !keyMissing && catalog === null;
  const loadingUpstreams =
    !keyMissing && routes === true && model !== "" && list === null;

  const refreshProviders = useCallback(() => {
    onListProviders()
      .then(setSummaries)
      // A list already shown stays: a failed refresh says nothing new.
      .catch(() => setSummaries((current) => current ?? "failed"));
  }, [onListProviders]);

  useEffect(() => {
    refreshProviders();
  }, [refreshProviders]);

  useEffect(() => {
    if (keyMissing) return;
    let cancelled = false;
    onListModels(target)
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
  }, [keyMissing, onListModels, target]);

  useEffect(() => {
    if (keyMissing || !model || routes !== true) return;
    let cancelled = false;
    onListModelProviders(model, target)
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
  }, [keyMissing, model, routes, onListModelProviders, target]);

  function chooseTarget(next: ProviderTarget) {
    // A new target is set only when it is another one: the lists are read
    // again whenever it changes.
    if (sameTarget(next, target)) return;
    setTarget(next);
    // A model belongs to the account it was chosen on; returning to the
    // stored provider brings its stored choice back with it.
    const back = sameTarget(next, savedTarget);
    setModel(back ? savedModel : "");
    setUpstreams(back ? savedUpstreams : []);
    setCatalog(null);
    setList(null);
    setFailure(null);
  }

  const chooseModel = useCallback((entry: ModelCatalogEntry) => {
    setModel(entry.id);
    // An upstream list belongs to the model it was chosen for; both the choice
    // and the list of what could be chosen are dropped together.
    setUpstreams([]);
    setList(null);
  }, []);

  const toggleUpstream = useCallback((slug: string) => {
    setUpstreams((current) =>
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
    if (saving || !model) return;
    setSaving(true);
    setFailure(null);
    try {
      await (target
        ? onSelectModel(model, upstreams, target)
        : onSelectModel(model, upstreams));
    } catch {
      setFailure("The choice could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (!showsSaved) {
      setTarget(savedTarget);
      setCatalog(null);
      setList(null);
    }
    setModel(savedModel);
    setUpstreams(savedUpstreams);
    setFailure(null);
  }

  const nameOf = (id: string) =>
    showsSaved && catalog?.status === "ready"
      ? catalog.models.find((entry) => entry.id === id)?.name
      : id === savedModel
        ? settings.modelName
        : undefined;
  const chosenName = nameOf(savedModel);
  const draft =
    catalog?.status === "ready"
      ? catalog.models.find((entry) => entry.id === model)
      : undefined;

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
    showsSaved &&
    catalog?.status === "ready" &&
    savedModel !== "" &&
    !catalog.models.some((entry) => entry.id === savedModel);

  const unsavable = !dirty
    ? "Nothing has changed yet"
    : !model
      ? "Choose a model first"
      : undefined;

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
            data-tip={!dirty ? "Nothing has changed yet" : undefined}
            onClick={discard}
          >
            Discard
          </button>
          <button
            className="button button--accent"
            type="button"
            disabled={unsavable !== undefined || saving}
            data-tip={unsavable}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <CloseButton label="Close settings" onClick={onClose} />
        </div>
      </header>

      <p className={styles["model-settings__current"]}>
        <span className={styles["model-settings__label"]}>Now using</span>
        {saved && (
          <span
            className={`${styles["model-settings__provider"]} ${styles["provider-name"]}`}
            data-provider={saved.id}
          >
            {saved.region ? `${saved.name} · ${saved.region.name}` : saved.name}
          </span>
        )}
        <strong data-tip={chosenName ? savedModel : undefined}>
          {chosenName ?? (savedModel || "No model chosen")}
        </strong>
        {savedModel && saved?.upstreams && (
          <span className={styles["model-settings__routing"]}>
            {savedUpstreams.length === 0
              ? "Any provider"
              : savedUpstreams.length === 1
                ? "1 provider"
                : `${savedUpstreams.length} providers`}
          </span>
        )}
        {withdrawn && (
          <span className={styles["model-settings__withdrawn"]} role="status">
            No longer offered by {saved?.name ?? "the provider"}. Choose another
            model below.
          </span>
        )}
      </p>

      <div
        className={`${styles["model-settings__columns"]}${routes ? ` ${styles["model-settings__columns--routed"]}` : ""}`}
      >
        <ProviderColumn
          providers={summaries}
          target={target}
          onChoose={chooseTarget}
        />
        {target && providerName && (
          <AccountBar
            id={target.provider}
            name={providerName}
            regions={
              summary?.accounts.flatMap((each) =>
                each.region ? [each.region] : [],
              ) ?? []
            }
            region={target.region}
            credential={credential}
            {...(pages ? { billingPage: pages.billing } : {})}
            {...(onOpenExternalUrl ? { onOpenExternalUrl } : {})}
            onChooseRegion={(region) =>
              chooseTarget({ provider: target.provider, region })
            }
            onKey={() => setKeyOpen(true)}
          />
        )}
        {keyMissing ? (
          // Nothing for this provider can be listed without its key, so one
          // card stands for the columns it would fill.
          <div className={styles["key-card"]}>
            <div className={styles["key-card__words"]}>
              <strong>
                Add {providerName ? articled(providerName) : "a"} key
              </strong>
              <p>
                {routes
                  ? "Models, the providers serving them and how those providers have been running are listed once Zhiyin has a key for this account."
                  : `${providerName ?? "The provider"}'s models are listed once Zhiyin has a key for this account.`}
                {pages && ` Keys are made on ${hostOf(pages.keys)}.`}
              </p>
            </div>
            <button
              className="button"
              type="button"
              onClick={() => setKeyOpen(true)}
            >
              Add a key
            </button>
          </div>
        ) : (
          <>
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
            />
            {routes ? (
              <ProviderTable
                list={list}
                {...(draft ? { modelName: draft.name } : {})}
                loading={loadingUpstreams}
                selected={upstreams}
                order={providerOrder}
                onOrderChange={setProviderOrder}
                onToggle={toggleUpstream}
                onAutomatic={() => setUpstreams([])}
              />
            ) : (
              <ModelDetails
                model={draft}
                providerName={providerName ?? "The provider"}
              />
            )}
          </>
        )}
      </div>

      {keyOpen && (
        <ApiKeyDialog
          providerName={providerName ?? "Provider"}
          {...(target?.region && account?.region
            ? { platformName: account.region.name }
            : {})}
          {...(pages ? { keysPage: pages.keys } : {})}
          credential={credential}
          onClose={() => setKeyOpen(false)}
          onSaveApiKey={async (apiKey) => {
            const outcome = await onSaveApiKey(apiKey, target);
            refreshProviders();
            return outcome;
          }}
          onClearApiKey={async () => {
            await onClearApiKey(target);
            refreshProviders();
          }}
          {...(onOpenExternalUrl ? { onOpenExternalUrl } : {})}
        />
      )}
    </section>
  );
}

/** "an OpenRouter", "a DeepSeek": the article a name is read with. */
function articled(name: string): string {
  return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}
