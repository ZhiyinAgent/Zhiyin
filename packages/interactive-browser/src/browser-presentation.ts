import type {
  ActionDetail,
  ToolCallInspection,
  ToolInvocationResult,
} from "@zhiyin/contract";
import type { InteractiveBrowser } from "./index.js";

const names: Record<string, string> = {
  browser_navigate: "Open page",
  browser_navigate_back: "Go back",
  browser_click: "Click on page",
  browser_type: "Type on page",
  browser_fill_form: "Fill in form",
  browser_press_key: "Press a key",
  browser_snapshot: "Read page",
  browser_take_screenshot: "Capture page",
  browser_tabs: "Manage browser tabs",
  browser_close: "Close browser",
  browser_evaluate: "Run code on page",
  browser_hover: "Point to an element",
  browser_drag: "Drag an element",
  browser_select_option: "Choose an option",
  browser_wait_for: "Wait for page",
  browser_handle_dialog: "Respond to browser dialog",
  browser_file_upload: "Upload files",
  browser_console_messages: "Read browser console",
  browser_network_requests: "Read page requests",
  browser_resize: "Resize browser",
  browser_preview: "Preview workspace file",
  browser_stop_preview: "Stop workspace preview",
};
const label = (name: string) =>
  name
    .replace(/^browser_/, "")
    .replaceAll("_", " ")
    .replace(/^./, (first) => first.toUpperCase());

/**
 * What each action does, in the terms the decision is made in. Authoritative:
 * true of every call to that tool, whatever the model says it is doing. A
 * browser action's consequence is never the browser — it is the live site at
 * the other end, which sees what is sent and can act on it.
 */
const reading =
  "Reads the page as it stands. What it says then guides the work that follows.";
const acting =
  "Acts on the live site, which can send information or change something under your name.";
/**
 * Arbitrary code against the browser is deliberately absent. The packaged
 * server offers it as `browser_run_code_unsafe`, and code that reaches the
 * browser rather than the page can write files anywhere the browser process
 * can — which is every control this app puts on where a picture goes, undone
 * from inside. What it was actually used for is served by a screenshot of a
 * named element, which is offered.
 */
const consequences: Record<string, string> = {
  browser_navigate:
    "Opens this address in Zhiyin’s browser. The site sees the visit, and what it returns guides the work that follows.",
  browser_navigate_back: reading,
  browser_snapshot: reading,
  browser_take_screenshot: reading,
  browser_console_messages: reading,
  browser_network_requests: reading,
  browser_click: acting,
  browser_type: acting,
  browser_fill_form: acting,
  browser_press_key: acting,
  browser_select_option: acting,
  browser_hover: acting,
  browser_drag: acting,
  browser_handle_dialog: acting,
  browser_file_upload:
    "Sends these files from your computer to the site on the page.",
  browser_evaluate:
    "Runs this code inside the page, with everything the page can reach.",
  browser_close: "Closes Zhiyin’s browser and the page it is showing.",
  browser_tabs: "Changes which pages Zhiyin’s browser has open.",
  browser_resize: "Changes the size of the browser window.",
  browser_wait_for: "Waits for the page to change. Nothing is sent to it.",
  browser_preview:
    "Opens this file in Zhiyin’s browser and serves static files from the selected workspace until the preview or browser is closed.",
  browser_stop_preview: "Stops the local workspace preview.",
};

/**
 * The browser tools this application offers at all.
 *
 * The packaged automation server ships whatever its version happens to ship —
 * eighty tools at the time of writing, including cookie and storage access,
 * network interception, video capture, and arbitrary code execution against
 * the browser. Offering all of them means offering tools nobody here has
 * decided about, behind approvals that can only say the tool's own name back.
 *
 * So the set offered is the set that can be described: a tool belongs here
 * only when someone has written what it does to the live site, in the terms
 * the decision is made in. An upgrade that adds tools adds them invisibly
 * until that sentence exists. This is the same reasoning as the provider
 * allowlist in ADR 0022, applied to a surface that grew the same way.
 */
export const describedBrowserTools: ReadonlySet<string> = new Set(
  Object.keys(consequences),
);

/**
 * Argument names as a person would say them. Anything not named here is a
 * detail of how the page is addressed rather than what is being done, and is
 * left out: nobody consents to `ref: "e42"`, and showing it only buries the
 * inputs they can actually judge.
 */
const inputs: Record<string, string> = {
  url: "Address",
  element: "Element",
  text: "Text",
  submit: "Press Enter",
  key: "Key",
  values: "Choices",
  paths: "Files",
  fields: "Fields",
  function: "Code",
  code: "Code",
  expression: "Code",
  path: "File",
  time: "Seconds to wait",
  filename: "Saved as",
  accept: "Answer",
  promptText: "Reply",
  width: "Width",
  height: "Height",
  action: "Tab action",
  index: "Tab number",
  fullPage: "Whole page",
  type: "Image format",
  startElement: "Dragged from",
  endElement: "Dropped on",
};

