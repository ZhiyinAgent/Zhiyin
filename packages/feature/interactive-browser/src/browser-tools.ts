/**
 * The browser tools Zhiyin offers, one record each: what the approval calls
 * it and says it does to the live site, how it touches the page, what it
 * must name in words, and Zhiyin's own description and schema where the
 * packaged server's leave out what the model needs here.
 *
 * The packaged automation server ships many more tools than these, including
 * cookie and storage access, network interception, video capture, and
 * arbitrary code execution against the browser. Offering all of them means
 * offering tools nobody here has decided about, behind approvals that can only
 * say the tool's own name back. So the set offered is the set described here:
 * a tool belongs only when someone has written what it does to the live site,
 * in the terms the decision is made in. A tool an upgrade adds is not offered
 * until that sentence exists. ADR 0018.
 *
 * Arbitrary code against the browser is deliberately absent. The packaged
 * server offers it as `browser_run_code_unsafe`, and code that reaches the
 * browser rather than the page can write files anywhere the browser process
 * can, which undoes from inside every control this app puts on where a
 * picture goes. The need it would serve here, a picture of a named element,
 * is met by the screenshot tool. Managing tabs is absent too: the panel
 * shows one page, and an approval names that page, so the agent never moves
 * to one the person cannot see.
 */

export type BrowserTool = {
  /** What the approval calls the action. */
  readonly title: string;
  /**
   * What it does, in the terms the decision is made in: true of every call
   * to it, whatever the model says it is doing. A browser action's
   * consequence is never the browser: it is the live site at the other end,
   * which sees what is sent and can act on it.
   */
  readonly consequence: string;
  /**
   * How it touches the page: `reads` reads it and sends it nothing, `acts`
   * sends to its site, `window` touches neither the page nor what it says.
   * Opening an address, going back, the preview's own tools and a resize on
   * a blank page decide their effects from their arguments as well.
   */
  readonly touches: "reads" | "acts" | "window";
  /** What it sends always holds words the model wrote. */
  readonly writes?: true;
  /**
   * On the workspace preview it only reads the open page, or changes no more
   * than the window's size, so it is a read inside the workspace (ADR 0018).
   */
  readonly readsPreview?: true;
  /**
   * Each input that aims at an element, with the input that must say in
   * words which element it is. A call without that description is sent back
   * to the model before anyone is asked.
   */
  readonly describes?: readonly (readonly [target: string, element: string])[];
  /** Its aim may be left out, and needs a description only when given. */
  readonly aimsOnlySometimes?: true;
  /** Its whole answer is a picture, offered only to a model that can see one. */
  readonly picture?: true;
  /** Inputs Zhiyin answers for the model, which it never sends. */
  readonly decided?: Readonly<Record<string, unknown>>;
  /** Zhiyin's own description, by whether the model can be shown a picture. */
  readonly description?: (seeing: boolean) => string;
  /** Zhiyin's own schema for its inputs. */
  readonly schema?: Readonly<Record<string, unknown>>;
  /**
   * Zhiyin serves it, not the packaged server, and offers it only with a
   * workspace preview.
   */
  readonly previewTool?: true;
  /** Running it checks the work, as opening the preview does. */
  readonly checksWork?: "runs";
};

/** The most addresses one call may allow. */
export const mostAddresses = 20;

const reading =
  "Reads the page as it stands. What it says then guides the work that follows.";
const acting =
  "Acts on the live site, which can send information or change something under your name.";

const aimed = [["target", "element"]] as const;

