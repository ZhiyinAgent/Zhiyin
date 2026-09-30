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
            id: "presidential-powers",
            prompt:
              "Quels pouvoirs le Président exerce-t-il de manière propre, sans contreseing ministériel ?",
            answers: [
              { id: "appoint", label: "Il nomme le Premier ministre" },
              {
                id: "cabinet",
                label: "Il préside le conseil des ministres",
              },
              {
                id: "dissolve",
                label: "Il peut dissoudre l’Assemblée nationale",
              },
              { id: "policy", label: "Il dirige la politique de la nation" },
            ],
            selection: "multiple" as const,
            correctAnswerIds: ["appoint", "dissolve"],
            explanation:
              "La nomination du Premier ministre et la dissolution relèvent des pouvoirs propres énumérés par la Constitution.",
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
      "Thirty minutes of work reached: carry on with the same allowance again, or pause for a summary.",
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
            toolRounds: 24,
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
            toolRounds: 24,
            elapsedMs: 30 * 60_000,
            providerCostUsd: 10,
          },
          reason:
            "The assistant repeated the same list_directory call 4 times.",
        }}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    ),
  },
];
