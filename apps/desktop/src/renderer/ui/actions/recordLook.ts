import type { DialogLook } from "../shared/index.js";
import common from "./actions.module.css";

/**
 * A record to read, opened from an action: the change it makes, what it did,
 * a specialist's run. Wider than a form, under a lighter scrim, with a header
 * each sets for itself.
 */
export const recordLook: DialogLook = {
  scrim: common["diff-modal__scrim"] ?? "",
  dialog: common["diff-modal"] ?? "",
  header: common["diff-modal__header"] ?? "",
  body: common["diff-modal__body"] ?? "",
  close: "button button--quiet",
};
