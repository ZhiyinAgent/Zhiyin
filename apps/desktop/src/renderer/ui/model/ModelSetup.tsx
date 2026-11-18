import { useEffect, useEffectEvent, useId, useState } from "react";
import type {
  ApiKeySaveOutcome,
  ModelCatalog,
  ProviderSettings,
  ProviderSummary,
  ProviderTarget,
} from "@zhiyin/contract";
import {
  Icon,
  InfoTip,
  LoadingSkeleton,
  moveAmongChoices,
  tabStopOf,
} from "../shared/index.js";
import { explanations } from "./explanations.js";
import { ListedPrice } from "./ModelList.js";
import { useProviders } from "./modelLists.js";
import styles from "./model.module.css";

/** What setting up a model asks of the core: the Model page's own commands. */
export type ModelSetupCommands = {
  onListProviders: () => Promise<readonly ProviderSummary[]>;
  onListModels: (target?: ProviderTarget) => Promise<ModelCatalog>;
  onSaveApiKey: (
    apiKey: string,
    target?: ProviderTarget,
  ) => Promise<ApiKeySaveOutcome>;
  onSelectModel: (
    model: string,
    providers: readonly string[],
    target?: ProviderTarget,
  ) => Promise<void>;
  onOpenExternalUrl?: (url: string) => Promise<void>;
};

const keyOf = (target: ProviderTarget | undefined) =>
  target ? `${target.provider}:${target.region ?? ""}` : "";

/**
 * The three things a first conversation needs, in the order they are done:
 * a provider, its key, and a model. It asks the same commands the Model page
 * asks and recommends nothing: each part says what it is, and the choice is
 * the person's. A model is used as soon as it is chosen; on OpenRouter any
 * company may run it, which the Model page can narrow later. The models are
 * listed once the provider's key is saved, and the key is never shown again.
 */
