import { useId, type ReactNode } from "react";
import { Icon } from "../shared/index.js";
import styles from "./capabilities.module.css";

/** How Zhiyin gets into a connector's service. */
export type AccessMode = "sign-in" | "token";

const modes = [
  {
    value: "sign-in",
    label: "Sign in with an account",
    detail: "On the service's own page, in your browser.",
  },
  {
    value: "token",
    label: "Paste an access token",
    detail: "A key you make on the service's site.",
  },
] as const;

/** The two ways in, side by side; what follows asks only for the chosen one. */
export function AccessChoice({
  mode,
  onChange,
}: {
  mode: AccessMode;
  onChange: (mode: AccessMode) => void;
}) {
  const name = useId();
  const heading = useId();
  return (
    <div className={styles["access-choice"]}>
      <span id={heading} className={styles["access-choice__title"]}>
        How Zhiyin gets access
      </span>
      <div
        role="radiogroup"
        aria-labelledby={heading}
        className={styles["access-choice__options"]}
      >
        {modes.map((choice) => (
          <label key={choice.value} className={styles["access-choice__option"]}>
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={mode === choice.value}
              onChange={() => onChange(choice.value)}
            />
            <span className={styles["access-choice__label"]}>
              {choice.label}
            </span>
            <span className={styles["access-choice__detail"]}>
              {choice.detail}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Where a connector's account stands, with the one thing to do about it
 * beside the words: sign in, cancel a sign-in waiting in the browser, try
 * again, or sign out.
 */
export function SignInCard({
  name,
  signedIn,
  signingIn,
  failure,
  busy,
  onSignIn,
  onCancel,
  onSignOut,
}: {
  name: string;
  signedIn: boolean;
  signingIn: boolean;
  failure: string | null;
  /** Another change to this connector is under way. */
  busy: boolean;
  onSignIn: () => void;
  onCancel: () => void;
  onSignOut: () => void;
}) {
  if (signingIn)
    return (
      <AccessCard
        tone="waiting"
        title="Waiting for your browser"
        detail={`Finish signing in to ${name} there, then come back here.`}
        action={
          <button
            key="cancel"
            className="button"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        }
      />
    );
  if (signedIn)
    return (
      <AccessCard
        tone="ok"
        title={`Signed in to ${name}`}
        detail="Zhiyin uses what your account allows. Signing out makes Zhiyin forget it."
        action={
          <button
            key="sign-out"
            className="button"
            type="button"
            disabled={busy}
            onClick={onSignOut}
          >
            Sign out
          </button>
        }
      />
    );
  return (
    <AccessCard
      tone={failure ? "failed" : "neutral"}
      title={failure ? "The sign-in did not finish" : `Sign in to ${name}`}
      detail={
        failure ??
        "Opens its sign-in page in your browser. There is nothing to copy."
      }
      action={
        <button
          key="sign-in"
          className="button button--accent"
          type="button"
          disabled={busy}
          onClick={onSignIn}
        >
          {failure ? "Try again" : "Sign in"}
        </button>
      }
    />
  );
}

function AccessCard({
  tone,
  title,
  detail,
  action,
}: {
  tone: "neutral" | "waiting" | "ok" | "failed";
  title: string;
  detail: string;
  action: ReactNode;
}) {
  return (
    <div
      className={`${styles["access-card"]} ${styles[`access-card--${tone}`]}`}
    >
      <div className={styles["access-card__text"]}>
        <strong>
          {tone === "ok" && <Icon name="check" />}
          {title}
        </strong>
        <span role={tone === "failed" ? "alert" : "status"}>{detail}</span>
      </div>
      {action}
    </div>
  );
}
