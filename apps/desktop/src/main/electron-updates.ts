/**
 * electron-updater as the updates feature's source (ADR 0027): it finds the
 * newest release a place offers, downloads it into its own cache, and starts
 * the installer. It decides nothing; every check is the feature's.
 */

import { basename } from "node:path";
import { CancellationToken, NsisUpdater } from "electron-updater";
import {
  NotUsable,
  type SignedRelease,
  type UpdatePlace,
  type UpdateSource,
} from "./composition.js";

type Log = (level: "info" | "warn" | "error", message: string) => void;

/** Names the file it downloaded, which electron-updater keeps to itself. */
class Updater extends NsisUpdater {
  get downloaded(): string | null {
    return this.installerPath;
  }
}

function updaterFor(place: UpdatePlace, log: Log): Updater {
  const updater = new Updater(
    place.kind === "github"
      ? { provider: "github", owner: place.owner, repo: place.repository }
      : { provider: "generic", url: place.url },
  );
  // Only Zhiyin decides when to download and when to install.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.disableWebInstaller = true;
  updater.logger = {
    info: (message?: unknown) => log("info", String(message)),
    warn: (message?: unknown) => log("warn", String(message)),
    error: (message?: unknown) => log("error", String(message)),
  };
  return updater;
}

function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, refuse) => {
    const stop = () => refuse(new Error("stopped"));
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
}

export function electronUpdateSource(log: Log): UpdateSource {
  const updaters = new Map<string, Updater>();
  const of = (place: UpdatePlace) => {
    let updater = updaters.get(place.name);
    if (!updater) {
      updater = updaterFor(place, log);
      updaters.set(place.name, updater);
    }
    return updater;
  };
  let downloadedBy: { updater: Updater; path: string } | undefined;

  return {
    async look(place, signal) {
      const result = await Promise.race([
        of(place).checkForUpdates(),
        untilAborted(signal),
      ]);
      if (!result?.isUpdateAvailable) return undefined;
      const { updateInfo } = result;
      const installer = updateInfo.files.find((file) =>
        file.url.endsWith(".exe"),
      );
      if (!installer || installer.size === undefined)
        throw new NotUsable("its newest release names no installer.");
      return {
        version: updateInfo.version,
        file: basename(
          decodeURIComponent(new URL(installer.url, "https://a/").pathname),
        ),
        size: installer.size,
        sha512: installer.sha512,
      } satisfies SignedRelease;
    },

    async download(place, _release, progress, signal) {
      const updater = of(place);
      const token = new CancellationToken();
      signal.addEventListener("abort", () => token.cancel(), { once: true });
      const onProgress = ({ percent }: { percent: number }) =>
        progress(percent / 100);
      updater.on("download-progress", onProgress);
      try {
        const files = await updater.downloadUpdate(token);
        const path =
          updater.downloaded ?? files.find((file) => file.endsWith(".exe"));
        if (!path) throw new NotUsable("the download left no installer.");
        downloadedBy = { updater, path };
        return path;
      } finally {
        updater.off("download-progress", onProgress);
      }
    },

    install(path) {
      // electron-updater starts the file it downloaded: it must be the one
      // the feature measured.
      if (!downloadedBy || downloadedBy.updater.downloaded !== path)
        throw new NotUsable("The installer to start is not the one checked.");
      downloadedBy.updater.quitAndInstall(true, true);
    },
  };
}
