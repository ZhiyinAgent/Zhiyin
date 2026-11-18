import { useEffect, useRef, useState } from "react";
import type { ProviderSettings, ReviewerModelChoice } from "@zhiyin/contract";

/** The model and where it is reached: "DeepSeek Reasoner on DeepSeek · Mainland China". */
function reviewerLabelOf(
  settings: ProviderSettings,
  choice: ReviewerModelChoice,
): string {
  const model = settings.modelName ?? settings.model ?? choice.model;
  const provider = settings.provider;
  if (!provider) return model;
  return `${model} on ${provider.name}${provider.region ? ` · ${provider.region.name}` : ""}`;
}

/**
 * How the model chosen for reviews is named: its id at once, then its name
 * and provider once its provider answers. Nothing while reviews use the
 * conversation's model.
 */
export function useReviewerLabel(
  choice: ReviewerModelChoice | undefined,
  read: (() => Promise<ProviderSettings | null>) | undefined,
): string | undefined {
  const [named, setNamed] = useState<{
    readonly key: string;
    readonly label: string;
  }>();
  const reader = useRef(read);
  useEffect(() => {
    reader.current = read;
  });
  const key = choice ? JSON.stringify(choice) : "";
  const chosen = useRef(choice);
  useEffect(() => {
    chosen.current = choice;
  });
  useEffect(() => {
    const now = chosen.current;
    if (!key || !now) return;
    let live = true;
    reader
      .current?.()
      .then((settings) => {
        if (live && settings)
          setNamed({ key, label: reviewerLabelOf(settings, now) });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key]);
  if (!choice) return undefined;
  return named?.key === key ? named.label : choice.model;
}
