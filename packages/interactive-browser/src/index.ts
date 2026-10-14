/**
 * The live, low-frame-rate feed of the agent operating a browser — one session
 * shared with the user, not a parallel one.
 */

export * from "./interactive-browser.js";

export { playwrightBrowserLauncher } from "./playwright-launcher.js";
export { WorkspaceUploads, type UploadFile } from "./workspace-uploads.js";
export {
  browserAutomation,
  describeBrowserAutomation,
  type BrowserAutomation,
  type AutomationTool,
} from "./automation-server.js";
