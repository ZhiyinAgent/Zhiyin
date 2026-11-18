import type { ProviderSummary, ProviderTarget } from "@zhiyin/contract";
import {
  InfoTip,
  LoadingSkeleton,
  moveAmongChoices,
  tabStopOf,
} from "../shared/index.js";
import { explanations } from "./explanations.js";
import styles from "./model.module.css";

/**
 * Who requests go to: every provider by its name, in its own colour. Its
 * platform and key are set in the account bar beside the list.
 *
 * A provider whose path does not work yet is listed and cannot be chosen, with
 * the reason a hover away: hiding it would leave the person wondering whether
 * it exists.
 */
export function ProviderColumn({
  providers,
  target,
  onChoose,
}: {
  /** Null while loading. */
  providers: readonly ProviderSummary[] | "failed" | null;
  target: ProviderTarget | undefined;
  onChoose: (target: ProviderTarget) => void;
}) {
  return (
    <section
      className={`${styles["model-column"]} ${styles["model-column--providers"]}`}
      aria-label="Provider"
    >
      <div className={styles["model-column__title"]}>
        <h3 className={styles["model-control__label"]}>1 · Provider</h3>
        <InfoTip topic="providers">{explanations.provider}</InfoTip>
      </div>

      {providers === null ? (
        <LoadingSkeleton label="Loading providers" />
      ) : providers === "failed" ? (
        <p className={styles["provider-list__failed"]} role="status">
          The providers could not be listed.
        </p>
      ) : (
        <div
          className={styles["provider-list"]}
          role="radiogroup"
          aria-label="Provider"
          onKeyDown={moveAmongChoices}
        >
          {providers.map((provider, _index, all) => {
            const chosen = target?.provider === provider.id;
            const stop =
              tabStopOf(
                all,
                (item) => target?.provider === item.id,
                (item) => !item.unavailable,
              ) === provider;
            const first = provider.accounts[0]?.region;
            return (
              <button
                key={provider.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                tabIndex={stop ? 0 : -1}
                aria-disabled={provider.unavailable ? true : undefined}
                data-tip={provider.unavailable}
                className={`${styles["provider-option"]} ${styles["provider-name"]}`}
                data-provider={provider.id}
                onClick={() => {
                  if (provider.unavailable || chosen) return;
                  onChoose({
                    provider: provider.id,
                    ...(first ? { region: first.id } : {}),
                  });
                }}
              >
                {provider.name}
                {provider.unavailable && (
                  <span className={styles["provider-option__note"]}>
                    Not available yet
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
