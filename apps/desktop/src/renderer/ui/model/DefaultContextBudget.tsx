import { useId } from "react";
import {
  contextBudgets,
  contextTarget,
  fixedShare,
  type ContextBudgetChoice,
  type ProviderSettings,
} from "@zhiyin/contract";
import { tokenCount } from "./format.js";
import styles from "./model.module.css";

const names: Record<ContextBudgetChoice, string> = {
  low: "Low",
  medium: "Medium",
  ultra: "Ultra",
};

/**
 * The budget a new conversation starts with, at each budget's target for the
 * model in use. It applies at once and to new conversations only: each
 * conversation keeps its own choice from the composer's ring. When the
 * instructions and tools alone take more than their share of it, this says so
 * here, where the budget and the connectors are chosen, not in the middle of
 * a task.
 */
export function DefaultContextBudget({
  settings,
  budget,
  fixedTokens,
  onChoose,
}: {
  settings: ProviderSettings;
  budget: ContextBudgetChoice;
  /** Instructions and tool definitions, as the last request measured them. */
  fixedTokens?: number;
  onChoose: (budget: ContextBudgetChoice) => void;
}) {
  const name = useId();
  const options = contextBudgets(settings);
  const chosen = contextTarget(budget, settings);
  const tooLarge =
    fixedTokens !== undefined && fixedTokens > chosen.targetTokens * fixedShare;

  return (
    <div className={styles["model-budget"]}>
      <div
        role="radiogroup"
        aria-label="Budget for new conversations"
        className={styles["model-budget__choices"]}
      >
        <span className={styles["model-settings__label"]}>
          New conversations
        </span>
        {options.map((option) => (
          <label key={option.budget}>
            <input
              type="radio"
              name={name}
              checked={option.budget === chosen.budget}
              onChange={() => onChoose(option.budget)}
            />
            {names[option.budget]}{" "}
            <span>{tokenCount(option.targetTokens)}</span>
          </label>
        ))}
      </div>
      <p className={styles["model-budget__caption"]}>
        How much of the conversation is sent word for word before older parts
        are condensed. A larger budget costs more on every request.
      </p>
      {tooLarge && (
        <p className={styles["model-budget__warning"]} role="note">
          Instructions and tools take{" "}
          {Math.round((fixedTokens / chosen.targetTokens) * 100)}% of the{" "}
          {names[chosen.budget]} budget. Turn off connectors you do not need, or
          choose a larger budget.
        </p>
      )}
    </div>
  );
}
