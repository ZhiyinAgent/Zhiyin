import type { ProviderSettings } from "@zhiyin/contract";
import { hostOf } from "./format.js";
import styles from "./model.module.css";

/**
 * What is stored and answers the next turn, whatever the draft below says:
 * the provider and its platform, the host its requests go to, the model, and
 * on a provider that routes, how many upstreams may serve it.
 */
export function CurrentChoice({
  saved,
  endpoint,
  model,
  modelName,
  upstreams,
  withdrawn,
}: {
  saved: ProviderSettings["provider"];
  /** Where the stored provider's requests go. */
  endpoint: string;
  /** The stored model's id; empty until the person chooses one. */
  model: string;
  /** Its name, where one is known for it. */
  modelName: string | undefined;
  upstreams: readonly string[];
  /** The catalogue arrived and no longer lists the stored model. */
  withdrawn: boolean;
}) {
  return (
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
      <strong data-tip={modelName ? model : undefined}>
        {modelName ?? (model || "No model chosen")}
      </strong>
      {model && saved?.upstreams && (
        <span className={styles["model-settings__routing"]}>
          {upstreams.length === 0
            ? "Any provider"
            : upstreams.length === 1
              ? "1 provider"
              : `${upstreams.length} providers`}
        </span>
      )}
      {saved && endpoint && (
        <span className={styles["model-settings__routing"]}>
          Requests go to {hostOf(endpoint)}
        </span>
      )}
      {withdrawn && (
        <span className={styles["model-settings__withdrawn"]} role="status">
          No longer offered by {saved?.name ?? "the provider"}. Choose another
          model below.
        </span>
      )}
    </p>
  );
}
