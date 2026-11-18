import type { ProviderPages } from "@zhiyin/contract";
import { hostOf } from "./format.js";
import styles from "./model.module.css";

/** "an OpenRouter", "a DeepSeek": the article a name is read with. */
function articled(name: string): string {
  return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}

/**
 * Asks for a provider's key. Nothing for the provider can be listed without
 * it, so one card stands for the columns it would fill.
 */
export function KeyCard({
  providerName,
  routes,
  pages,
  onAdd,
}: {
  providerName: string | undefined;
  /** The provider routes between upstreams, so those are listed too. */
  routes: boolean | undefined;
  pages: ProviderPages | undefined;
  onAdd: () => void;
}) {
  return (
    <div className={styles["key-card"]}>
      <div className={styles["key-card__words"]}>
        <strong>Add {providerName ? articled(providerName) : "a"} key</strong>
        <p>
          {routes
            ? "Models, the providers serving them and how those providers have been running are listed once Zhiyin has a key for this account."
            : `${providerName ?? "The provider"}'s models are listed once Zhiyin has a key for this account.`}
          {pages && ` Keys are made on ${hostOf(pages.keys)}.`}
        </p>
      </div>
      <button className="button" type="button" onClick={onAdd}>
        Add a key
      </button>
    </div>
  );
}
