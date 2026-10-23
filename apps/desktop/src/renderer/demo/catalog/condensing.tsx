import { ConversationTimeline } from "../../ui/conversation/index.js";
import { emptyConversationLists, type TaskCondensing } from "@zhiyin/contract";
import type { ComponentCatalogEntry } from "./entry.js";

const pieces = {
  actions: () => null,
  view: () => null,
  interaction: () => null,
};

const when = "2026-10-02T09:00:00.000Z";

const condensed: TaskCondensing = {
  id: "condensing-done",
  sequence: 4,
  createdAt: when,
  targetTokens: 60_000,
  tokensBefore: 118_400,
  outcome: "condensed",
  revision: 1,
  throughMessageId: "old-assistant",
  tokensAfter: 21_300,
  messages: 18,
  actions: 42,
  summary:
    "## Où on en est\n\nLe rapport trimestriel est rédigé jusqu'à la section 4. Les chiffres du Nord (+12 %) et du Sud (−3 %) ont été vérifiés dans `reports/q3/chiffres-trimestriels-version-finale-corrigee.xlsx`.\n\n- Les clients ont demandé une version courte.\n- Le budget n'est **pas** encore validé.\n\n> « Garde le ton neutre, on l'envoie au conseil lundi. »",
  carried:
    "Dossier de travail : `C:/Users/sam/Documents/Rapports/2026/T3`\n\nDernier message de la personne, mot pour mot : « Garde le ton neutre. »",
  reread: [
    "reports/q3/sommaire.md",
    "C:/Users/sam/Documents/Rapports/2026/T3/chiffres-trimestriels-version-finale-corrigee.xlsx",
  ],
};

const failure = (
  id: string,
  sequence: number,
  reason: "too-large" | "request-failed" | "unusable",
  extra: Partial<TaskCondensing> = {},
): TaskCondensing =>
  ({
    id,
    sequence,
    createdAt: when,
    targetTokens: 60_000,
    tokensBefore: 131_000,
    outcome: "failed",
    reason,
    ...extra,
  }) as TaskCondensing;

const message = (
  id: string,
  role: "user" | "assistant",
  text: string,
  sequence: number,
) => ({
  id,
  role,
  text,
  sequence,
});

export const condensingEntries: ComponentCatalogEntry[] = [
  {
    id: "condensing-running",
    className: "lab-section--thread",
    title: "Compacting now",
    description:
      "The earlier conversation is being summarised, and a message sent meanwhile waits for it: the status says so in place of Working, with its time once it runs long.",
    render: () => (
      <ConversationTimeline
        task={{
          id: "condensing-running",
          ...emptyConversationLists,
          messages: [
            message("run-user", "user", "Rédige le rapport trimestriel.", 0),
            message(
              "run-assistant",
              "assistant",
              "J'ai rédigé les sections 1 à 4.",
              1,
            ),
            message("run-held", "user", "Et maintenant le résumé ?", 2),
          ],
          phase: { kind: "working", steps: [] },
          compacting: true,
        }}
        pieces={pieces}
      />
    ),
  },
  {
    id: "condensing-states",
    className: "lab-section--thread",
    title: "Condensing, every state",
    description:
      "A condensed card closed, then each failure: too large, request failed (with the provider's words), unusable after a refusal. Messages up to the condensed point sit above the first card. Click the first card to read its summary.",
    render: () => (
      <ConversationTimeline
        task={{
          id: "condensing-states",
          ...emptyConversationLists,
          messages: [
            message(
              "old-user",
              "user",
              "Rédige le rapport trimestriel pour le conseil.",
              0,
            ),
            message(
              "old-assistant",
              "assistant",
              "J'ai rédigé les sections 1 à 4.",
              1,
            ),
            message(
              "mid-user",
              "user",
              "Ajoute les chiffres du Nord et du Sud.",
              5,
            ),
            message(
              "mid-assistant",
              "assistant",
              "Fait : Nord +12 %, Sud −3 %.",
              6,
            ),
            message(
              "late-user",
              "user",
              "Et maintenant le résumé pour la direction.",
              8,
            ),
            message("late-assistant", "assistant", "Voici le résumé.", 9),
          ],
          condensings: [
            condensed,
            failure("c-large", 7, "too-large"),
            failure("c-request", 7.5, "request-failed", {
              detail: "503 upstream timeout",
            }),
            failure("c-unusable", 8.5, "unusable", { afterRefusal: true }),
          ],
          condensedThrough: "old-assistant",
          phase: { kind: "draft" },
        }}
        pieces={pieces}
      />
    ),
  },
];
