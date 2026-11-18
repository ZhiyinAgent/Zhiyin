import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Puts a dialog over the whole window. Left where it was opened, inside the
 * conversation, it would be clipped by the conversation's fade and drawn
 * under the browser, document or 3D view beside it.
 */
export function WindowLayer({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
