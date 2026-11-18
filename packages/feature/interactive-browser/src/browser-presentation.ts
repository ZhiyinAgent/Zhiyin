import type {
  ActionDetail,
  ToolCallInspection,
  ToolInvocationResult,
} from "@zhiyin/contract";
import { shortened } from "@zhiyin/text-and-names";
import type { InteractiveBrowser } from "./interactive-browser.js";
import { browserAddress } from "./browser-address.js";
import { allowedOrigin } from "./network-gate.js";
import { browserEffects } from "./browser-effects.js";
import { hiddenInputs } from "./browser-inputs.js";
import { actingConsequence, browserTools } from "./browser-tools.js";
import { uploadBinding } from "./workspace-uploads.js";

const label = (name: string) =>
  name
    .replace(/^browser_/, "")
    .replaceAll("_", " ")
    .replace(/^./, (first) => first.toUpperCase());

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
  addresses: "Addresses",
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

/** Inputs that hold code the page runs as written. */
const codeInputs = new Set(["function", "code", "expression"]);

/** An input name the table above does not know, in words: "maxDepth" reads "Max depth". */
function inWords(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A reference into the page's last snapshot, told apart from a selector as the browser server does. */
const snapshotReference = /^(f\d+)?e\d+$/;

const aimedBy = new Set(["target", "startTarget", "endTarget"]);

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
      {
        name: `Field: ${label}`,
        value: readable(field.value),
        readable: true as const,
      },
      ...(typeof target === "string" && !snapshotReference.test(target)
        ? [
            {
              name: `Field: ${label}, by selector`,
              value: target,
              readable: true as const,
            },
          ]
        : []),
    ];
  });
}

/** The inputs a tool must fill to say in words what it acts on. */
export function describingInputs(name: string): readonly string[] {
  return (browserTools[name]?.describes ?? []).map(([, element]) => element);
}

function undescribed(
  name: string,
  args: Readonly<Record<string, unknown>>,
): string | undefined {
  const tool = browserTools[name];
  for (const [target, element] of tool?.describes ?? []) {
    if (tool?.aimsOnlySometimes && args[target] === undefined) continue;
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
  const action = browserTools[name]?.title ?? label(name);
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
  if (name === "browser_allow_addresses") {
    const given = args.addresses;
    const origins = Array.isArray(given)
      ? given.map((one) =>
          typeof one === "string" ? allowedOrigin(one) : undefined,
        )
      : [];
    if (
      !origins.length ||
      origins.some((origin) => !origin) ||
      Object.keys(args).some((key) => key !== "addresses")
    )
      return {
        ok: false,
        correctable: true,
        reason:
          "Give each address as an origin, a scheme and host with no path, such as https://cdn.jsdelivr.net.",
      };
    target = origins.join(", ");
    identity = JSON.stringify(origins);
    shown = { addresses: origins };
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
        identity = uploadBinding(page, files);
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
    typeof args.url !== "string" &&
    page &&
    name !== "browser_preview" &&
    name !== "browser_allow_addresses";
  /**
   * A read of the person's own preview sends nothing new anywhere: its page
   * is a workspace file served on this computer, already open. It is bound to
   * the preview, which the call is inspected again for just before it runs,
   * so a page that has moved to a site since asks as any other. Opening the
   * preview is not one: it runs the page's own code (ADR 0018).
   */
  const previewOrigin =
    browserTools[name]?.readsPreview && page && browser.preview?.serves(page)
      ? new URL(page).origin
      : undefined;
  if (previewOrigin) identity = JSON.stringify({ preview: previewOrigin });
  return {
    ok: true,
    action,
    target,
    command: `${name}(${JSON.stringify(args, (_key, value: unknown) =>
      typeof value === "string" ? shortened(value, 200) : value,
    )})`,
    ...(identity ? { identity } : {}),
    effects: browserEffects(browser, name, args),
    detail: browserTools[name]?.consequence ?? actingConsequence,
    invocation: {
      name: action,
      arguments: [
        ...(onCurrentPage
          ? [{ name: "Page", value: page, readable: true as const }]
          : []),
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
          .map(([key, label]) =>
            codeInputs.has(key)
              ? { name: label, value: String(shown[key]), runs: true as const }
              : {
                  name: label,
                  value: readable(shown[key]),
                  readable: true as const,
                },
          ),
        ...fieldRows(shown),
        ...Object.entries(shown)
          .filter(
            ([key, value]) =>
              value !== undefined &&
              !(key in inputs) &&
              key !== "fields" &&
              !hiddenInputs.has(key),
          )
          .map(([key, value]) => ({
            name: inWords(key),
            value: readable(value),
            readable: true as const,
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
