import { useCallback } from "react";
import type { WindowAction } from "./windowState.js";

/**
 * What a failure says on screen: the core's own message, or, where the cause
 * carries none, the fallback given.
 */
export function reasonOf(
  cause: unknown,
  fallback = "That action could not be completed. Try again.",
): string {
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * Runs the core's commands for the window, saying what failed. The failure is
 * held with the rest of the window's state rather than beside it, so it
 * survives the app's pages changing under it, and each command clears the
 * last one before it runs.
 */
export function useCommandRunner(
  commandError: string | undefined,
  dispatch: (action: WindowAction) => void,
) {
  const say = useCallback(
    (message: string) => dispatch({ type: "commandErrorShown", message }),
    [dispatch],
  );
  const act = useCallback(
    async (operation: () => void | Promise<unknown>) => {
      say("");
      try {
        await operation();
      } catch (error) {
        say(reasonOf(error));
      }
    },
    [say],
  );
  return {
    /** The failure on screen; empty when there is none. */
    error: commandError ?? "",
    /** Runs a command, showing its failure in the window. */
    act,
    /** Shows a message where a failed command's would be. */
    say,
  };
}
