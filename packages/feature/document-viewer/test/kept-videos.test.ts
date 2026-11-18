/**
 * Videos beside a conversation: the document surface plays a video Zhiyin's
 * 3D studio rendered, from a copy kept when it was written, and no other.
 */

import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DocumentPanelState } from "@zhiyin/contract";
import { changed, TemporaryFolders, until } from "@zhiyin/test-support";
import { DocumentViewer, KeptVideos } from "../src/index.js";
import { containment, serviceProcess } from "./processes.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/** Bytes standing in for a video: nothing here decodes them. */
const clip = Buffer.from(Array.from({ length: 64 }, (_, index) => index));

async function setUp() {
  const parent = await folders.make("zhiyin-videos-");
  const root = join(parent, "work");
  await mkdir(join(root, "renders"), { recursive: true });
  await writeFile(join(root, "renders", "spin.mp4"), clip);
  const videos = new KeptVideos(join(parent, "data", "videos"));
  const documents = new DocumentViewer({
    start: serviceProcess,
    containment,
    videos,
  });
  documents.onChange(() => changed());
  /** Zhiyin's 3D studio rendered this file. */
  const rendered = (path: string) =>
    videos.keep("c1", path, join(root, ...path.split("/")));
  /** The panel, once it has settled on something. */
  const settled = async (): Promise<DocumentPanelState> => {
    await until(() => {
      const status = documents.state("c1").status;
      return status === "shown" || status === "failed";
    });
    return documents.state("c1");
  };
  return { parent, root, videos, documents, rendered, settled };
}

async function body(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

describe("a video beside the conversation", () => {
  it("is shown when the 3D studio renders it, to be played from the copy kept then", async () => {
    const { root, videos, documents, rendered, settled } = await setUp();
    await rendered("renders/spin.mp4");
    expect(await documents.written("c1", root, ["renders/spin.mp4"])).toEqual([
      "renders/spin.mp4",
    ]);

    const state = await settled();
    expect(state).toMatchObject({
      status: "shown",
      kind: "video",
      path: "renders/spin.mp4",
      name: "spin.mp4",
      folder: "renders",
      openable: true,
    });
    if (state.status !== "shown" || state.kind !== "video")
      throw new Error(state.status);
    expect(state.source).toMatch(/^zhiyin-video:\/\/video\//);

    // What plays is the copy: the workspace file can be removed or moved.
    await writeFile(join(root, "renders", "spin.mp4"), "");
    const whole = await videos.respond(state.source, null);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(await body(whole)).toEqual(clip);
  });

  it("answers the part of the video asked for, so the person can move through it", async () => {
    const { root, videos, documents, rendered, settled } = await setUp();
    await rendered("renders/spin.mp4");
    await documents.written("c1", root, ["renders/spin.mp4"]);
    const state = await settled();
    if (state.status !== "shown" || state.kind !== "video")
      throw new Error(state.status);

    const part = await videos.respond(state.source, "bytes=4-9");
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 4-9/64");
    expect(part.headers.get("content-length")).toBe("6");
    expect(await body(part)).toEqual(clip.subarray(4, 10));

    const rest = await videos.respond(state.source, "bytes=60-");
    expect(rest.headers.get("content-range")).toBe("bytes 60-63/64");
    expect(await body(rest)).toEqual(clip.subarray(60));

    const last = await videos.respond(state.source, "bytes=-4");
    expect(await body(last)).toEqual(clip.subarray(60));

    const beyond = await videos.respond(state.source, "bytes=64-");
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get("content-range")).toBe("bytes */64");
  });

  it("is not played once the file was changed after it was rendered, nor when the studio did not render it", async () => {
    const { root, documents, rendered, settled } = await setUp();
    await rendered("renders/spin.mp4");
    const later = new Date(Date.now() + 60_000);
    await writeFile(join(root, "renders", "spin.mp4"), "edited elsewhere");
    await utimes(join(root, "renders", "spin.mp4"), later, later);
    await documents.show("c1", root, "renders/spin.mp4");
    expect(await settled()).toMatchObject({
      status: "failed",
      reason:
        "spin.mp4 changed after Zhiyin's 3D studio rendered it, so it is not played here. Open it in its own app.",
      openable: true,
    });

    await writeFile(join(root, "renders", "other.mp4"), clip);
    await documents.show("c1", root, "renders/other.mp4");
    await until(
      () =>
        (documents.state("c1") as { path?: string }).path ===
          "renders/other.mp4" && documents.state("c1").status === "failed",
    );
    expect(documents.state("c1")).toMatchObject({
      status: "failed",
      reason:
        "Zhiyin plays the videos its 3D studio renders. Open other.mp4 in its own app.",
      openable: true,
    });
  });

  it("is a video no other conversation can play, and none once its conversation is gone", async () => {
    const { root, videos, documents, rendered, settled } = await setUp();
    await rendered("renders/spin.mp4");
    await documents.written("c1", root, ["renders/spin.mp4"]);
    const state = await settled();
    if (state.status !== "shown" || state.kind !== "video")
      throw new Error(state.status);

    const elsewhere = state.source.replace("/c1/", "/c2/");
    expect((await videos.respond(elsewhere, null)).status).toBe(404);
    expect(
      (await videos.respond("zhiyin-video://video/c1/../../secret", null))
        .status,
    ).toBe(404);
    // A broken escape in the conversation's part names nothing.
    expect(
      (await videos.respond("zhiyin-video://video/%E0%A4%A/1", null)).status,
    ).toBe(404);

    documents.forget("c1");
    expect((await videos.respond(state.source, null)).status).toBe(404);
  });

  it("keeps nothing from the last time the app ran", async () => {
    const parent = await folders.make("zhiyin-videos-");
    const directory = join(parent, "videos");
    await mkdir(join(directory, "c1"), { recursive: true });
    await writeFile(join(directory, "c1", "1.mp4"), clip);
    const root = join(parent, "work");
    await mkdir(root);
    await writeFile(join(root, "spin.mp4"), clip);

    const videos = new KeptVideos(directory);
    await videos.keep("c2", "spin.mp4", join(root, "spin.mp4"));
    await expect(readFile(join(directory, "c1", "1.mp4"))).rejects.toThrow();
  });
});
