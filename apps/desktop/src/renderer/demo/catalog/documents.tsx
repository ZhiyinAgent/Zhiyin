import { DocumentPanel } from "../../ui/document/index.js";
import { SurfaceSwitch, WorkspaceNotice } from "../../ui/workspace/index.js";
import {
  drawSamplePage,
  failedDocuments,
  openingReport,
  shownChart,
  shownReport,
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
      "With a browser and a document both open, the workspace offers one or the other; choosing hides the other without closing it. When the workspace is put away, the conversation says what is in it.",
    render: () => (
      <div className="lab-stack">
        <SurfaceSwitch selected="document" onSelect={() => undefined} />
        <WorkspaceNotice
          text="q3-report.pdf is open in the workspace."
          icon="file"
          onShow={() => undefined}
        />
        <WorkspaceNotice
          text="Zhiyin opened a browser."
          onShow={() => undefined}
        />
      </div>
    ),
  },
];
