/**
 * What opening the preview answers of the page, so the model can judge what
 * it made without another call: the viewport and whether the page is wider
 * than it, the console's errors since the page opened, the page's
 * accessibility snapshot, and, for a model that can see, a picture of what
 * the window shows. Each is read through the automation server's own tools,
 * so the snapshot's references are the ones the next action uses.
 */

type Content = { readonly type: string; readonly text?: string };
type Answer = {
  readonly content?: unknown;
  readonly isError?: boolean | undefined;
};

/** Calls one of the automation server's tools on the open page. */
type PageTool = (
  name: string,
  args: Readonly<Record<string, unknown>>,
) => Promise<Answer>;

/** The most of the page's snapshot one answer holds. */
const mostSnapshotCharacters = 20_000;
/** The most of the console's errors one answer holds. */
const mostConsoleCharacters = 4_000;

/** The most boxes that scroll sideways one answer names. */
const mostScrollers = 3;

/**
 * Run in the page: the viewport, the width the page has to fill, how wide the
 * page is, and, when the viewport scrolls sideways to show more, the element
 * that reaches furthest right without an ancestor clipping it, the outermost
 * of those that reach as far. A viewport whose overflow, set on the root or
 * passed to it from the body, hides or clips what is past its width shows a
 * page that fits. Each box at least half the viewport wide and half as tall
 * that scrolls sideways is named too, with how wide its content is: smaller
 * ones, such as code blocks, scroll by design.
 */
const measuring = `() => {
  const root = document.documentElement;
  const body = document.body;
  const room = root.clientWidth;
  const measured = { width: window.innerWidth, height: window.innerHeight, room };
  const name = (element) => {
    const id = element.id ? "#" + element.id : "";
    const classes = [...element.classList].slice(0, 2).map((each) => "." + each).join("");
    return element.localName + id + classes;
  };
  const rootOverflow = getComputedStyle(root).overflowX;
  // The body's overflow is the viewport's when the root's is visible.
  const bodyPasses = rootOverflow === "visible" && body && body.localName === "body";
  const viewportOverflow = bodyPasses ? getComputedStyle(body).overflowX : rootOverflow;
  const scrollsSideways = (overflow) => overflow !== "hidden" && overflow !== "clip";
  const scrollers = [];
  for (const element of document.querySelectorAll("body, body *")) {
    if (scrollers.length === ${mostScrollers}) break;
    if (element === body && bodyPasses) continue;
    const overflow = getComputedStyle(element).overflowX;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    if (element.clientWidth < innerWidth / 2 || element.clientHeight < innerHeight / 2) continue;
    if (element.scrollWidth > element.clientWidth)
      scrollers.push({ name: name(element), width: element.clientWidth, contentWidth: element.scrollWidth });
  }
  if (scrollers.length) measured.scrollers = scrollers;
  const pageWidth = scrollsSideways(viewportOverflow)
    ? Math.max(root.scrollWidth, body ? body.scrollWidth : 0)
    : room;
  measured.pageWidth = pageWidth;
  if (pageWidth <= room) return measured;
  const clipped = (element) => {
    for (let at = element.parentElement; at && at !== root; at = at.parentElement)
      if (!(at === body && bodyPasses) && getComputedStyle(at).overflowX !== "visible") return true;
    return false;
  };
  let widest;
  let right = room;
  for (const element of document.querySelectorAll("body *")) {
    const reach = Math.round(element.getBoundingClientRect().right + window.scrollX);
    if (reach > right && !clipped(element)) {
      widest = element;
      right = reach;
    }
  }
  if (!widest) return measured;
  return { ...measured, widest: { name: name(widest), right } };
}`;

type Measured = {
  readonly width: number;
  readonly height: number;
  readonly room: number;
  readonly pageWidth: number;
  readonly widest?: { readonly name: string; readonly right: number };
  readonly scrollers?: readonly {
    readonly name: string;
    readonly width: number;
    readonly contentWidth: number;
  }[];
};

const parts = (answer: Answer): readonly Content[] =>
  Array.isArray(answer.content) ? (answer.content as Content[]) : [];

const wordsOf = (answer: Answer): string =>
  parts(answer)
    .map((part) => part.text ?? "")
    .join("\n");

/** One `### Title` section of an answer, without its heading. */
function section(text: string, title: string): string | undefined {
  const start = text.indexOf(`### ${title}\n`);
  if (start === -1) return undefined;
  const from = start + title.length + 5;
  const end = text.indexOf("\n### ", from);
  return text.slice(from, end === -1 ? undefined : end).trim();
}

/** Why a call failed: its own error, or what was thrown. */
function failure(answer: Answer | Error): string | undefined {
  if (answer instanceof Error) return answer.message;
  const text = wordsOf(answer);
  const error = section(text, "Error");
  if (!answer.isError && error === undefined) return undefined;
  return (error ?? text).trim() || "no reason was given";
}

