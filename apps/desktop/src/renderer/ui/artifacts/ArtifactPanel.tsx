import { useState } from "react";
import {
  namesADocument,
  type ArtifactExport,
  type ArtifactPreview,
  type TaskArtifact,
} from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./artifacts.module.css";

type ArtifactPanelProps = {
  artifacts: readonly TaskArtifact[];
  onPreview: (path: string) => Promise<ArtifactPreview>;
  onExport: (path: string) => Promise<ArtifactExport>;
  /**
   * Shows a PDF or picture beside the conversation. Without it,
   * every file is previewed as text here.
   */
  onShowBeside?: (path: string) => void;
};

type PreviewState = { status: "loading" } | ArtifactPreview;

type ExportState = { status: "saving" } | ArtifactExport;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The list of produced files, where each can be read and taken away. Shows
 * only what the core reports: a file that has since moved or become unreadable
 * says so here rather than appearing as an empty document.
 *
 * Where this list sits is [ArtifactDrawer]'s decision, not its own.
 */
export function ArtifactPanel({
  artifacts,
  onPreview,
  onExport,
  onShowBeside,
}: ArtifactPanelProps) {
  const [openPath, setOpenPath] = useState<string>();
  const [preview, setPreview] = useState<PreviewState>();
  const [exports, setExports] = useState<Record<string, ExportState>>({});

  if (!artifacts.length) return null;

  async function open(path: string) {
    if (openPath === path) {
      setOpenPath(undefined);
      setPreview(undefined);
      return;
    }
    setOpenPath(path);
    setPreview({ status: "loading" });
    try {
      setPreview(await onPreview(path));
    } catch {
      setPreview({
        status: "unreadable",
        path,
        reason: "This file could not be opened. Try again.",
      });
    }
  }

  async function save(path: string) {
    if (exports[path]?.status === "saving") return;
    setExports((current) => ({ ...current, [path]: { status: "saving" } }));
    try {
      const result = await onExport(path);
      setExports((current) => ({ ...current, [path]: result }));
    } catch {
      setExports((current) => ({
        ...current,
        [path]: {
          status: "failed",
          reason: "The copy could not be saved. Try again.",
        },
      }));
    }
  }

  return (
    <section className={styles.artifacts} aria-label="Files this task produced">
      <ul className={styles.artifacts__list}>
        {artifacts.map((artifact) => {
          const expanded = openPath === artifact.path;
          const saving = exports[artifact.path];
          const beside = onShowBeside && namesADocument(artifact.path);
          return (
            <li className={styles.artifacts__item} key={artifact.path}>
              <div className={styles.artifacts__row}>
                {beside ? (
                  <button
                    className={styles.artifacts__open}
                    type="button"
                    aria-label={`Show ${artifact.name} beside the conversation`}
                    data-tip="Show beside the conversation"
                    onClick={() => onShowBeside(artifact.path)}
                  >
                    <Icon name="file" />
                    <span className={styles.artifacts__name}>
                      {artifact.name}
                    </span>
                  </button>
                ) : (
                  <button
                    className={styles.artifacts__open}
                    type="button"
                    aria-expanded={expanded}
                    data-tip={
                      expanded ? "Hide the preview" : "Preview this file"
                    }
                    onClick={() => void open(artifact.path)}
                  >
                    <Icon name="file" />
                    <span className={styles.artifacts__name}>
                      {artifact.name}
                    </span>
                    <Icon name="chevron" />
                  </button>
                )}
                <span className={styles.artifacts__meta}>
                  {artifact.change === "created"
                    ? "Created by this task"
                    : "Replaced an existing file"}
                  {" · "}
                  {formatBytes(artifact.bytes)}
                </span>
                <button
                  className={`button button--small ${styles.artifacts__save}`}
                  type="button"
                  disabled={saving?.status === "saving"}
                  onClick={() => void save(artifact.path)}
                >
                  {saving?.status === "saving" ? "Saving…" : "Save a copy"}
                </button>
                <code className={styles.artifacts__path}>{artifact.path}</code>
              </div>

              {saving?.status === "saved" && (
                <p className={styles.artifacts__note} role="status">
                  Saved a copy to {saving.destination}
                </p>
              )}
              {saving?.status === "failed" && (
                <p className={styles.artifacts__error} role="alert">
                  {saving.reason}
                </p>
              )}

              {expanded && preview?.status === "loading" && (
                <p className={styles.artifacts__note} role="status">
                  Opening {artifact.name}…
                </p>
              )}
              {expanded && preview?.status === "ready" && (
                <div className={styles.artifacts__preview}>
                  <pre>{preview.text}</pre>
                  {preview.truncated && (
                    <p className={styles.artifacts__note}>
                      Only the beginning is shown here. Save a copy to read all
                      of it.
                    </p>
                  )}
                </div>
              )}
              {expanded &&
                (preview?.status === "missing" ||
                  preview?.status === "unreadable") && (
                  <p className={styles.artifacts__error} role="alert">
                    {preview.reason}
                  </p>
                )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
