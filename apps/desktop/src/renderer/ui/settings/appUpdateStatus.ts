import type { AppUpdateState } from "@zhiyin/contract";

const clock = new Intl.DateTimeFormat("en", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Where updating Zhiyin stands, in one or two sentences (ADR 0027). */
export function appUpdateStatus({
  phase,
  lastLook,
  checks,
}: AppUpdateState): string {
  switch (phase.kind) {
    case "looking":
      return "Looking for a newer version…";
    case "downloading":
      return phase.fraction === undefined
        ? `Downloading version ${phase.version}…`
        : `Downloading version ${phase.version}: ${Math.round(phase.fraction * 100)}%.`;
    case "ready":
      return `Version ${phase.version} is ready. It installs when Zhiyin restarts.`;
    case "restarting":
      return `Restarting into version ${phase.version}…`;
    case "idle":
      break;
  }
  if (!checks) return "Zhiyin does not look for newer versions.";
  if (!lastLook) return "Zhiyin looks for a newer version while it runs.";
  if (lastLook.outcome === "failed")
    return `No newer version could be used. ${lastLook.reason}`;
  return `Up to date, as of ${clock.format(new Date(lastLook.at))}.`;
}
