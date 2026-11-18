/**
 * The live feed of the agent operating a browser — one session
 * shared with the user, not a parallel one.
 */

export * from "./interactive-browser.js";

export { playwrightBrowserLauncher } from "./playwright-launcher.js";
export { WorkspaceUploads, type UploadFile } from "./workspace-uploads.js";
export {
  browserAutomation,
  describeBrowserAutomation,
} from "./automation-server.js";
