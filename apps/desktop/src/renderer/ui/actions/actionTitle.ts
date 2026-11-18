import type { TaskAction } from "@zhiyin/contract";
import { visibleText } from "../shared/index.js";

/**
 * An action's title as drawn, with any character that draws nothing or turns
 * text around written as its code: a model may have written it.
 */
export function actionTitle(action: TaskAction): string {
  return visibleText(action.action);
}
