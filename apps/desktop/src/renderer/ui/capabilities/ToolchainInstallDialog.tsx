import type { PluginComponentState } from "@zhiyin/contract";
import { Dialog, Icon } from "../shared/index.js";
import styles from "./capabilities.module.css";

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${Math.round(bytes / 1_000_000)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;
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
  return (
    <Dialog
      title={`Set up ${component.name}`}
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
              <span>{formatBytes(total)}</span>
            </div>
            <ul>
              {downloads.map((item) => (
                <li key={`${item.name} ${item.version}`}>
                  <span className={styles["install-manifest__name"]}>
                    <strong>
                      {item.name} {item.version}
                    </strong>
                    <small>{item.source}</small>
                  </span>
                  <span className={styles["install-manifest__size"]}>
                    {formatBytes(item.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className={styles["install-note"]}>
          <Icon name="lock" />
          Every download is checked against its published fingerprint before it
          runs.
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
