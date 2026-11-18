import type { AppUpdateState } from "@zhiyin/contract";

/** A newer version downloaded and checked, waiting for a restart. */
export const demoUpdateReady: AppUpdateState = {
  version: "0.1.0-alpha.2",
  checks: true,
  phase: { kind: "ready", version: "0.1.0-alpha.3" },
  lastLook: {
    outcome: "found",
    version: "0.1.0-alpha.3",
    at: "2026-11-06T14:20:00.000Z",
  },
};
