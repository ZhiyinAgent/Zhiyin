/**
 * Where Zhiyin stands on updating itself (ADR 0027): the version running,
 * whether it looks for newer releases, what it is doing about one, and what
 * the last look came to.
 */
export type AppUpdateState = {
  /** The version running. */
  readonly version: string;
  /** Whether Zhiyin looks for newer releases. */
  readonly checks: boolean;
  readonly phase: AppUpdatePhase;
  /** The last look for a newer release since Zhiyin started, if one ended. */
  readonly lastLook?: AppUpdateLook;
};

export type AppUpdatePhase =
  | { readonly kind: "idle" }
  | { readonly kind: "looking" }
  | {
      readonly kind: "downloading";
      readonly version: string;
      /** How much has arrived, from 0 to 1, once the download says. */
      readonly fraction?: number;
    }
  /** Downloaded and checked: it installs when the person restarts into it. */
  | { readonly kind: "ready"; readonly version: string }
  /** Shutting down to install it. */
  | { readonly kind: "restarting"; readonly version: string };

/**
 * A look for a newer release, and what came of it: none newer, a newer one
 * found, or none that could be used, which leaves the version running as it
 * is.
 */
export type AppUpdateLook = {
  /** When it ended, as an ISO time. */
  readonly at: string;
} & (
  | { readonly outcome: "current" }
  | { readonly outcome: "found"; readonly version: string }
  | { readonly outcome: "failed"; readonly reason: string }
);
