import { useId } from "react";
import type { SetupSuggestion } from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./capabilities.module.css";

/** What the person does, one step a line, in Zhiyin's words. */
function stepsOf({ plugin, connector }: SetupSuggestion): readonly string[] {
  const name = connector?.name;
  return [
    ...(plugin.switchedOff ? [`Switch on ${plugin.name}.`] : []),
    ...(name && connector.needs
      ? [
          {
            key: `Add ${name}'s ${connector.setup?.keyName ?? "key"}.`,
            "sign-in": `Sign in to ${name}.`,
            install: `Install what ${name} needs.`,
            "could-not-start": `Check ${name} again.`,
            "switched-off": `Switch ${name} on.`,
          }[connector.needs],
        ]
      : []),
  ];
}

/**
 * A card in the conversation asking the person to set a connector up, or to
 * switch on its plugin, with the one button that opens that plugin's page in
 * Plugins at its connectors. Every word is Zhiyin's, from what the
 * connector's package declares and what Zhiyin found, never the model's.
 */
export function SetupCard({
  suggestion,
  onOpen,
}: {
  suggestion: SetupSuggestion;
  /** Opens a plugin's page in Plugins at its connectors. */
  onOpen: (pluginId: string) => void;
}) {
  const headingId = useId();
  const { plugin, connector } = suggestion;
  const steps = stepsOf(suggestion);
  // How to make a key is said only when a key is what it needs.
  const why =
    (connector?.needs === "key" ? connector.setup?.advice : undefined) ??
    connector?.detail;
  const onlySwitchedOff =
    connector?.needs === "switched-off" && !plugin.switchedOff;
  return (
    <section className={styles["setup-card"]} aria-labelledby={headingId}>
      <header className={styles["setup-card__header"]}>
        <Icon name="plug" />
        <h3 id={headingId}>
          {!connector
            ? `Switch on ${plugin.name}`
            : onlySwitchedOff
              ? `Switch on ${connector.name}`
              : `Set up ${connector.name}`}
        </h3>
      </header>
      <div className={styles["setup-card__body"]}>
        {steps.length > 1 ? (
          <ol className={styles["setup-card__steps"]}>
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className={styles["setup-card__step"]}>{steps[0]}</p>
        )}
        {why && <p className={styles["setup-card__why"]}>{why}</p>}
        <button
          type="button"
          className="button button--small"
          onClick={() => onOpen(plugin.id)}
        >
          Open {plugin.name} in Plugins
        </button>
      </div>
    </section>
  );
}
