/**
 * A view drawn out of sight, as the conversation will draw it, so the check
 * that accepts it can also say what was drawn and show a picture of it. It is
 * drawn at the width a chart is first laid out at, in the window's theme.
 */

import {
  maximumSavedViewLength,
  type DrawnView,
  type ProducedImage,
  type ViewKind,
} from "@zhiyin/contract";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ChartData } from "./chartData.js";
import { repaintTextForContrast } from "./diagramContrast.js";
import { diagramGround, renderMermaid } from "./mermaidRuntime.js";
import { chartDrawings } from "./TaskViewCard.js";
import { colourScheme } from "./useColourScheme.js";
import { chartFacts, diagramFacts } from "./viewFacts.js";
import { standalone } from "./standaloneSvg.js";
import { pictureOf } from "./viewPicture.js";

/** The width a chart is laid out at before its card is measured. */
const drawingWidth = 720;
/**
 * How long drawing may take. The check that waits on it gives up after ten
 * seconds and then shows nothing, so a view slow to draw is accepted without
 * what was drawn rather than not at all.
 */
const drawingMs = 4_000;

const nextFrame = () =>
  new Promise<void>((resolve) =>
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(() => resolve())
      : setTimeout(resolve, 0),
  );

function offscreen(): HTMLDivElement {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-${drawingWidth * 4}px;top:0;width:${drawingWidth}px;visibility:hidden;pointer-events:none`;
  document.body.append(host);
  return host;
}

async function drawn(
  host: HTMLDivElement,
  facts: (drawing: SVGSVGElement | null) => readonly string[],
  file: boolean,
): Promise<DrawnView> {
  const drawing = host.querySelector("svg");
  const ground = diagramGround(colourScheme()).background;
  const picture: ProducedImage | undefined = drawing
    ? await pictureOf(drawing, ground).catch(() => undefined)
    : undefined;
  // As the person's Save writes it, and only as large as Save would.
  const svg = file && drawing ? standalone(drawing) : undefined;
  return {
    facts: facts(drawing),
    ...(picture ? { picture } : {}),
    ...(svg && svg.length <= maximumSavedViewLength ? { svg } : {}),
  };
}

async function drawChart(data: ChartData, file: boolean): Promise<DrawnView> {
  const host = offscreen();
  const root = createRoot(host);
  try {
    const Chart = chartDrawings[data.kind];
    flushSync(() => root.render(<Chart data={data} />));
    // The chart measures its width once it is in the page, then redraws.
    await nextFrame();
    return await drawn(host, (drawing) => chartFacts(data, drawing), file);
  } finally {
    root.unmount();
    host.remove();
  }
}

async function drawDiagram(
  id: string,
  source: string,
  diagramType: string | undefined,
  file: boolean,
): Promise<DrawnView> {
  const scheme = colourScheme();
  const svg = await renderMermaid(`check-${id}`, source, scheme);
  const host = offscreen();
  try {
    host.innerHTML = svg;
    const drawing = host.querySelector("svg");
    const ground = diagramGround(scheme);
    if (drawing) repaintTextForContrast(drawing, ground.ink, ground.background);
    return await drawn(
      host,
      (element) => diagramFacts(element, diagramType),
      file,
    );
  } finally {
    host.remove();
  }
}

/**
 * What was drawn and a picture of it, or nothing when drawing failed or took
 * longer than `drawingMs`: the view is still accepted, since it was checked.
 */
export async function drawnView(
  request: {
    readonly id: string;
    readonly kind: ViewKind;
    /** The drawing is wanted as a file too. */
    readonly file?: boolean;
  },
  parsed: {
    readonly chart?: ChartData;
    readonly diagramType?: string | undefined;
  },
  source: string,
): Promise<DrawnView | undefined> {
  const drawing =
    request.kind === "diagram"
      ? drawDiagram(
          request.id,
          source,
          parsed.diagramType,
          request.file === true,
        )
      : parsed.chart
        ? drawChart(parsed.chart, request.file === true)
        : Promise.resolve(undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), drawingMs);
  });
  try {
    return await Promise.race([drawing.catch(() => undefined), late]);
  } finally {
    clearTimeout(timer);
  }
}
