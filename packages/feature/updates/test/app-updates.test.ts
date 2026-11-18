/**
 * Zhiyin updates itself only from installers a maintainer's key signed
 * (ADR 0027). A release is checked against its signature before anything
 * large is downloaded, the download is measured against it, and the file is
 * measured again before it is installed. Anything else leaves the version
 * running as it is and says why.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppUpdateState } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import { AppUpdates } from "../src/app-updates.js";
import type { UpdatePlace } from "../src/update-places.js";
import {
  copy,
  github,
  keyPair,
  placesServing,
  releaseOf,
  signatureFile,
  type Key,
  type Offering,
} from "./releases.js";

const folders = new TemporaryFolders();
afterEach(async () => {
  vi.useRealTimers();
  await folders.removeAll();
});

const running = "0.1.0-alpha.1";
const installer = Buffer.from("the installer of alpha.2");
const alpha2 = releaseOf("0.1.0-alpha.2", installer);

async function updatesOver(
  offerings: Map<UpdatePlace, Offering>,
  {
    key = keyPair(),
    directory,
    lookLimit,
    downloadSilence,
    version = running,
  }: {
    key?: Key;
    directory?: string;
    lookLimit?: number;
    downloadSilence?: number;
    version?: string;
  } = {},
) {
  const folder = await folders.make("zhiyin-updates-");
  const served = placesServing(folder, offerings);
  const updates = new AppUpdates({
    directory: directory ?? folder,
    version,
    ...(downloadSilence === undefined ? {} : { downloadSilence }),
    keys: { [key.id]: key.spki },
    source: served.source,
    network: served.network,
    places: [github, copy],
    now: () => new Date("2026-11-07T10:00:00Z"),
    ...(lookLimit === undefined ? {} : { lookLimit }),
  });
  const phases: string[] = [];
  updates.onChanged((state) => {
    const last = phases.at(-1);
    if (last !== state.phase.kind) phases.push(state.phase.kind);
  });
  return { updates, phases, folder, ...served };
}

function signedBy(key: Key, offering: Offering = {}): Offering {
  return {
    release: alpha2,
    installer,
    signature: signatureFile(alpha2, key),
    ...offering,
  };
}

/** Waits for the download a look started to end, however it ends. */
async function settled(updates: AppUpdates): Promise<AppUpdateState> {
  await vi.waitFor(() => {
    const kind = updates.state().phase.kind;
    expect(kind === "downloading" || kind === "looking").toBe(false);
  });
  return updates.state();
}

describe("finding a newer release", () => {
  it("downloads a signed newer release and holds it ready to install", async () => {
    const key = keyPair();
    const { updates, phases, downloads } = await updatesOver(
      new Map([[github, signedBy(key)]]),
      { key },
    );

    await updates.check();
    const state = await settled(updates);

    expect(state.phase).toEqual({ kind: "ready", version: "0.1.0-alpha.2" });
    expect(state.lastLook).toEqual({
      at: "2026-11-07T10:00:00.000Z",
      outcome: "found",
      version: "0.1.0-alpha.2",
    });
    expect(phases).toEqual(["looking", "downloading", "ready"]);
    expect(downloads).toEqual(["GitHub 0.1.0-alpha.2"]);
  });

  it("downloads nothing when the place offers nothing newer", async () => {
    const { updates, downloads } = await updatesOver(new Map([[github, {}]]));

    const state = await updates.check();

    expect(state.phase).toEqual({ kind: "idle" });
    expect(state.lastLook).toMatchObject({ outcome: "current" });
    expect(downloads).toEqual([]);
  });

  it("does not take a signed release that is no newer than the one running", async () => {
    const key = keyPair();
    const old = releaseOf(running, installer);
    const { updates, downloads } = await updatesOver(
      new Map([
        [
          github,
          { release: old, installer, signature: signatureFile(old, key) },
        ],
      ]),
      { key },
    );

    const state = await updates.check();

    expect(state.lastLook).toMatchObject({ outcome: "current" });
    expect(downloads).toEqual([]);
  });
});

