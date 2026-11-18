/**
 * A document shown beside the conversation: a PDF or a picture, drawn by the
 * core and sent to the window as pictures of its pages (ADR 0019), or a video
 * Zhiyin's 3D studio rendered, played from a copy kept when it was written.
 * Nothing of a PDF or a picture itself crosses; only where it is, what it is
 * called, and PNGs.
 */

/**
 * The scheme a kept video is played from in the window: an address the core
 * answers, reaching no file but the copies it keeps.
 */
export const VIDEO_SCHEME = "zhiyin-video";

/** Where a document is, as a person reads it. */
export type DocumentPlace = {
  /** Workspace-relative, with forward slashes. */
  readonly path: string;
  readonly name: string;
  /** The folder it is in, workspace-relative; empty at the folder's top. */
  readonly folder: string;
};

/** A page's own size at 100%, in CSS pixels. */
export type DocumentPageSize = {
  readonly width: number;
  readonly height: number;
};

export type DocumentPanelState =
  | {
      readonly status: "closed";
      /** The conversation's documents, for the panel's menu. */
      readonly documents: readonly DocumentPlace[];
    }
  | (DocumentPlace & {
      readonly status: "opening";
      readonly documents: readonly DocumentPlace[];
    })
  | (DocumentPlace & {
      readonly status: "shown";
      readonly documents: readonly DocumentPlace[];
      /** Changes whenever the file's contents do; pages are drawn for one. */
      readonly revision: string;
      /**
       * A page the agent pointed at, counting from 1. The count goes up with
       * each pointing, so pointing at the same page twice is still news.
       */
      readonly pointed?: { readonly page: number; readonly count: number };
      /** Whether Windows' own app may open it (an allow-list of types). */
      readonly openable: boolean;
    } & (
        | {
            readonly kind: "pdf" | "picture";
            readonly pages: readonly DocumentPageSize[];
          }
        | {
            readonly kind: "video";
            /** Where the window plays it from, on the video scheme. */
            readonly source: string;
          }
      ))
  | (DocumentPlace & {
      readonly status: "failed";
      readonly documents: readonly DocumentPlace[];
      /** Why it is not drawn, in a sentence a person can read. */
      readonly reason: string;
      readonly openable: boolean;
    });

export type ConversationDocumentState = {
  readonly taskId: string;
  readonly document: DocumentPanelState;
};

/** One page, drawn at a width the window asked for. */
export type DocumentPageDrawing =
  | {
      readonly ok: true;
      /** A `data:image/png;base64,` URL, the only form a page reaches the window in. */
      readonly data: string;
      readonly width: number;
      readonly height: number;
    }
  | { readonly ok: false; readonly reason: string };

export type DocumentShowOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * What the space beside a conversation shows: nothing (the conversation has
 * the window), the browser, a document, or the 3D view. One at a time.
 */
export type WorkspaceView = "conversation" | "browser" | "document" | "3d";

/**
 * What the 3D view shows: the conversation's Blender scene, or the parts its
 * CAD studio built last.
 */
export type ThreeDContent = "scene" | "parts";

export type ConversationWorkspaceView = {
  readonly taskId: string;
  readonly view: WorkspaceView;
  /** What the 3D view shows, when the conversation has something in 3D. */
  readonly threeD?: ThreeDContent;
};

/** What the window asks of the documents beside a conversation. */
export interface DocumentCommands {
  /**
   * Shows one of the conversation's workspace files beside it, as the
   * person's choice, at a page when one is named (a citation, ADR 0019). A
   * path outside the folder it works in, or a page the document does not
   * have, is refused.
   */
  showDocument(
    taskId: string,
    path: string,
    page?: number,
  ): Promise<DocumentShowOutcome>;
  /** Closes the document beside the conversation; the file is untouched. */
  closeDocument(taskId: string): Promise<void>;
  /** One page of the revision shown, drawn at a width in device pixels. */
  drawDocumentPage(
    taskId: string,
    revision: string,
    page: number,
    width: number,
  ): Promise<DocumentPageDrawing>;
  /**
   * Opens a workspace document in Windows' own app. Refused for any type not
   * on the allow-list, so nothing Windows could run is ever opened.
   */
  openDocument(taskId: string, path: string): Promise<void>;
  /** Shows a workspace file selected in its folder, without opening it. */
  showDocumentInFolder(taskId: string, path: string): Promise<void>;
  /**
   * The person's choice of what the space beside the conversation shows,
   * and for the 3D view, which of the scene and the parts.
   */
  chooseWorkspaceView(
    taskId: string,
    view: WorkspaceView,
    threeD?: ThreeDContent,
  ): Promise<void>;
}
