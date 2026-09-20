import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../shared/index.js";
import type {
  ReasoningCapabilities,
  ReasoningSelection,
} from "@zhiyin/contract";
import { ReasoningControls } from "./ReasoningControls.js";
import styles from "./conversation.module.css";

type ComposerProps = {
  draft?: { readonly id: string; readonly text: string };
  disabledReason?: string;
  disabledPlaceholder?: string;
  onSubmit?: (
    message: string,
    reasoning?: ReasoningSelection,
  ) => void | Promise<void>;
  reasoningCapabilities?: ReasoningCapabilities;
  initialReasoning?: ReasoningSelection;
  onAddContext?: () => void;
  running?: boolean;
  onStop?: () => void;
  /**
   * Shown at the start of the footer, before the tools. The folder picker
   * lives here: the scope of what the next message may do belongs with the
   * message, not in a bar of its own above the conversation.
   */
  scope?: ReactNode;
};

export function Composer({
  draft,
  disabledReason,
  disabledPlaceholder = "Composer paused",
  onSubmit,
  onAddContext,
  running = false,
  onStop,
  scope,
  reasoningCapabilities,
  initialReasoning,
}: ComposerProps) {
  const [reasoningDraft, setReasoningDraft] = useState<ReasoningSelection>();
  const [sending, setSending] = useState(false);
  const capabilities =
    reasoningCapabilities?.status === "available"
      ? reasoningCapabilities
      : undefined;
  const selectedReasoning = reasoningDraft ?? initialReasoning;
  const reasoning: ReasoningSelection =
    capabilities &&
    (capabilities.required ||
      (selectedReasoning?.enabled ?? capabilities.defaultEnabled))
      ? {
          enabled: true,
          ...((
            selectedReasoning?.enabled
              ? selectedReasoning.effort
              : capabilities.defaultEffort
          )
            ? {
                effort: selectedReasoning?.enabled
                  ? selectedReasoning.effort
                  : capabilities.defaultEffort,
              }
            : {}),
        }
      : { enabled: false };
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const loadedDraftId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!draft || loadedDraftId.current === draft.id) return;
    loadedDraftId.current = draft.id;
    setMessage(draft.text);
    setError("");
  }, [draft]);

  async function submit() {
    const value = message.trim();
    if (!value || disabledReason || running || submitting.current) return;
    submitting.current = true;
    setSending(true);
    setError("");
    setMessage("");
    try {
      if (capabilities) await onSubmit?.(value, reasoning);
      else await onSubmit?.(value);
    } catch {
      setMessage(value);
      setError("Your message could not be sent. It is still here.");
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }

  return (
    /*
     * Running and paused look different on purpose. Paused means the whole
     * composer is unavailable, so the whole thing dims. Running means only
     * the field is closed — settings and Stop stay live — so the dimming is
     * confined to the field and the edge stays lit to say work is under way.
     */
    <form
      className={`${styles.composer}${disabledReason ? ` ${styles["composer--disabled"]}` : ""}${running ? ` ${styles["composer--running"]}` : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-label="Message Zhiyin"
        placeholder={
          running
            ? "Response in progress"
            : disabledReason
              ? disabledPlaceholder
              : "Ask anything. Start somewhere."
        }
        value={message}
        disabled={Boolean(disabledReason) || running}
        rows={1}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {error && (
        <p className={styles.composer__error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.composer__footer}>
        <div className={styles.composer__tools}>
          {scope}
          {onAddContext && (
            <button
              type="button"
              aria-label="Add context"
              disabled={Boolean(disabledReason)}
              onClick={onAddContext}
            >
              <Icon name="plus" />
            </button>
          )}
          {reasoningCapabilities && (
            <ReasoningControls
              capabilities={reasoningCapabilities}
              value={reasoning}
              onChange={setReasoningDraft}
              disabled={Boolean(disabledReason) || sending}
            />
          )}
          {disabledReason && <span>{disabledReason}</span>}
        </div>
        {running ? (
          <button
            className={`${styles.composer__send} ${styles.composer__stop}`}
            type="button"
            aria-label="Stop task"
            onClick={onStop}
          >
            <Icon name="square" />
          </button>
        ) : (
          <button
            className={styles.composer__send}
            type="submit"
            aria-label="Send message"
            disabled={Boolean(disabledReason) || !message.trim()}
          >
            <Icon name="arrow-up" />
          </button>
        )}
      </div>
    </form>
  );
}