describe("refusing a release", () => {
  it("downloads nothing for a release with no signature", async () => {
    const { updates, downloads } = await updatesOver(
      new Map([[github, { release: alpha2, installer }]]),
    );

    const state = await updates.check();

    expect(state.phase).toEqual({ kind: "idle" });
    expect(state.lastLook).toMatchObject({
      outcome: "failed",
      reason: expect.stringContaining(
        "GitHub: 0.1.0-alpha.2 has no signature.",
      ),
    });
    expect(downloads).toEqual([]);
  });

  it("downloads nothing for a release signed with a key this version does not ship", async () => {
    const { updates, downloads } = await updatesOver(
      new Map([[github, signedBy(keyPair("someone-else"))]]),
    );

    const state = await updates.check();

    expect(state.lastLook).toMatchObject({
      outcome: "failed",
      reason: expect.stringContaining("a key this version does not know"),
    });
    expect(downloads).toEqual([]);
  });

  it("downloads nothing when the signature does not match what it names", async () => {
    const key = keyPair();
    const signature = JSON.parse(signatureFile(alpha2, key)) as Record<
      string,
      unknown
    >;
    const forged = JSON.stringify({ ...signature, size: alpha2.size + 1 });
    const { updates, downloads } = await updatesOver(
      new Map([
        [
          github,
          {
            ...signedBy(key),
            release: { ...alpha2, size: alpha2.size + 1 },
            signature: forged,
          },
        ],
      ]),
      { key },
    );

    const state = await updates.check();

    expect(state.lastLook).toMatchObject({
      outcome: "failed",
      reason: expect.stringContaining("signature does not match"),
    });
    expect(downloads).toEqual([]);
  });

  it("downloads nothing when the signature is for another installer than the one offered", async () => {
    const key = keyPair();
    const other = releaseOf("0.1.0-alpha.2", Buffer.from("something else"));
    const { updates, downloads } = await updatesOver(
      new Map([
        [github, signedBy(key, { signature: signatureFile(other, key) })],
      ]),
      { key },
    );

    const state = await updates.check();

    expect(state.lastLook).toMatchObject({
      outcome: "failed",
      reason: expect.stringContaining(
        "not the one the release's signature names",
      ),
    });
    expect(downloads).toEqual([]);
  });

  it("downloads nothing when the signature names another version than the one offered", async () => {
    const key = keyPair();
    const { updates, downloads } = await updatesOver(
      new Map([
        [
          github,
          // An old signed release served under a newer version's name.
          {
            release: { ...alpha2, version: "0.1.0-alpha.3" },
            installer,
            signature: signatureFile(alpha2, key),
          },
        ],
      ]),
      { key },
    );

    const state = await updates.check();

    expect(state.lastLook).toMatchObject({
      outcome: "failed",
      reason: expect.stringContaining(
        "offered is 0.1.0-alpha.3, but its signature names 0.1.0-alpha.2",
      ),
    });
    expect(downloads).toEqual([]);
  });

  it("refuses a signature carrying a field it does not know", async () => {
    const key = keyPair();
    const signature = JSON.parse(signatureFile(alpha2, key)) as object;
    const { updates, downloads } = await updatesOver(
      new Map([
        [
          github,
          signedBy(key, {
            signature: JSON.stringify({ ...signature, run: "after.exe" }),
          }),
        ],
      ]),
      { key },
    );

    const state = await updates.check();

    expect(state.lastLook).toMatchObject({
      outcome: "failed",
      reason: expect.stringContaining("signature is unreadable"),
    });
    expect(downloads).toEqual([]);
  });

  it("does not hold ready a download that is not the signed installer", async () => {
    const key = keyPair();
    const { updates } = await updatesOver(
      new Map([
        [
          github,
          signedBy(key, { installer: Buffer.from("a changed installer") }),
        ],
      ]),
      { key },
    );

    await updates.check();
    const state = await settled(updates);

    expect(state.phase).toEqual({ kind: "idle" });
    expect(state.lastLook).toMatchObject({
      outcome: "failed",
      reason: expect.stringContaining(
        "The downloaded installer is not the one the release's signature names.",
      ),
    });
    await expect(updates.prepareRestart()).rejects.toThrow(
      "No update is ready to install.",
    );
  });
});

