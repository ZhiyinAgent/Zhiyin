import type { ProviderCredential, ProviderRegion } from "@zhiyin/contract";
import { ChoiceSwitch, Icon } from "../shared/index.js";
import { hostOf } from "./format.js";
import styles from "./model.module.css";

/**
 * The chosen provider's account, above its models: the platform it is on
 * where the lab runs two, its key, and the platform's billing page. A missing
 * key is asked for below, where the models would be.
 *
 * The balance itself is left to that page: most labs give a key no way to
 * read it, and every provider is shown alike.
 */
export function AccountBar({
  id,
  name,
  regions,
  region,
  credential,
  billingPage,
  onChooseRegion,
  onKey,
  onOpenExternalUrl,
}: {
  id: string;
  name: string;
  /** The lab's platforms; one or none shows no switch. */
  regions: readonly ProviderRegion[];
  region: string | undefined;
  credential: ProviderCredential;
  /** Where the account's balance and spending are seen on its platform. */
  billingPage?: string;
  onChooseRegion: (region: string) => void;
  onKey: () => void;
  onOpenExternalUrl?: (url: string) => Promise<void>;
}) {
  return (
    <div className={styles["account-bar"]}>
      <div className={styles["account-bar__who"]}>
        <h2
          className={`${styles["account-bar__name"]} ${styles["provider-name"]}`}
          data-provider={id}
        >
          {name}
        </h2>
        {regions.length > 1 && (
          <ChoiceSwitch
            aria-label={`${name} platform`}
            choices={regions.map((each) => ({
              value: each.id,
              label: each.name,
            }))}
            value={region}
            onChange={onChooseRegion}
          />
        )}
      </div>
      {credential.status === "configured" && (
        <div className={styles["account-bar__key"]}>
          <span className={styles["account-bar__status"]}>
            <Icon name="lock" />
            {credential.source === "environment"
              ? "Key from the environment"
              : "Key saved"}
          </span>
          <span className={styles["account-bar__actions"]}>
            {billingPage && onOpenExternalUrl && (
              <button
                className="button"
                type="button"
                data-tip={`Opens ${hostOf(billingPage)}`}
                onClick={() => void onOpenExternalUrl(billingPage)}
              >
                Billing
              </button>
            )}
            <button className="button" type="button" onClick={onKey}>
              Change key
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