const shortened = (value: string, maximum = 200) =>
  value.length > maximum ? `${value.slice(0, maximum)}…` : value;

/** What a person would read, for the kinds of value these tools take. */
function readable(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value.every((item) => typeof item === "string")
      ? (value as string[]).join("\n")
      : JSON.stringify(value, null, 2);
  return typeof value === "object" && value !== null
    ? JSON.stringify(value, null, 2)
    : String(value ?? "");
}

export async function inspectBrowser(
  browser: InteractiveBrowser,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<ToolCallInspection> {
  const action = names[name] ?? label(name);
  const page = browser.state().url;
  /**
   * Where the action lands, and the one part of it that is not the model's
   * word: an address the browser is already on, or the address it is being
   * sent to. An element description is what Zhiyin says it is aiming at, so it
   * travels as an input to read, never as the target itself.
   */
  let target =
    typeof args.url === "string" ? args.url : page || "Zhiyin’s browser";
  let identity: string | undefined;
  if (
    name === "browser_navigate" &&
    typeof args.url === "string" &&
    args.url.startsWith("file:")
  )
    return {
      ok: false,
      correctable: true,
      reason:
        "Use browser_preview with a workspace-relative file path to view local HTML. File URLs are not supported.",
    };
  if (name === "browser_preview") {
    if (
      !browser.preview ||
      typeof args.path !== "string" ||
      Object.keys(args).some((key) => key !== "path")
    )
      return {
        ok: false,
        reason:
          "Choose a workspace and provide the relative path of a file to preview.",
      };
    try {
      const checked = await browser.preview.inspect(args.path);
      target = checked.path;
      identity = JSON.stringify(checked);
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof Error
            ? error.message
            : "This file cannot be previewed.",
      };
    }
  }
  /**
   * The page comes first when the action works on whatever is already open:
   * which site is being clicked or typed into is the question, and the
   * arguments only answer it once the site is known. A navigation carries its
   * own address, so nothing is repeated.
   */
  const onCurrentPage =
    typeof args.url !== "string" && page && name !== "browser_preview";
  return {
    ok: true,
    action,
    target,
    command: `${name}(${JSON.stringify(args, (_key, value: unknown) =>
      typeof value === "string" ? shortened(value) : value,
    )})`,
    ...(identity ? { identity } : {}),
    detail: consequences[name] ?? acting,
    invocation: {
      name: action,
      arguments: [
        ...(onCurrentPage ? [{ name: "Page", value: page }] : []),
        ...Object.entries(args)
          .filter(([key]) => key in inputs)
          .map(([key, value]) => ({
            name: inputs[key] as string,
            value: readable(value),
          })),
      ],
    },
  };
}

export function describeBrowserResult(
  browser: InteractiveBrowser,
  name: string,
  _args: Readonly<Record<string, unknown>>,
  result: ToolInvocationResult,
): readonly ActionDetail[] {
  if (!result.ok)
    return [
      {
        kind: "text",
        label: "Browser error",
        text: result.reason.replace(/^### Error\s*(?:Error:\s*)?/, ""),
      },
    ];
  if (name === "browser_stop_preview")
    return [
      {
        kind: "text",
        label: "Preview",
        text: "Stopped. The local preview server is closed.",
      },
    ];
  const state = browser.state();
  const details: ActionDetail[] = [
    {
      kind: "facts",
      items: [
        {
          label: "Browser",
          value: state.status === "closed" ? "Closed" : "Zhiyin’s browser",
        },
        ...(state.title ? [{ label: "Page", value: state.title }] : []),
        ...(state.url ? [{ label: "Address", value: state.url }] : []),
      ],
    },
  ];
  if (
    result.value &&
    typeof result.value === "object" &&
    "content" in result.value &&
    Array.isArray(result.value.content)
  ) {
    const text = result.value.content
      .filter(
        (item: unknown): item is { type: "text"; text: string } =>
          !!item &&
          typeof item === "object" &&
          "type" in item &&
          item.type === "text" &&
          "text" in item &&
          typeof item.text === "string",
      )
      .map((item) => item.text)
      .join("\n");
    const readable = text
      .replace(/^- Page (?:URL|Title):[^\n]*\n?/gm, "")
      .replace(/### Ran Playwright code\s*```[\s\S]*?```\s*/g, "")
      .replace(/- \[Snapshot\]\([^\n]*\)\s*/g, "")
      .replace(/^### (?:Page|Snapshot)\s*$/gm, "")
      .trim();
    if (readable)
      details.push({
        kind: "text",
        label: "Page result",
        text: readable.slice(0, 16000),
        ...(readable.length > 16000 ? { truncated: true } : {}),
      });
  }
  return details;
}
