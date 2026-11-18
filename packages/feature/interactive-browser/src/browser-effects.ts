import type { ActionEffects } from "@zhiyin/contract";
import type { InteractiveBrowser } from "./interactive-browser.js";
import { browserAddress } from "./browser-address.js";
import { browserTools } from "./browser-tools.js";

const nothing: ActionEffects = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
};

/** The site a page is on, by its origin, when it has one. */
function siteOf(page: string): string | undefined {
  try {
    const origin = new URL(page).origin;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}

/**
 * Whether what an action on the page sends holds anything the model wrote:
 * text typed, a key pressed, words answered to a dialog, code run, or files
 * uploaded. A click, a hover, a choice from the page's own list or a drag
 * sends what the page decides, and nothing of the model's.
 */
function carriesWords(
  name: string,
  args: Readonly<Record<string, unknown>>,
  uploads: boolean,
): boolean {
  if (browserTools[name]?.writes || uploads) return true;
  if (name === "browser_handle_dialog")
    return typeof args.promptText === "string" && args.promptText !== "";
  return false;
}

/**
 * What a browser call does, for this call's arguments and the page open now.
 *
 * Anything a website returns was written by someone else, so a call on a
 * website brings outside content; the workspace preview serves the
 * conversation's own files, so a call on it reads the workspace instead. What
 * an action carries, its text, code or files, goes to the site the page is on,
 * so it is sent to a destination the model chose. Code a page runs, its own or
 * the model's, runs in the browser's page, never with the person's access.
 *
 * A browser that holds the preview (ADR 0018) lets its page reach only the
 * preview and the addresses allowed for it. There, a call sends nothing off
 * this computer while nothing is allowed; once something is, what the
 * preview's code and the model's words hold may go to those addresses.
 */
export function browserEffects(
  browser: InteractiveBrowser,
  name: string,
  args: Readonly<Record<string, unknown>>,
): ActionEffects {
  const page = browser.state().url;
  const onPreview = Boolean(page && browser.preview?.serves(page));
  const network = browser.previewNetwork();
  /** Whether the preview's page, held, can send nowhere at all. */
  const shut = network !== undefined && !network.allowed.length;
  const fromPage = onPreview
    ? ({ reads: "workspace", brings: "none" } as const)
    : ({ reads: "none", brings: "outside" } as const);

  const touches = browserTools[name]?.touches;
  if (touches === "window") return nothing;
  // With no page, or a blank one, no site and no page's code reads the size.
  if (name === "browser_resize" && (page === "" || page === "about:blank"))
    return nothing;
  if (name === "browser_preview")
    return shut
      ? { ...nothing, reads: "workspace" }
      : { ...nothing, reads: "workspace", sends: "chosen" };
  // What the preview's pages hold, workspace files among it, may go to each
  // address the model names.
  if (name === "browser_allow_addresses")
    return { ...nothing, reads: "workspace", sends: "chosen" };
  if (name === "browser_navigate") {
    const address =
      typeof args.url === "string" ? browserAddress(args.url) : undefined;
    if (!address?.ok) return { ...nothing, sends: "chosen", brings: "outside" };
    if (address.url === "about:blank") return nothing;
    const preview = browser.preview?.serves(address.url) === true;
    if (preview && shut) return { ...nothing, reads: "workspace" };
    return {
      ...nothing,
      reads: preview ? "workspace" : "none",
      sends: "chosen",
      destination: address.url,
      // Opening a page sends its address and nothing else.
      carries: "address",
      brings: preview ? "none" : "outside",
    };
  }
  // The page it returns to is not known here, so it may be any site visited.
  if (name === "browser_navigate_back")
    return { ...nothing, brings: "outside" };
  if (touches === "reads") return { ...nothing, ...fromPage };
  if (onPreview && shut && network.sealed)
    return {
      ...nothing,
      reads: "workspace",
      ...(name === "browser_evaluate" ? { runs: "sealed" as const } : {}),
    };

  const destination = siteOf(page);
  const uploads =
    name === "browser_file_upload" &&
    Array.isArray(args.paths) &&
    args.paths.length > 0;
  return {
    ...nothing,
    ...fromPage,
    ...(uploads ? { reads: "workspace" as const } : {}),
    sends: "chosen",
    // Code the model wrote runs in the page, sealed off in the browser, and
    // what it answers is the model's own as much as the site's.
    ...(name === "browser_evaluate" ? { runs: "sealed" as const } : {}),
    ...(destination ? { destination } : {}),
    ...(carriesWords(name, args, uploads)
      ? {}
      : { carries: "nothing" as const }),
  };
}
