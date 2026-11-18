import type { PluginComponentState } from "@zhiyin/contract";
import { Dialog, fileSize, Icon } from "../shared/index.js";
import styles from "./capabilities.module.css";

/** A size as a person reads it, said to be about that when it is reckoned. */
function sizeOf(bytes: number, estimated: boolean): string {
  return estimated ? `about ${fileSize(bytes)}` : fileSize(bytes);
}

/**
 * Whether setting a component up replaces what an earlier release installed,
 * which a person is asked to update rather than set up.
 */
export function isUpdate(component: PluginComponentState): boolean {
  const toolchain = component.toolchain;
  return (
    toolchain?.status === "missing" &&
    toolchain.downloads.some((item) => item.update)
  );
}

/** What setting up a component downloads, asked before anything is fetched. */
export function ToolchainInstallDialog({
  component,
  onClose,
  onInstall,
}: {
  component: PluginComponentState;
  onClose: () => void;
  onInstall: () => void;
}) {
  const toolchain = component.toolchain;
  const downloads = toolchain?.status === "missing" ? toolchain.downloads : [];
  const total = downloads.reduce((sum, item) => sum + item.bytes, 0);
  const estimated = downloads.some((item) => item.estimated);
  return (
    <Dialog
      title={`${isUpdate(component) ? "Update" : "Set up"} ${component.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="button" type="button" onClick={onClose}>
            Not now
          </button>
          <button
            className="button button--accent"
            type="button"
            onClick={onInstall}
          >
            Install
          </button>
        </>
      }
    >
      <div className={styles["install-dialog"]}>
        <p className={styles["install-dialog__lead"]}>
          {component.description}
        </p>
        {downloads.length > 0 && (
          <div className={styles["install-manifest"]}>
            <div className={styles["install-manifest__head"]}>
              <span>What gets downloaded</span>
              <span>{sizeOf(total, estimated)}</span>
            </div>
            <ul>
              {downloads.map((item) => (
                <li key={`${item.name} ${item.version}`}>
                  <span className={styles["install-manifest__name"]}>
                    <strong>
                      {item.name} {item.version}
                    </strong>
                    {item.detail && (
                      <small className={styles["install-manifest__detail"]}>
                        {item.detail}
                      </small>
                    )}
                    <small>{item.sources.join(", ")}</small>
                  </span>
                  <span className={styles["install-manifest__size"]}>
                    {sizeOf(item.bytes, item.estimated === true)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className={styles["install-note"]}>
          <Icon name="lock" />
          Every download is checked against its published fingerprint before it
          runs, whichever of these places it comes from.
        </p>
        {component.dataDestination && (
          <p className={styles["install-note"]}>
            <Icon name="globe" />
            {component.dataDestination}
          </p>
        )}
      </div>
    </Dialog>
  );
}