describe("places in order", () => {
  it("takes the release from Zhiyin's copy when GitHub cannot be reached", async () => {
    const key = keyPair();
    const { updates, downloads } = await updatesOver(
      new Map([
        [github, { unreachable: true }],
        [copy, signedBy(key)],
      ]),
      { key },
    );

    await updates.check();
    const state = await settled(updates);

    expect(state.phase).toEqual({ kind: "ready", version: "0.1.0-alpha.2" });
    expect(downloads).toEqual(["media.zhiyinagent.app 0.1.0-alpha.2"]);
  });

  it("tries Zhiyin's copy when GitHub does not answer in time", async () => {
    const key = keyPair();
    const { updates, downloads } = await updatesOver(
      new Map([
        [github, { silent: true }],
        [copy, signedBy(key)],
      ]),
      { key, lookLimit: 50 },
    );

    await updates.check();
    const state = await settled(updates);

    expect(state.phase).toEqual({ kind: "ready", version: "0.1.0-alpha.2" });
    expect(downloads).toEqual(["media.zhiyinagent.app 0.1.0-alpha.2"]);
  });

  it("tries Zhiyin's copy when GitHub's download stops sending", async () => {
    const key = keyPair();
    const { updates, downloads } = await updatesOver(
      new Map([
        [github, signedBy(key, { stalls: true })],
        [copy, signedBy(key)],
      ]),
      { key, downloadSilence: 50 },
    );

    await updates.check();
    const state = await settled(updates);

    expect(state.phase).toEqual({ kind: "ready", version: "0.1.0-alpha.2" });
    expect(downloads).toEqual([
      "GitHub 0.1.0-alpha.2",
      "media.zhiyinagent.app 0.1.0-alpha.2",
    ]);
  });

  it("names a download that stopped sending when no other place has the release", async () => {
    const key = keyPair();
    const { updates } = await updatesOver(
      new Map([[github, signedBy(key, { stalls: true })]]),
      { key, downloadSilence: 50 },
    );

    await updates.check();
    const state = await settled(updates);

    expect(state.phase).toEqual({ kind: "idle" });
    expect(state.lastLook).toMatchObject({
      outcome: "failed",
      reason: expect.stringContaining(
        "GitHub: the download stopped sending.",
      ) as string,
    });
  });

  it("tries Zhiyin's copy when GitHub's release is refused", async () => {
    const key = keyPair();
    const { updates, downloads } = await updatesOver(
      new Map([
        [github, signedBy(keyPair("someone-else"))],
        [copy, signedBy(key)],
      ]),
      { key },
    );

    await updates.check();
    const state = await settled(updates);

    expect(state.phase).toEqual({ kind: "ready", version: "0.1.0-alpha.2" });
    expect(downloads).toEqual(["media.zhiyinagent.app 0.1.0-alpha.2"]);
  });

  it("does not call itself current when GitHub's newer release was refused and the copy has nothing newer", async () => {
    const { updates } = await updatesOver(
      new Map([
        [github, signedBy(keyPair("someone-else"))],
        [copy, {}],
      ]),
    );

    const state = await updates.check();

    expect(state.lastLook).toMatchObject({
      outcome: "failed",
      reason:
        "GitHub: The release is signed with a key this version does not know.",
    });
  });

  it("names what each place answered when none gives a release it can use", async () => {
    const { updates } = await updatesOver(
      new Map([
        [github, { unreachable: true }],
        [copy, { release: alpha2, installer }],
      ]),
    );

    const state = await updates.check();

    expect(state.lastLook).toEqual({
      at: "2026-11-07T10:00:00.000Z",
      outcome: "failed",
      reason:
        "GitHub could not be reached. media.zhiyinagent.app: 0.1.0-alpha.2 has no signature.",
    });
  });
});

