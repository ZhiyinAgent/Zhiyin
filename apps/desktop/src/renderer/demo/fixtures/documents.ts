/**
 * Documents for the lab and the demo, drawn once by the real drawing service
 * (pdf.js and the canvas, as the app draws them) and kept as PNGs, so the
 * panel shows pages as they actually look rather than grey rectangles.
 */

import type {
  DocumentPageDrawing,
  DocumentPanelState,
  DocumentPlace,
} from "@zhiyin/contract";
import chart from "./sample-chart.png?inline";
import firstPage from "./sample-page-1.png?inline";
import secondPage from "./sample-page-2.png?inline";
// A two-second turntable Blender encoded, as the 3D studio's videos are.
import turntable from "./sample-turntable.mp4?url";

type Opened = Exclude<DocumentPanelState, { status: "closed" }>;
type Shown = Extract<
  DocumentPanelState,
  { status: "shown"; kind: "pdf" | "picture" }
>;

export const reportPlace: DocumentPlace = {
  path: "reports/q3-report.pdf",
  name: "q3-report.pdf",
  folder: "reports",
};
export const chartPlace: DocumentPlace = {
  path: "reports/revenue-chart.png",
  name: "revenue-chart.png",
  folder: "reports",
};
const documents = [reportPlace, chartPlace];

/** A US Letter page at 100%, in CSS pixels. */
const letter = { width: 816, height: 1056 };

export const shownReport: Shown = {
  ...reportPlace,
  status: "shown",
  documents,
  revision: "demo-report-1",
  kind: "pdf",
  pages: [letter, letter],
  openable: true,
};

export const shownChart: Shown = {
  ...chartPlace,
  status: "shown",
  documents,
  revision: "demo-chart-1",
  kind: "picture",
  pages: [{ width: 520, height: 260 }],
  openable: true,
};

export const openingReport: Opened = {
  ...reportPlace,
  status: "opening",
  documents,
};

/** Each way a document can fail to be drawn, as the core words it. */
export const failedDocuments: readonly Opened[] = [
  {
    ...reportPlace,
    name: "archive-scans.pdf",
    path: "reports/archive-scans.pdf",
    status: "failed",
    documents,
    reason:
      "archive-scans.pdf is 240.0 MB, larger than the 100 MB this panel draws. Open it in its own app or save a copy instead.",
    openable: true,
  },
  {
    ...reportPlace,
    name: "invoice.pdf",
    path: "reports/invoice.pdf",
    status: "failed",
    documents,
    reason: "invoice.pdf could not be opened. It may be damaged.",
    openable: true,
  },
  {
    ...reportPlace,
    name: "contract.pdf",
    path: "reports/contract.pdf",
    status: "failed",
    documents,
    reason:
      "contract.pdf is protected by a password, so its pages cannot be shown.",
    openable: true,
  },
  {
    ...reportPlace,
    name: "logo.svg",
    path: "reports/logo.svg",
    status: "failed",
    documents,
    reason: "logo.svg is an SVG picture, which this panel cannot draw yet.",
    openable: false,
  },
];

export const closedDocument: DocumentPanelState = {
  status: "closed",
  documents,
};

/** Shows a document of the demo's, as the core would after a write. */
export function demoDocument(path: string): Opened | undefined {
  return path === chartPlace.path
    ? shownChart
    : path === reportPlace.path
      ? shownReport
      : undefined;
}

/** A page of a sample document, as the drawing service drew it. */
export async function drawSamplePage(
  revision: string,
  page: number,
): Promise<DocumentPageDrawing> {
  const data =
    revision === shownChart.revision
      ? chart
      : revision === shownReport.revision
        ? [firstPage, secondPage][page - 1]
        : undefined;
  if (!data) return { ok: false, reason: `Page ${page} could not be drawn.` };
  const size = revision === shownChart.revision ? shownChart.pages[0]! : letter;
  return { ok: true, data, width: size.width, height: size.height };
}

type ShownVideo = Extract<
  DocumentPanelState,
  { status: "shown"; kind: "video" }
>;

const videoPlace = {
  path: "renders/turntable.mp4",
  name: "turntable.mp4",
  folder: "renders",
};

/** A video the 3D studio rendered, played from where the lab serves it. */
export const shownVideo: ShownVideo = {
  ...videoPlace,
  status: "shown",
  documents: [
    videoPlace,
    { path: "reports/q3-report.pdf", name: "q3-report.pdf", folder: "reports" },
  ],
  revision: "video-1",
  kind: "video",
  source: turntable,
  openable: true,
};

/** A video whose file changed after it was rendered, and one it did not render. */
export const unplayedVideos: Extract<
  DocumentPanelState,
  { status: "failed" }
>[] = [
  {
    ...videoPlace,
    status: "failed",
    documents: [videoPlace],
    reason:
      "turntable.mp4 changed after Zhiyin's 3D studio rendered it, so it is not played here. Open it in its own app.",
    openable: true,
  },
  {
    path: "downloads/clip.mp4",
    name: "clip.mp4",
    folder: "downloads",
    status: "failed",
    documents: [videoPlace],
    reason:
      "Zhiyin plays the videos its 3D studio renders. Open clip.mp4 in its own app.",
    openable: true,
  },
];
