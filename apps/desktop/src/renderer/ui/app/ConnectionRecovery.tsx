import { Icon, StandalonePage } from "../shared/index.js";

/**
 * What the window shows when it cannot reach the app behind it, drawn as the
 * other pages shown before the workspace are. Once trying again has failed
 * too, it says what else will: starting Zhiyin again.
 */
export function ConnectionRecovery({
  onRetry,
  triedAgain = false,
}: {
  onRetry: () => void;
  /** Trying again has already failed at least once. */
  triedAgain?: boolean;
}) {
  return (
    <StandalonePage
      label="CONNECTION"
      title="Let’s reconnect."
      introduction="This window could not reach the rest of Zhiyin. Your conversations are stored on this computer and have not been removed."
      {...(triedAgain
        ? { note: "Still not working? Close Zhiyin and open it again." }
        : {})}
      actions={
        <button
          type="button"
          className="button button--accent"
          onClick={onRetry}
        >
          Try again
          <Icon name="arrow-up" />
        </button>
      }
    />
  );
}
