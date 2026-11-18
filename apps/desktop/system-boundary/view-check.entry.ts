/**
 * The page the view-check test drives: the window's own check of a view, with
 * the application's stylesheets, as the core asks it.
 */

import "../src/renderer/styles.css";
import { validateView } from "../src/renderer/ui/views/index.js";

(window as unknown as { validateView: typeof validateView }).validateView =
  validateView;
