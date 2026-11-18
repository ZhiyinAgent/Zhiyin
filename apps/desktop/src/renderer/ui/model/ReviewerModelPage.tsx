import { useEffect, useRef, useState, type ComponentProps } from "react";
import type {
  ProviderSettings,
  ProviderTarget,
  ReviewerModelChoice,
} from "@zhiyin/contract";
import { ChoiceHeader } from "./ChoiceHeader.js";
import { ModelSettings } from "./ModelSettings.js";
import styles from "./model.module.css";

type PageProps = Omit<
  ComponentProps<typeof ModelSettings>,
  "settings" | "onSelectModel" | "purpose" | "openKeyDialog"
>;

/** The settings with no model in them: the page then opens on the provider alone. */
function withoutModel(settings: ProviderSettings): ProviderSettings {
  const dropped = new Set(["model", "modelName", "providers"]);
  return Object.fromEntries(
    Object.entries(settings).filter(([field]) => !dropped.has(field)),
  ) as ProviderSettings;
}

const targetOf = (settings: ProviderSettings): ProviderTarget | undefined =>
  settings.provider && {
    provider: settings.provider.id,
    ...(settings.provider.region
      ? { region: settings.provider.region.id }
      : {}),
  };

type Read = ProviderSettings | null | "reading" | "failed";

/** Reads what is stored for reviews; only the newest read is shown. */
async function readLatest(
  reads: { current: number },
  read: () => Promise<ProviderSettings | null>,
  show: (read: Read) => void,
): Promise<void> {
  const mine = ++reads.current;
  try {
    const settings = await read();
    if (mine === reads.current) show(settings);
  } catch {
    if (mine === reads.current) show("failed");
  }
}

/**
 * Choosing the model studio work is reviewed on (ADR 0024): the Model page,
 * for reviews. It opens on the model stored for reviews, as its provider
 * reports it, or, while reviews use the conversation's model, on the
 * conversation's provider with no model chosen. Saving stores the choice for
 * reviews alone; the conversation's model stays as it is.
 */
export function ReviewerModelPage({
  conversation,
  onReadReviewer,
  onChooseReviewer,
  onSaveApiKey,
  onClearApiKey,
  onClose,
  ...page
}: PageProps & {
  /** The conversation's settings, which the page opens on while none is stored. */
  conversation: ProviderSettings;
  onReadReviewer: () => Promise<ProviderSettings | null>;
  onChooseReviewer: (choice: ReviewerModelChoice) => Promise<void>;
}) {
  const [read, setRead] = useState<Read>("reading");
  const reader = useRef(onReadReviewer);
  const reads = useRef(0);
  useEffect(() => {
    reader.current = onReadReviewer;
  });
  // Read once on opening; a save or a key change reads again.
  useEffect(() => {
    void readLatest(reads, () => reader.current(), setRead);
  }, []);
  const reread = () => readLatest(reads, onReadReviewer, setRead);

  if (read === "reading" || read === "failed")
    return (
      <section className={styles["model-settings"]} aria-label="Reviewer model">
        <ChoiceHeader
          title="Reviewer model"
          trail="Zhiyin / Settings / Reviewer model"
          onClose={onClose}
        />
        {read === "reading" ? (
          <p className={styles["model-settings__current"]} role="status">
            Reading the model chosen for reviews…
          </p>
        ) : (
          <p className={styles["model-settings__current"]} role="alert">
            The model chosen for reviews could not be read.
            <button
              type="button"
              className="button"
              onClick={() => {
                setRead("reading");
                void reread();
              }}
            >
              Try again
            </button>
          </p>
        )}
      </section>
    );

  const settings = read ?? withoutModel(conversation);
  const stored = targetOf(settings);
  return (
    <ModelSettings
      // A saved choice is the page's new start: its draft begins again there.
      key={JSON.stringify([stored, read?.model, read?.providers])}
      {...page}
      purpose="reviews"
      settings={settings}
      onClose={onClose}
      onSelectModel={async (model, providers, target) => {
        const at = target ?? stored;
        if (!at) throw new Error("Choose a provider first.");
        await onChooseReviewer({
          ...at,
          model,
          providers: [...providers],
        });
        await reread();
      }}
      onSaveApiKey={async (apiKey, target) => {
        const outcome = await onSaveApiKey(apiKey, target);
        await reread();
        return outcome;
      }}
      onClearApiKey={async (target) => {
        await onClearApiKey(target);
        await reread();
      }}
    />
  );
}