export const browserTools: Readonly<Record<string, BrowserTool>> = {
  browser_navigate: {
    title: "Open page",
    consequence:
      "Opens this address in Zhiyin’s browser. The site sees the visit, and what it returns guides the work that follows.",
    touches: "acts",
  },
  browser_navigate_back: {
    title: "Go back",
    consequence: reading,
    touches: "reads",
  },
  browser_click: {
    title: "Click on page",
    consequence: acting,
    touches: "acts",
    describes: aimed,
  },
  browser_type: {
    title: "Type on page",
    consequence: acting,
    touches: "acts",
    writes: true,
    describes: aimed,
  },
  browser_fill_form: {
    title: "Fill in form",
    consequence: acting,
    touches: "acts",
    writes: true,
  },
  browser_press_key: {
    title: "Press a key",
    consequence: acting,
    touches: "acts",
    writes: true,
  },
  browser_snapshot: {
    title: "Read page",
    consequence: reading,
    touches: "reads",
    readsPreview: true,
  },
  browser_take_screenshot: {
    title: "Capture page",
    consequence: reading,
    touches: "reads",
    readsPreview: true,
    picture: true,
    // The page is drawn at the screen's density so the person watching sees
    // it sharp; a picture the model is shown stays at the page's own size,
    // which is all it needs and a quarter of the cost of one at 200%.
    decided: { scale: "css" },
    // Its target is strict, a selector matching several elements fails the
    // call, while it scrolls to the element itself.
    description: () =>
      "Take a picture of the current page. Without a target it shows what the window shows, or the whole page with fullPage. With a target it shows that one element, scrolled into view first, so a section of a long page needs no scrolling code. The target must match exactly one element: for several sections, take one picture of each, or target one element that contains them all. A picture cannot be acted on; use browser_snapshot for actions.",
  },
  browser_close: {
    title: "Close browser",
    consequence: "Closes Zhiyin’s browser and the page it is showing.",
    touches: "window",
    // Closing the browser also gives back the space beside the conversation.
    description: () =>
      "Close Zhiyin's browser and the page it shows, so the space beside the conversation goes back to the conversation or to a document. Close the browser when you no longer need it, but leave open the page your answer rests on. Pages are not kept.",
  },
  browser_evaluate: {
    title: "Run code on page",
    consequence:
      "Runs this code inside the page, with everything the page can reach.",
    touches: "acts",
    writes: true,
    describes: aimed,
    aimsOnlySometimes: true,
  },
  browser_hover: {
    title: "Point to an element",
    consequence: acting,
    touches: "acts",
    describes: aimed,
  },
  browser_drag: {
    title: "Drag an element",
    consequence: acting,
    touches: "acts",
    describes: [
      ["startTarget", "startElement"],
      ["endTarget", "endElement"],
    ],
  },
  browser_select_option: {
    title: "Choose an option",
    consequence: acting,
    touches: "acts",
    describes: aimed,
  },
  browser_wait_for: {
    title: "Wait for page",
    consequence: "Waits for the page to change. Nothing is sent to it.",
    touches: "reads",
  },
  browser_handle_dialog: {
    title: "Respond to browser dialog",
    consequence: acting,
    touches: "acts",
  },
  browser_file_upload: {
    title: "Upload files",
    consequence:
      "Sends these files from your computer to the site on the page.",
    touches: "acts",
    description: () =>
      "Give files from the open folder to the file chooser a click on the page opened. Only files in the open folder can be uploaded. Without paths, the file chooser is cancelled.",
    // An upload names files inside the open folder, never anywhere on the
    // computer.
    schema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description:
            "The files to upload, each by its path inside the open folder, such as reports/q3.csv. Omit to cancel the file chooser.",
        },
      },
      additionalProperties: false,
    },
  },
  browser_console_messages: {
    title: "Read browser console",
    consequence: reading,
    touches: "reads",
    readsPreview: true,
  },
  browser_network_requests: {
    title: "Read page requests",
    consequence: reading,
    touches: "reads",
    readsPreview: true,
  },
  browser_resize: {
    title: "Resize browser",
    consequence: "Changes the size of the browser window.",
    touches: "acts",
    // The sizes it asks for are the model's, and the page can read them.
    writes: true,
    readsPreview: true,
  },
  browser_preview: {
    title: "Preview workspace file",
    consequence:
      "Opens this file in Zhiyin’s browser and serves static files from the selected workspace until the preview or browser is closed.",
    touches: "acts",
    previewTool: true,
    checksWork: "runs",
    description: (seeing) =>
      `Preview a workspace HTML file in the visible browser. Zhiyin manages the local server; do not start one with bash or invent file URLs. To open another page of the workspace, call this again with its path: the preview's address is Zhiyin's, and a localhost address you write does not reach it. The answer gives the viewport and whether the page is wider than it, the console's errors, the page's snapshot${seeing ? " and a picture of what the window shows" : ""}, and names each file the page asked for and was not given. Call it again after changing the file to see the change.`,
    schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative file path, e.g. index.html",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  browser_allow_addresses: {
    title: "Allow addresses for the preview",
    consequence:
      "Lets the workspace preview reach these addresses until Zhiyin’s browser closes. Its pages can send them what they hold, workspace files included.",
    touches: "acts",
    previewTool: true,
    description: () =>
      "Let the workspace preview reach these addresses on the internet, such as a font or a library its page loads. The preview reaches only its own files otherwise. Ask for every address the page needs in one call; each stays allowed until the browser closes.",
    schema: {
      type: "object",
      properties: {
        addresses: {
          type: "array",
          description:
            "Each an origin, a scheme and host with no path, e.g. https://cdn.jsdelivr.net",
          items: { type: "string" },
          minItems: 1,
          maxItems: mostAddresses,
        },
      },
      required: ["addresses"],
      additionalProperties: false,
    },
  },
  browser_stop_preview: {
    title: "Stop workspace preview",
    consequence: "Stops the local workspace preview.",
    touches: "window",
    previewTool: true,
    description: () =>
      "Stop the managed local preview server and confirm that it is closed.",
    schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
};

/** The browser tools this application offers at all. */
export const describedBrowserTools: ReadonlySet<string> = new Set(
  Object.keys(browserTools),
);

/** What an action on the live site is said to do, for a tool not described. */
export const actingConsequence = acting;
