import { ArtifactDrawer, ArtifactPanel } from "../../ui/artifacts/index.js";
import type { ComponentCatalogEntry } from "./entry.js";

export const artifactsEntries: ComponentCatalogEntry[] = [
  {
    id: "artifacts",
    title: "Produced files",
    description:
      "Files a task created or replaced, with review, save, and the states a file can be in afterwards. The panel renders nothing when a task has produced none.",
    render: () => (
      <ArtifactPanel
        artifacts={[
          {
            path: "reports/release-brief.md",
            name: "release-brief.md",
            change: "created",
            bytes: 1536,
            updatedAt: "2026-09-05T10:00:00.000Z",
          },
          {
            path: "notes.md",
            name: "notes.md",
            change: "updated",
            bytes: 240,
            updatedAt: "2026-09-05T10:05:00.000Z",
          },
          {
            path: "archive/very-long-generated-file-name-for-overflow.md",
            name: "very-long-generated-file-name-for-overflow.md",
            change: "created",
            bytes: 2_400_000,
            updatedAt: "2026-09-05T10:06:00.000Z",
          },
        ]}
        onPreview={async (path) =>
          path === "notes.md"
            ? {
                status: "missing",
                path,
                reason:
                  "notes.md is no longer in the workspace. It may have been moved, renamed, or deleted outside Zhiyin.",
              }
            : {
                status: "ready",
                path,
                text: [
                  "# Release brief",
                  "",
                  "Twelve commits, distilled for a public audience.",
                ].join("\n"),
                truncated: path.startsWith("archive/"),
              }
        }
        onExport={async (path) =>
          path === "notes.md"
            ? {
                status: "failed",
                reason:
                  "notes.md could not be saved to that location. Check that the folder exists and allows changes.",
              }
            : {
                status: "saved",
                destination: String.raw`C:\Users\sam\Desktop\release-brief.md`,
              }
        }
      />
    ),
  },
  {
    id: "files-drawer",
    title: "Produced files, in place",
    description:
      "The same list as it appears in the app: a panel over the right of the conversation, opened from the session header and closed with Escape.",
    render: () => (
      <div className="lab-drawer-stage">
        <ArtifactDrawer
          open
          onClose={() => undefined}
          artifacts={[
            {
              path: "reports/release-brief.md",
              name: "release-brief.md",
              change: "created",
              bytes: 1536,
              updatedAt: "2026-09-05T10:00:00.000Z",
            },
            {
              path: "notes.md",
              name: "notes.md",
              change: "updated",
              bytes: 240,
              updatedAt: "2026-09-05T10:05:00.000Z",
            },
          ]}
          onPreview={async (path) => ({
            status: "ready",
            path,
            text: "The finished brief.",
            truncated: false,
          })}
          onExport={async () => ({ status: "cancelled" })}
        />
      </div>
    ),
  },
];
