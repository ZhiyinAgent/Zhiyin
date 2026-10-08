import { UserInputPrompt } from "../../ui/user-input/index.js";
import type { ComponentCatalogEntry } from "./entry.js";

export const userInputEntries: ComponentCatalogEntry[] = [
  {
    id: "clarifying-questions",
    title: "Clarifying questions",
    description:
      "One question at a time, with choices, written input, a review of every answer before sending, and no permission styling.",
    render: () => (
      <UserInputPrompt
        prompt={{
          id: "catalog-clarification",
          kind: "clarification",
          title: "Choose the release shape",
          questions: [
            {
              id: "audience",
              prompt: "Who should receive it first?",
              options: [
                {
                  id: "team",
                  label: "Internal team",
                  description: "Try it privately before a wider release.",
                },
                { id: "customers", label: "Customers" },
              ],
              allowText: true,
            },
            {
              id: "date",
              prompt: "What date should the release use?",
              allowText: true,
            },
          ],
        }}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ),
  },
  {
    id: "quiz",
    title: "Interactive quiz",
    description:
      "One question at a time, with immediate explanation, saved review, and an honest retry before the result is sent.",
    render: () => {
      const request = {
        kind: "quiz" as const,
        title: "Release readiness",
        questions: [
          {
            id: "release-steps",
            prompt:
              "Which two steps does the release checklist require before anything is published?",
            answers: [
              { id: "gate", label: "Run the full gate, packaging included" },
              { id: "screens", label: "Refresh the screenshots in the readme" },
              {
                id: "installed",
                label: "Exercise the installed app on a clean machine",
              },
              { id: "announce", label: "Announce the date to the team" },
            ],
            selection: "multiple" as const,
            correctAnswerIds: ["gate", "installed"],
            explanation:
              "Both are required. The full gate proves the build and its installer; the installed app on a clean machine proves the product works outside the development setup.",
          },
          {
            id: "evidence",
            prompt: "Which checks count as product evidence?",
            answers: [
              { id: "unit", label: "Unit tests" },
              { id: "review", label: "Independent review" },
              { id: "installed", label: "Installed-app exercise" },
            ],
            selection: "multiple" as const,
            correctAnswerIds: ["review", "installed"],
            explanation:
              "Independent review and an installed-app exercise test the product beyond its implementation.",
          },
        ],
      };
      return (
        <UserInputPrompt
          prompt={{ id: "catalog-quiz", ...request }}
          onSubmit={() => undefined}
          onCancel={() => undefined}
        />
      );
    },
  },
  {
    id: "work-budget",
    title: "Renewable work checkpoint",
    description:
      "Thirty minutes of work reached: keep going for another stretch, or stop and summarise.",
    render: () => (
      <UserInputPrompt
        prompt={{
          id: "catalog-work-budget",
          kind: "workBudget",
          title: "Keep working on this?",
          completedRounds: 17,
          reached: ["elapsed"],
          elapsedMs: 30 * 60_000 + 12_000,
          costUsd: 2.4,
          allowance: {
            toolRounds: 48,
            elapsedMs: 30 * 60_000,
            providerCostUsd: 10,
          },
        }}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ),
  },
  {
    id: "work-budget-looping",
    title: "Work checkpoint after repeated calls",
    description:
      "The step allowance reached while Zhiyin saw the same call repeat, with no reported cost.",
    render: () => (
      <UserInputPrompt
        prompt={{
          id: "catalog-work-budget-looping",
          kind: "workBudget",
          title: "Keep working on this?",
          completedRounds: 24,
          reached: ["toolRounds"],
          elapsedMs: 7 * 60_000,
          allowance: {
            toolRounds: 48,
            elapsedMs: 30 * 60_000,
            providerCostUsd: 10,
          },
          reason:
            "Zhiyin did the same step 4 times in a row: List the reports folder.",
        }}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ),
  },
  {
    id: "folder-instructions",
    title: "A folder's instructions, before they are used",
    description:
      "A folder's AGENTS.md shown in full, cut at the limit, before any of it reaches the model; the person chooses to use or ignore it.",
    render: () => (
      <UserInputPrompt
        prompt={{
          id: "catalog-folder-instructions",
          kind: "folderInstructions",
          title: "Use this folder's instructions?",
          path: "AGENTS.md",
          text: "# Rapports trimestriels\n\nLes chiffres viennent du tableur partagé `T3/chiffres.xlsx`. Ne jamais arrondir les pourcentages au-delà d'une décimale.\n\n## Ton\n\nNeutre, sans superlatifs. Le conseil lit la version courte en premier.",
          truncated: true,
        }}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ),
  },
];
