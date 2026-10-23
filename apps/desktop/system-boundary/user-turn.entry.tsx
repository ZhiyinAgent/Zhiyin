/**
 * The page the user-turn test drives: the production bubble a person's message
 * is drawn in, with the application's stylesheets.
 */

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../src/renderer/styles.css";
import { UserTurn } from "../src/renderer/ui/conversation/ConversationTimeline.js";

export type UserTurnPage = {
  /** How tall the bubble is with this message in it, in pixels. */
  heightOf(text: string): number;
};

const stage = document.getElementById("stage")!;
stage.style.display = "flex";
stage.style.flexDirection = "column";
stage.style.width = "760px";
const root = createRoot(stage);

const page: UserTurnPage = {
  heightOf(text) {
    flushSync(() => root.render(<UserTurn text={text} />));
    return stage.firstElementChild!.getBoundingClientRect().height;
  },
};

(window as unknown as { userTurn: UserTurnPage }).userTurn = page;
