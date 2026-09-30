import { AppSidebar, SessionHeader } from "../../ui/app/index.js";
import { BrowserPanel } from "../../ui/browser/index.js";
import { OutcomeCard } from "../../ui/conversation/index.js";
import { sampleBrowserFrame } from "../sampleBrowserFrame.js";
import type { ComponentCatalogEntry } from "./entry.js";

export const browserEntries: ComponentCatalogEntry[] = [
  {
    id: "frame",
    title: "App frame",
    description: "Navigation, task header, and completed-result handoff.",
    render: () => (
      <div className="lab-frame-parts">
        <div className="lab-sidebar">
          <AppSidebar
            selectedId="release"
            onSelect={() => undefined}
            tasks={[
              {
                id: "release",
                title: "Prepare v0.1 release notes",
                meta: "Now",
              },
              { id: "audit", title: "Audit dependencies", meta: "Yesterday" },
            ]}
          />
        </div>
        <div className="lab-frame-parts__main">
          <SessionHeader
            workspace="Zhiyin Desktop"
            title="Prepare v0.1 release notes"
          />
          <div>
            <OutcomeCard
              title="Release notes are ready"
              file="release-notes.md"
              summary="12 commits distilled into a concise public draft."
            />
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "agent-browser",
    title: "The agent's browser",
    description:
      "The right-hand rail while a page is open. The person watches the page the agent is working on, and can click and type into it.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface lab-feature-surface--rail">
        <BrowserPanel
          browser={{
            status: "open",
            url: "https://example.com/pricing",
            title: "Pricing — Example",
            loading: false,
            frame: { data: sampleBrowserFrame, width: 560, height: 420 },
          }}
          onDrive={() => undefined}
        />
      </div>
    ),
  },
  {
    id: "agent-browser-unavailable",
    title: "The agent's browser, with nothing to show",
    description:
      "Opening, and failed. A browser that cannot run says so where the page would have been, rather than showing an empty frame.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface lab-feature-surface--rail">
        <BrowserPanel
          browser={{ status: "opening", url: "", title: "", loading: true }}
          onDrive={() => undefined}
        />
        <BrowserPanel
          browser={{
            status: "failed",
            url: "",
            title: "",
            loading: false,
            reason:
              "No supported browser could be started. Tried msedge; chrome.",
          }}
          onDrive={() => undefined}
        />
      </div>
    ),
  },
];
