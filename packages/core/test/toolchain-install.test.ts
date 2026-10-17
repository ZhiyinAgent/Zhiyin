/**
 * A program a connector needs can be large, so its install shows how far it
 * has come and can be stopped. A stop is the person's choice, not a failure.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspacePlugins } from "../src/workspace-plugins.js";

afterEach(() => {
  vi.useRealTimers();
});

/** An install that runs until it is stopped. */
function installingUntilStopped() {
  const stopped: string[] = [];
  const capabilities = {
    installToolchain: (id: string, signal?: AbortSignal) =>
      new Promise<void>((_resolve, reject) =>
        signal?.addEventListener("abort", () => {
          stopped.push(id);
          reject(signal.reason);
        }),
      ),
  };
  return { stopped, capabilities };
}

function plugins(capabilities: object) {
  const refresh = vi.fn(async () => {});
  return {
    refresh,
    plugins: new WorkspacePlugins({
      capabilities: capabilities as ConstructorParameters<
        typeof WorkspacePlugins
      >[0]["capabilities"],
      refresh,
    }),
  };
}

describe("installing what a connector needs", () => {
  it("stops when the person cancels, and ends without a failure", async () => {
    const { stopped, capabilities } = installingUntilStopped();
    const { plugins: lifecycle, refresh } = plugins(capabilities);

    const installing = lifecycle.installToolchain(
      "software-engineering/browser",
    );
    await lifecycle.cancelToolchainInstall("software-engineering/browser");

    await expect(installing).resolves.toBeUndefined();
    expect(stopped).toEqual(["software-engineering/browser"]);
    // The window is told the install ended.
    expect(refresh).toHaveBeenCalled();
  });

  it("installs again when asked right after a cancel, and that install can be stopped too", async () => {
    const { stopped, capabilities } = installingUntilStopped();
    const { plugins: lifecycle } = plugins(capabilities);

    const first = lifecycle.installToolchain("software-engineering/browser");
    await lifecycle.cancelToolchainInstall("software-engineering/browser");
    // Asked again before the first has ended.
    const second = lifecycle.installToolchain("software-engineering/browser");
    await first;
    expect(stopped).toEqual(["software-engineering/browser"]);

    await lifecycle.cancelToolchainInstall("software-engineering/browser");
    await expect(second).resolves.toBeUndefined();
    expect(stopped).toEqual([
      "software-engineering/browser",
      "software-engineering/browser",
    ]);
  });

  it("cancels nothing for a connector that is not installing", async () => {
    const { stopped, capabilities } = installingUntilStopped();
    const { plugins: lifecycle } = plugins(capabilities);

    const installing = lifecycle.installToolchain(
      "software-engineering/browser",
    );
    await lifecycle.cancelToolchainInstall("3d-rendering/blender");

    expect(stopped).toEqual([]);
    await lifecycle.cancelToolchainInstall("software-engineering/browser");
    await installing;
  });

  it("still reports an install that failed on its own", async () => {
    const { plugins: lifecycle } = plugins({
      installToolchain: async () => {
        throw new Error("The download stopped.");
      },
    });

    await expect(
      lifecycle.installToolchain("software-engineering/browser"),
    ).rejects.toThrow("The download stopped.");
  });

  it("tells the window how far it has come about every second", async () => {
    vi.useFakeTimers();
    const { capabilities } = installingUntilStopped();
    const { plugins: lifecycle, refresh } = plugins(capabilities);

    const installing = lifecycle.installToolchain(
      "software-engineering/browser",
    );
    await vi.advanceTimersByTimeAsync(0);
    const atStart = refresh.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3_000);

    expect(refresh.mock.calls.length - atStart).toBeGreaterThanOrEqual(3);
    await lifecycle.cancelToolchainInstall("software-engineering/browser");
    await installing;
    const atEnd = refresh.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(refresh.mock.calls.length).toBe(atEnd);
  });
});
