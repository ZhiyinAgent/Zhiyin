import { useCallback, useEffect, useEffectEvent, useState } from "react";
import type {
  ModelCatalog,
  ModelListState,
  ModelProviderList,
  ProviderSummary,
  ProviderTarget,
} from "@zhiyin/contract";

/**
 * The providers and their accounts, read when the page opens and again on
 * request, which is whenever one of their keys has changed.
 */
export function useProviders(
  onListProviders: () => Promise<readonly ProviderSummary[]>,
) {
  const [summaries, setSummaries] = useState<
    readonly ProviderSummary[] | "failed" | null
  >(null);

  const refresh = useCallback(() => {
    onListProviders()
      .then(setSummaries)
      // A list already shown stays: a failed refresh says nothing new.
      .catch(() => setSummaries((current) => current ?? "failed"));
  }, [onListProviders]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return [summaries, refresh] as const;
}

/** Zhiyin's model list as the Model page reads and steers it (ADR 0031). */
export type ModelListCommands = {
  readonly state: () => Promise<ModelListState>;
  readonly check: () => Promise<ModelListState>;
  readonly setUpdates: (enabled: boolean) => Promise<ModelListState>;
};

/**
 * The model list in force, read when the page opens, and a look for a newer
 * one then, and again when updates are turned on. Nothing is looked for
 * while they are off. `revision` is the version of a newer list a look
 * brought while the page was open, 0 until one does: the models are listed
 * again for it.
 */
export function useModelList(commands: ModelListCommands | undefined) {
  const [state, setState] = useState<ModelListState | null>(null);
  /** The version in force when the page opened. */
  const [opened, setOpened] = useState<number | null>(null);
  /** Looks asked for, and the last one that ended. */
  const [asked, setAsked] = useState(0);
  const [answered, setAnswered] = useState(0);
  // Read through these, so a caller that hands in new functions each time it
  // draws does not ask again.
  const readState = useEffectEvent(() => commands?.state());
  const lookNow = useEffectEvent(() => commands?.check());

  useEffect(() => {
    let cancelled = false;
    readState()
      ?.then((current) => {
        if (cancelled) return;
        setState(current);
        setOpened(current.version);
        if (current.updates) setAsked((count) => count + 1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (asked === 0) return;
    let cancelled = false;
    lookNow()
      ?.then((next) => {
        if (!cancelled) setState(next);
      })
      // The list in force stays, and says so.
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setAnswered(asked);
      });
    return () => {
      cancelled = true;
    };
  }, [asked]);

  const setUpdates = useCallback(
    (enabled: boolean) => {
      if (!commands) return;
      setState((current) => current && { ...current, updates: enabled });
      commands
        .setUpdates(enabled)
        .then((next) => {
          setState(next);
          if (enabled) setAsked((count) => count + 1);
        })
        .catch(() =>
          setState((current) => current && { ...current, updates: !enabled }),
        );
    },
    [commands],
  );

  return {
    state,
    checking: asked > answered,
    revision:
      state && opened !== null && state.version !== opened ? state.version : 0,
    setUpdates,
  };
}

/**
 * What can be chosen on the account shown: its models, and on a provider that
 * routes between upstreams, the upstreams of the model chosen. Neither is
 * read without the account's key. A list is forgotten when what it was read
 * for changes, so the next one is waited for; the models are read again when
 * another model list comes into force (`listRevision`).
 */
export function useModelLists({
  keyMissing,
  routes,
  model,
  target,
  listRevision,
  onListModels,
  onListModelProviders,
}: {
  keyMissing: boolean;
  routes: boolean | undefined;
  model: string;
  target: ProviderTarget | undefined;
  /** A newer model list that came into force while the page was open. */
  listRevision?: number;
  onListModels: (target?: ProviderTarget) => Promise<ModelCatalog>;
  onListModelProviders: (
    model: string,
    target?: ProviderTarget,
  ) => Promise<ModelProviderList>;
}) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [list, setList] = useState<ModelProviderList | null>(null);
  // Asked again only when what they are read for changes: the caller may hand
  // in new functions every time it draws, and each new ask would drop the
  // answer still on its way.
  const listModels = useEffectEvent((at?: ProviderTarget) => onListModels(at));
  const listUpstreams = useEffectEvent((id: string, at?: ProviderTarget) =>
    onListModelProviders(id, at),
  );

  useEffect(() => {
    if (keyMissing) return;
    let cancelled = false;
    listModels(target)
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
  }, [keyMissing, target, listRevision]);

  useEffect(() => {
    if (keyMissing || !model || routes !== true) return;
    let cancelled = false;
    listUpstreams(model, target)
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
  }, [keyMissing, model, routes, target]);

  const forgetCatalog = useCallback(() => setCatalog(null), []);
  const forgetList = useCallback(() => setList(null), []);

  return {
    catalog,
    list,
    // Nothing has been asked for yet is the same thing as still waiting for it,
    // so waiting is derived rather than tracked. A flag set at the top of an
    // effect is a second source of truth that can disagree with the first.
    loadingCatalog: !keyMissing && catalog === null,
    loadingUpstreams:
      !keyMissing && routes === true && model !== "" && list === null,
    forgetCatalog,
    forgetList,
  };
}