export function ModelSetup({
  settings,
  onChosen,
  onListProviders,
  onListModels,
  onSaveApiKey,
  onSelectModel,
  onOpenExternalUrl,
}: ModelSetupCommands & {
  /** What is stored now, which the setup starts from. */
  settings: ProviderSettings;
  /** A model was chosen and is in use. */
  onChosen?: () => void;
}) {
  const ids = { provider: useId(), key: useId() };
  const [summaries, refreshProviders] = useProviders(onListProviders);
  const listed: readonly ProviderSummary[] =
    summaries === null || summaries === "failed" ? [] : summaries;
  const stored = settings.provider;
  const [target, setTarget] = useState<ProviderTarget>();
  const [apiKey, setApiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyNote, setKeyNote] = useState("");
  const [keyFailure, setKeyFailure] = useState("");
  /** The models listed, and the provider and platform they belong to. */
  const [modelsRead, setListed] = useState<{
    readonly for: string;
    readonly catalog: ModelCatalog;
  }>();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [failure, setFailure] = useState("");

  // Starts on the stored provider where it is listed and usable, else on the
  // first provider that can be used.
  const start =
    listed.find((each) => each.id === stored?.id && !each.unavailable) ??
    listed.find((each) => !each.unavailable);
  const shown: ProviderTarget | undefined =
    target ??
    (start
      ? {
          provider: start.id,
          ...(stored && start.id === stored.id && stored.region
            ? { region: stored.region.id }
            : start.accounts[0]?.region
              ? { region: start.accounts[0].region.id }
              : {}),
        }
      : undefined);
  const summary = listed.find((each) => each.id === shown?.provider);
  const account =
    summary?.accounts.find((each) => each.region?.id === shown?.region) ??
    summary?.accounts[0];
  const credential = account?.credential;
  const keyReady = credential?.status === "configured";
  const name = summary?.name ?? "The provider";
  // The stored model counts as chosen while the stored provider is shown.
  const storedHere =
    stored?.id === shown?.provider &&
    (stored?.region?.id ?? undefined) === shown?.region
      ? (settings.model ?? "")
      : "";
  const inUse = chosen || storedHere;

  // Read through this, so a caller that hands in new functions each time it
  // draws does not ask again: the models are asked for once for each provider
  // and platform whose key is saved.
  const listModels = useEffectEvent(() =>
    shown ? onListModels(shown) : undefined,
  );
  const shownKey = keyOf(shown);
  // A list read for another provider is never shown for this one.
  const catalog = modelsRead?.for === shownKey ? modelsRead.catalog : null;
  useEffect(() => {
    if (!keyReady || !shownKey) return;
    let cancelled = false;
    listModels()
      ?.then((next) => {
        if (!cancelled) setListed({ for: shownKey, catalog: next });
      })
      .catch(() => {
        if (!cancelled)
          setListed({
            for: shownKey,
            catalog: {
              status: "unavailable",
              reason: "The models could not be listed.",
            },
          });
      });
    return () => {
      cancelled = true;
    };
  }, [keyReady, shownKey]);

  function show(next: ProviderTarget) {
    setTarget(next);
    setApiKey("");
    setKeyNote("");
    setKeyFailure("");
    setQuery("");
    setChosen("");
    setFailure("");
  }

  async function saveKey() {
    if (!apiKey.trim() || savingKey || !shown) return;
    setSavingKey(true);
    setKeyFailure("");
    setKeyNote("");
    try {
      const outcome = await onSaveApiKey(apiKey.trim(), shown);
      if (outcome.status === "refused") setKeyFailure(outcome.reason);
      else {
        setApiKey("");
        if (outcome.status === "unverified") setKeyNote(outcome.reason);
        refreshProviders();
      }
    } catch {
      setKeyFailure("The key could not be saved. Try again.");
    } finally {
      setSavingKey(false);
    }
  }

  async function choose(model: string) {
    if (choosing || !shown || model === inUse) return;
    setChoosing(true);
    setFailure("");
    try {
      await onSelectModel(model, [], shown);
      setChosen(model);
      onChosen?.();
    } catch {
      setFailure("The model could not be chosen. Try again.");
    } finally {
      setChoosing(false);
    }
  }

  const models =
    catalog?.status === "ready"
      ? catalog.models.filter((each) =>
          `${each.name} ${each.id}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        )
      : [];
  const stop = tabStopOf(models, (each) => each.id === inUse);
  const regions = summary?.accounts.flatMap((each) =>
    each.region ? [each.region] : [],
  );

  return (
    <section className={styles["model-setup"]} aria-label="Connect an AI model">
      <ol>
        <li data-done={summary ? "true" : undefined}>
          <span className={styles["model-setup__number"]} aria-hidden="true">
            1
          </span>
          <div className={styles["model-setup__part"]}>
            <div className={styles["model-setup__heading"]}>
              <label htmlFor={ids.provider}>Provider</label>
              <InfoTip topic="providers">{explanations.provider}</InfoTip>
            </div>
            {summaries === null ? (
              <LoadingSkeleton label="Loading providers" />
            ) : summaries === "failed" ? (
              <p className={styles["model-setup__failed"]} role="alert">
                The providers could not be listed.
              </p>
            ) : (
              <div className={styles["model-setup__row"]}>
                <select
                  id={ids.provider}
                  className={styles["model-select"]}
                  value={shown?.provider ?? ""}
                  onChange={(event) => {
                    const next = listed.find(
                      (each) => each.id === event.target.value,
                    );
                    if (!next) return;
                    const region = next.accounts[0]?.region;
                    show({
                      provider: next.id,
                      ...(region ? { region: region.id } : {}),
                    });
                  }}
                >
                  {listed.map((each) => (
                    <option
                      key={each.id}
                      value={each.id}
                      disabled={Boolean(each.unavailable)}
                    >
                      {each.unavailable
                        ? `${each.name} (not available yet)`
                        : each.name}
                    </option>
                  ))}
                </select>
                {shown && regions && regions.length > 1 && (
                  <select
                    aria-label="Platform"
                    className={styles["model-select"]}
                    value={shown.region ?? ""}
                    onChange={(event) =>
                      show({
                        provider: shown.provider,
                        region: event.target.value,
                      })
                    }
                  >
                    {regions.map((region) => (
                      <option key={region.id} value={region.id}>
                        {region.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
        </li>

        <li data-done={keyReady ? "true" : undefined}>
          <span className={styles["model-setup__number"]} aria-hidden="true">
            {keyReady ? <Icon name="check" /> : 2}
          </span>
          <div className={styles["model-setup__part"]}>
            <div className={styles["model-setup__heading"]}>
              <label htmlFor={ids.key}>Key</label>
              <InfoTip topic="keys">{explanations.key}</InfoTip>
            </div>
            {credential?.status === "unavailable" ? (
              <p className={styles["model-setup__failed"]} role="alert">
                {credential.reason}
              </p>
            ) : keyReady ? (
              <p className={styles["model-setup__said"]}>
                {credential?.source === "environment"
                  ? `${name}’s key is read from this computer’s settings.`
                  : `Key saved for ${name}.`}
                {keyNote && ` ${keyNote}`}
              </p>
            ) : (
              <>
                <div className={styles["model-setup__row"]}>
                  <input
                    id={ids.key}
                    type="password"
                    placeholder={`Paste your ${name} key`}
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    disabled={!shown}
                    onChange={(event) => setApiKey(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveKey();
                    }}
                  />
                  <button
                    type="button"
                    className="button"
                    disabled={!apiKey.trim() || savingKey}
                    onClick={() => void saveKey()}
                  >
                    {savingKey ? "Checking…" : "Save key"}
                  </button>
                </div>
                {keyFailure && (
                  <p className={styles["model-setup__failed"]} role="alert">
                    {keyFailure}
                  </p>
                )}
                {onOpenExternalUrl && account?.pages.keys && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void onOpenExternalUrl(account.pages.keys)}
                  >
                    No key yet? Get one on {name}
                  </button>
                )}
              </>
            )}
          </div>
        </li>

        <li
          data-done={inUse ? "true" : undefined}
          data-waiting={keyReady ? undefined : "true"}
        >
          <span className={styles["model-setup__number"]} aria-hidden="true">
            {inUse ? <Icon name="check" /> : 3}
          </span>
          <div className={styles["model-setup__part"]}>
            <div className={styles["model-setup__heading"]}>
              <span className={styles["model-setup__name"]}>Model</span>
              <InfoTip topic="models">{explanations.model}</InfoTip>
            </div>
            {!keyReady ? (
              <p className={styles["model-setup__said"]}>
                {name}’s models are listed once its key is saved.
              </p>
            ) : catalog === null ? (
              <LoadingSkeleton label="Loading models" />
            ) : catalog.status === "unavailable" ? (
              <p className={styles["model-setup__failed"]} role="alert">
                {catalog.reason}
              </p>
            ) : (
              <>
                <input
                  type="search"
                  aria-label="Search models"
                  placeholder="Search by name"
                  autoComplete="off"
                  spellCheck={false}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {models.length === 0 ? (
                  <p className={styles["model-setup__said"]}>
                    No model’s name has that in it.
                  </p>
                ) : (
                  <div
                    className={styles["model-setup__models"]}
                    role="radiogroup"
                    aria-label="Models"
                    aria-busy={choosing || undefined}
                    onKeyDown={moveAmongChoices}
                  >
                    {models.map((each) => (
                      <button
                        key={each.id}
                        type="button"
                        role="radio"
                        aria-checked={each.id === inUse}
                        aria-label={each.name}
                        tabIndex={each === stop ? 0 : -1}
                        onClick={() => void choose(each.id)}
                      >
                        <strong>{each.name}</strong>
                        <span>
                          <ListedPrice model={each} />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {failure && (
                  <p className={styles["model-setup__failed"]} role="alert">
                    {failure}
                  </p>
                )}
              </>
            )}
          </div>
        </li>
      </ol>
    </section>
  );
}