describe("looking on and off", () => {
  it("sends nothing while looking is off, and stays off for the next start", async () => {
    const key = keyPair();
    const first = await updatesOver(new Map([[github, signedBy(key)]]), {
      key,
    });
    await first.updates.setChecks(false);

    const second = await updatesOver(new Map([[github, signedBy(key)]]), {
      key,
      directory: first.folder,
    });
    const state = await second.updates.check();

    expect(state.checks).toBe(false);
    expect(state.lastLook).toBeUndefined();
    expect(second.asked).toEqual([]);
  });

  it("is on when nothing was saved, or what was saved cannot be read", async () => {
    const folder = await folders.make("zhiyin-updates-");
    await writeFile(`${folder}/updates.json`, "{ not json");
    const { updates } = await updatesOver(new Map(), { directory: folder });

    await updates.load();

    expect(updates.state().checks).toBe(true);
  });

  it("stops a download under way when looking is turned off", async () => {
    const key = keyPair();
    const { updates } = await updatesOver(
      new Map([[github, signedBy(key, { stalls: true })]]),
      { key },
    );
    await updates.check();
    expect(updates.state().phase.kind).toBe("downloading");

    await updates.setChecks(false);
    const state = await settled(updates);

    expect(state.phase).toEqual({ kind: "idle" });
  });

  it("shares one look between two asked at once", async () => {
    const key = keyPair();
    const { updates, asked } = await updatesOver(
      new Map([[github, signedBy(key)]]),
      { key },
    );

    await Promise.all([updates.check(), updates.check()]);
    await settled(updates);

    expect(asked.filter((entry) => entry === "look GitHub")).toHaveLength(1);
  });

  it("looks soon after starting, then again after each round", async () => {
    vi.useFakeTimers();
    const folder = await folders.make("zhiyin-updates-");
    const served = placesServing(folder, new Map([[github, {}]]));
    const updates = new AppUpdates({
      directory: folder,
      version: running,
      keys: {},
      source: served.source,
      network: served.network,
      places: [github],
      firstLookAfter: 10_000,
      every: 3_600_000,
    });
    const looks = () =>
      served.asked.filter((entry) => entry.startsWith("look"));
    // Reading the setting is file work, which fake time does not move.
    await updates.load();

    updates.start();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(looks()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(looks()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(looks()).toHaveLength(2);

    updates.stop();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(looks()).toHaveLength(2);
  });

  it("stopping ends a download under way", async () => {
    const key = keyPair();
    const { updates } = await updatesOver(
      new Map([[github, signedBy(key, { stalls: true })]]),
      { key },
    );
    await updates.check();

    updates.stop();
    const state = await settled(updates);

    expect(state.phase).toEqual({ kind: "idle" });
  });
});

describe("a ready update", () => {
  async function ready() {
    const key = keyPair();
    const served = await updatesOver(new Map([[github, signedBy(key)]]), {
      key,
    });
    await served.updates.check();
    await settled(served.updates);
    return served;
  }

  it("installs only after it is measured again", async () => {
    const { updates, installed, folder } = await ready();

    await updates.prepareRestart();
    expect(updates.state().phase).toEqual({
      kind: "restarting",
      version: "0.1.0-alpha.2",
    });
    await updates.install();

    expect(installed).toEqual([join(folder, "download-1.exe")]);
  });

  it("does not install a file changed after it was downloaded", async () => {
    const { updates, installed, folder } = await ready();
    // As another program on this computer could change it.
    await writeFile(join(folder, "download-1.exe"), "changed after it came");

    await expect(updates.prepareRestart()).rejects.toThrow(
      "The downloaded installer is not the one the release's signature names.",
    );
    expect(updates.state().phase).toEqual({ kind: "idle" });
    expect(installed).toEqual([]);
  });

  it("does not install a file changed while Zhiyin shut down", async () => {
    const { updates, installed, folder } = await ready();
    await updates.prepareRestart();
    await writeFile(join(folder, "download-1.exe"), "changed in the shutdown");

    await expect(updates.install()).rejects.toThrow(
      "The downloaded installer is not the one the release's signature names.",
    );
    expect(installed).toEqual([]);
  });

  it("says on the next start that an update it began did not install", async () => {
    const { updates, folder } = await ready();
    await updates.prepareRestart();
    await updates.install();

    // The installer failed or was cancelled: the same version starts again.
    const { updates: next } = await updatesOver(new Map(), {
      directory: folder,
    });
    await next.load();

    expect(next.state().lastLook).toEqual({
      at: "2026-11-07T10:00:00.000Z",
      outcome: "failed",
      reason: "The update to version 0.1.0-alpha.2 did not install.",
    });
    // Said once: the start after it says nothing of it.
    const { updates: later } = await updatesOver(new Map(), {
      directory: folder,
    });
    await later.load();
    expect(later.state().lastLook).toBeUndefined();
  });

  it("says nothing on the next start when the update installed", async () => {
    const { updates, folder } = await ready();
    await updates.prepareRestart();
    await updates.install();

    const { updates: next } = await updatesOver(new Map(), {
      directory: folder,
      version: "0.1.0-alpha.2",
    });
    await next.load();

    expect(next.state().lastLook).toBeUndefined();
  });

  it("installs nothing without a restart prepared", async () => {
    const { updates, installed } = await ready();

    await expect(updates.install()).rejects.toThrow(
      "No update is being installed.",
    );
    expect(installed).toEqual([]);
  });

  it("does not download the same release again on the next look", async () => {
    const { updates, downloads } = await ready();

    await updates.check();

    expect(updates.state().phase).toEqual({
      kind: "ready",
      version: "0.1.0-alpha.2",
    });
    expect(downloads).toHaveLength(1);
  });
});