async function called(
  tool: PageTool,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<Answer | Error> {
  try {
    return await tool(name, args);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

const number = (value: number) => value.toLocaleString("en-US");

/** Text cut at the last whole line within `most` characters, said so. */
function bounded(
  text: string,
  most: number,
  stop: (total: string) => string,
): string {
  if (text.length <= most) return text;
  const cut = text.lastIndexOf("\n", most);
  const kept = text.slice(0, cut > 0 ? cut : most);
  // A cut inside a code block closes it, so what follows is not read as code.
  const open = (kept.match(/^```/gm) ?? []).length % 2 === 1;
  return `${kept}${open ? "\n```" : ""}\n${stop(number(text.length))}`;
}

function viewportLine(answer: Answer | Error): string {
  const failed = failure(answer);
  if (failed) return `The viewport could not be measured: ${failed}`;
  let measured: Measured | undefined;
  try {
    measured = JSON.parse(
      section(wordsOf(answer as Answer), "Result") ?? "",
    ) as Measured;
  } catch {
    measured = undefined;
  }
  if (
    !measured ||
    ![measured.width, measured.height, measured.room, measured.pageWidth].every(
      Number.isFinite,
    )
  )
    return "The viewport could not be measured.";
  const bar = measured.width - measured.room;
  const viewport = `Viewport ${measured.width} × ${measured.height} px${
    bar > 0 ? `, of which the vertical scroll bar takes ${bar} px.` : "."
  }`;
  const scrollers = (measured.scrollers ?? []).map(
    (box) =>
      ` ${box.name} scrolls sideways: its content is ${box.contentWidth} px wide in a box ${box.width} px wide.`,
  );
  if (measured.pageWidth <= measured.room)
    return `${viewport} The page fits its width.${scrollers.join("")}`;
  const over = measured.pageWidth - measured.room;
  return `${viewport} The page is ${measured.pageWidth} px wide, ${over} px wider than ${
    bar > 0 ? `the ${measured.room} px left` : "the viewport"
  }${
    measured.widest
      ? `: ${measured.widest.name} reaches ${measured.widest.right} px.`
      : "."
  }${scrollers.join("")}`;
}

function consoleLines(answer: Answer | Error): string {
  const failed = failure(answer);
  if (failed) return `The console could not be read: ${failed}`;
  const result = section(wordsOf(answer as Answer), "Result") ?? "";
  const blank = result.indexOf("\n\n");
  const header = blank === -1 ? result : result.slice(0, blank);
  const messages = blank === -1 ? "" : result.slice(blank + 2).trim();
  const counted =
    /Returning (\d+) messages/.exec(header)?.[1] ??
    /Total messages: (\d+)/.exec(header)?.[1];
  const listed = () =>
    bounded(
      messages,
      mostConsoleCharacters,
      (total) =>
        `The console's errors stop here, at ${number(mostConsoleCharacters)} of ${total} characters: browser_console_messages gives them all.`,
    );
  // A count in words this does not read is unknown, never none.
  if (counted === undefined)
    return [
      "How many console errors there were since the page opened is not known: browser_console_messages lists them.",
      ...(messages ? [listed()] : []),
    ].join("\n");
  const count = Number(counted);
  if (!messages || count === 0)
    return "No console errors since the page opened.";
  return `${count} console ${count === 1 ? "error" : "errors"} since the page opened:\n${listed()}`;
}

function snapshotText(answer: Answer | Error): string {
  const failed = failure(answer);
  if (failed) return `The page's snapshot could not be read: ${failed}`;
  const text = wordsOf(answer as Answer).trim();
  // The snapshot's page header counts the console's messages its own way,
  // leaving out some the console part above counts as errors: one answer
  // gives one count.
  const header = text.indexOf("### Snapshot\n");
  const counted =
    header === -1
      ? text
      : text.slice(0, header).replace(/^- Console: .*\n/m, "") +
        text.slice(header);
  return bounded(
    counted,
    mostSnapshotCharacters,
    (total) =>
      `The snapshot stops here, at ${number(mostSnapshotCharacters)} of ${total} characters: browser_snapshot gives the whole page.`,
  );
}

/** The page as it is now, read for the answer that opened it. */
export async function pageState(
  tool: PageTool,
  seeing: boolean,
): Promise<readonly Content[]> {
  const errors = await called(tool, "browser_console_messages", {
    level: "error",
  });
  const measured = await called(tool, "browser_evaluate", {
    function: measuring,
  });
  const snapshot = await called(tool, "browser_snapshot", {});
  const picture = seeing
    ? await called(tool, "browser_take_screenshot", {})
    : undefined;
  const pictured =
    picture === undefined
      ? []
      : failure(picture)
        ? [
            {
              type: "text",
              text: `The page could not be pictured: ${failure(picture)}`,
            },
          ]
        : parts(picture as Answer).filter((part) => part.type === "image");
  return [
    {
      type: "text",
      text: [
        viewportLine(measured),
        consoleLines(errors),
        snapshotText(snapshot),
      ].join("\n"),
    },
    ...pictured,
  ];
}
