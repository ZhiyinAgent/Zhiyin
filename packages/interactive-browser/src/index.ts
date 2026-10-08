/**
 * The live, low-frame-rate feed of the agent operating a browser — one session
 * shared with the user, not a parallel one.
 *
 * Boundaries and invariants:
 * docs/architecture/features/interactive-browser/README.md
 */

export * from "./interactive-browser.js";

export { playwrightBrowserLauncher } from "./playwright-launcher.js";
export {
  browserAutomation,
  describeBrowserAutomation,
  type BrowserAutomation,
  type AutomationTool,
} from "./automation-server.js";
