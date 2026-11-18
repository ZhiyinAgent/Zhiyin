import { DocumentPanel } from "../../ui/document/index.js";
import { SurfaceSwitch, BesideNotice } from "../../ui/beside/index.js";
import {
  drawSamplePage,
  failedDocuments,
  openingReport,
  shownChart,
  shownReport,
  shownVideo,
  unplayedVideos,
} from "../fixtures/documents.js";
import type { ComponentCatalogEntry } from "./entry.js";

const actions = {
  drawPage: drawSamplePage,
  onShow: () => undefined,
  onOpen: () => undefined,
  onShowInFolder: () => undefined,
  onClose: () => undefined,
};

export const documentEntries: ComponentCatalogEntry[] = [
  {
    id: "document-shown",
    title: "A document beside the conversation",
    description:
      "A PDF the agent made, as pictures of its pages drawn by the core. Page count, fit-to-width and 100%, Open and Show in folder, and the menu of the conversation's documents.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface lab-document-surface">
        <DocumentPanel document={shownReport} {...actions} />
      </div>
    ),
  },
  {
    id: "document-picture",
    title: "A picture beside the conversation",
    description:
      "A picture is one page, shown no larger than it is, with no page count.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface lab-document-surface lab-document-surface--short">
        <DocumentPanel document={shownChart} {...actions} />
      </div>
    ),
  },
  {
    id: "document-video",
    title: "A video beside the conversation",
    description:
      "A video the 3D studio rendered, in the same frame as a document: the player's own controls, Open and Show in folder, and the menu of the conversation's files. It never starts by itself.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface lab-document-surface lab-document-surface--short">
        <DocumentPanel document={shownVideo} {...actions} />
      </div>
    ),
  },
  {
    id: "document-video-unplayed",
    title: "A video that is not played here",
    description:
      "One changed after the 3D studio rendered it, and one it did not render: each says why and offers its own app.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-document-states">
        {unplayedVideos.map((document) => (
          <div
            key={document.path}
            className="lab-feature-surface lab-document-surface lab-document-surface--state"
          >
            <DocumentPanel document={document} {...actions} />
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "document-unavailable",
    title: "A document with nothing to show",
    description:
      "Opening, then each reason a file is not drawn: too large, damaged, protected, and a kind the panel cannot draw yet. Open is offered only for types Windows may open safely.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-document-states">
        {[openingReport, ...failedDocuments].map((document) => (
          <div
            key={document.path}
            className="lab-feature-surface lab-document-surface lab-document-surface--state"
          >
            <DocumentPanel document={document} {...actions} />
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "workspace-choice",
    title: "Choosing what is beside the conversation",
    description:
      "With a browser and a document both open, the space beside the conversation offers one or the other; choosing hides the other without closing it. When it is put away, the conversation says what is in it.",
    render: () => (
      <div className="lab-stack">
        <SurfaceSwitch
          available={["browser", "document"]}
          selected="document"
          onSelect={() => undefined}
        />
        <BesideNotice
          text="q3-report.pdf is open beside the conversation."
          surface="document"
          onShow={() => undefined}
        />
        <BesideNotice
          text="Zhiyin opened a browser."
          surface="browser"
          onShow={() => undefined}
        />
      </div>
    ),
  },
];
