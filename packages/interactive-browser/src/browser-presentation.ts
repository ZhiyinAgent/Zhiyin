import type {
  ActionDetail,
  ToolCallInspection,
  ToolInvocationResult,
} from "@zhiyin/contract";
import type { InteractiveBrowser } from "./interactive-browser.js";
import { browserAddress } from "./browser-address.js";
import { hiddenInputs } from "./browser-inputs.js";

const names: Record<string, string> = {
  browser_navigate: "Open page",
  browser_navigate_back: "Go back",
  browser_click: "Click on page",
  browser_type: "Type on page",
  browser_fill_form: "Fill in form",
  browser_press_key: "Press a key",
  browser_snapshot: "Read page",
  browser_take_screenshot: "Capture page",
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
 * from inside. The need it would serve here, a screenshot of a named element,
 * is met by the screenshot tool, which is offered.
 *
 * Managing tabs is absent too: the panel shows one page, and an approval
 * names that page, so the agent never moves to one the person cannot see.
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
  browser_resize: "Changes the size of the browser window.",
  browser_wait_for: "Waits for the page to change. Nothing is sent to it.",
  browser_preview:
    "Opens this file in Zhiyin’s browser and serves static files from the selected workspace until the preview or browser is closed.",
  browser_stop_preview: "Stops the local workspace preview.",
};

/**
 * The browser tools this application offers at all.
 *
 * The packaged automation server ships many more tools than these, including
 * cookie and storage access, network interception, video capture, and
 * arbitrary code execution against the browser. Offering all of them means
 * offering tools nobody here has decided about, behind approvals that can only
 * say the tool's own name back.
 *
 * So the set offered is the set that can be described: a tool belongs here
 * only when someone has written what it does to the live site, in the terms
 * the decision is made in. A tool an upgrade adds is not offered until that
 * sentence exists. ADR 0022.
 */
export const describedBrowserTools: ReadonlySet<string> = new Set(
  Object.keys(consequences),
);

/**
 * Argument names as a person would say them, in the order they are shown.
 * Any other input the browser receives follows, under its own name. A target
 * is shown when it is a
 * selector, which says what it picks in its own words; a reference into the
 * page's last snapshot, such as `e42`, says nothing to a person and is left
 * out, so the element's description has to say what it is.
 */
const inputs: Record<string, string> = {
  url: "Address",
  element: "Element",
  target: "Selector",
  text: "Text",
  textGone: "Wait until gone",
  submit: "Press Enter",
  slowly: "One key at a time",
  doubleClick: "Double click",
  button: "Mouse button",
  modifiers: "Keys held",
  key: "Key",
  values: "Choices",
  paths: "Files",
  function: "Code",
  code: "Code",
  expression: "Code",
  path: "File",
  time: "Seconds to wait",
  accept: "Answer",
  promptText: "Reply",
  width: "Width",
  height: "Height",
  fullPage: "Whole page",
  type: "Image format",
  startElement: "Dragged from",
  startTarget: "Dragged from, by selector",
  endElement: "Dropped on",
  endTarget: "Dropped on, by selector",
};

/** A reference into the page's last snapshot, told apart from a selector as the browser server does. */
const snapshotReference = /^(f\d+)?e\d+$/;

const aimedBy = new Set(["target", "startTarget", "endTarget"]);

/**
 * The tools that act on an element, each target with the description that
 * must name it. Only the description says, in words, what is acted on; a
 * call without one is sent back to the model before anyone is asked. Code
 * run on the page needs one only when it is given an element.
 */
const describedTargets: Record<string, readonly (readonly [string, string])[]> =
  {
    browser_click: [["target", "element"]],
    browser_type: [["target", "element"]],
    browser_hover: [["target", "element"]],
    browser_select_option: [["target", "element"]],
    browser_drag: [
      ["startTarget", "startElement"],
      ["endTarget", "endElement"],
    ],
    browser_evaluate: [["target", "element"]],
  };

/** Tools whose target may be left out, and need a description only with one. */
const aimedOnlySometimes = new Set(["browser_evaluate"]);

type FormField = Readonly<Record<string, unknown>>;

const fieldsOf = (args: Readonly<Record<string, unknown>>): FormField[] =>
  Array.isArray(args.fields)
    ? args.fields.filter(
        (field): field is FormField =>
          typeof field === "object" && field !== null,
      )
    : [];

const said = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** A form field as a person names it: its description, or its name. */
const fieldLabel = (field: FormField): string | undefined =>
  said(field.element) ?? said(field.name);

/** Each field a form fill writes: what it is called, what goes in, and the selector it is found by. */
function fieldRows(args: Readonly<Record<string, unknown>>) {
  return fieldsOf(args).flatMap((field) => {
    const label = fieldLabel(field) ?? "";
    const target = field.target;
    return [
      { name: `Field: ${label}`, value: readable(field.value) },
      ...(typeof target === "string" && !snapshotReference.test(target)
        ? [{ name: `Field: ${label}, by selector`, value: target }]
        : []),
    ];
  });
}

/** The inputs a tool must fill to say in words what it acts on. */
export function describingInputs(name: string): readonly string[] {
  return (describedTargets[name] ?? []).map(([, element]) => element);
}

function undescribed(
  name: string,
  args: Readonly<Record<string, unknown>>,
): string | undefined {
  for (const [target, element] of describedTargets[name] ?? []) {
    if (aimedOnlySometimes.has(name) && args[target] === undefined) continue;
    if (!said(args[element]))
      return `Say in ${element} what ${target} is, in words a person reads, such as “the Delete account button”. It is shown to the person asked to approve this.`;
  }
  if (
    name === "browser_fill_form" &&
    fieldsOf(args).some((field) => !fieldLabel(field))
  )
    return "Name each field in words a person reads, in its name or element, such as “Email address”. It is shown to the person asked to approve this.";
  return undefined;
}

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
  let shown = args;
  const unnamed = undescribed(name, args);
  if (unnamed) return { ok: false, correctable: true, reason: unnamed };
  if (name === "browser_navigate" && typeof args.url === "string") {
    const address = browserAddress(args.url);
    if (!address.ok)
      return { ok: false, correctable: true, reason: address.reason };
  }
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
  // Without paths, the file chooser is cancelled and nothing is sent.
  if (name === "browser_file_upload" && args.paths !== undefined) {
    const paths = args.paths;
    if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string"))
      return {
        ok: false,
        correctable: true,
        reason:
          "Name the files to upload by their paths inside the open folder.",
      };
    if (paths.length) {
      if (!browser.uploads)
        return {
          ok: false,
          reason: "Choose a folder first: only its files can be uploaded.",
        };
      try {
        const files = await browser.uploads.inspect(paths as string[]);
        identity = JSON.stringify(files);
        shown = { ...args, paths: files.map((file) => file.path) };
      } catch (error) {
        return {
          ok: false,
          correctable: true,
          reason:
            error instanceof Error
              ? error.message
              : "These files cannot be uploaded.",
        };
      }
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
        ...Object.entries(inputs)
          .filter(
            ([key]) =>
              shown[key] !== undefined &&
              !(
                aimedBy.has(key) &&
                typeof shown[key] === "string" &&
                snapshotReference.test(shown[key])
              ),
          )
          .map(([key, label]) => ({
            name: label,
            value: readable(shown[key]),
          })),
        ...fieldRows(shown),
        ...Object.entries(shown)
          .filter(
            ([key, value]) =>
              value !== undefined &&
              !(key in inputs) &&
              key !== "fields" &&
              !hiddenInputs.has(key),
          )
          .map(([key, value]) => ({ name: key, value: readable(value) })),
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
