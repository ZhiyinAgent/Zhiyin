import { useCallback, useEffect, useState } from "react";
import type {
  ModelCatalog,
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

/**
 * What can be chosen on the account shown: its models, and on a provider that
 * routes between upstreams, the upstreams of the model chosen. Neither is
 * read without the account's key. A list is forgotten when what it was read
 * for changes, so the next one is waited for.
 */
export function useModelLists({
  keyMissing,
  routes,
  model,
  target,
  onListModels,
  onListModelProviders,
}: {
  keyMissing: boolean;
  routes: boolean | undefined;
  model: string;
  target: ProviderTarget | undefined;
  onListModels: (target?: ProviderTarget) => Promise<ModelCatalog>;
  onListModelProviders: (
    model: string,
    target?: ProviderTarget,
  ) => Promise<ModelProviderList>;
}) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [list, setList] = useState<ModelProviderList | null>(null);

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
