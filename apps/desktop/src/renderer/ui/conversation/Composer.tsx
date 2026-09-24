import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../shared/index.js";
import type {
  MessageAttachment,
  PasteOutcome,
  ReasoningCapabilities,
  ReasoningSelection,
} from "@zhiyin/contract";
import {
  estimatedTokens,
  typedMessageCharacters,
  utf8Bytes,
} from "@zhiyin/contract";
import { ContextRing } from "./ContextRing.js";
import { PastedText } from "./PastedText.js";
import { ReasoningControls } from "./ReasoningControls.js";
import styles from "./conversation.module.css";

type ComposerProps = {
  /** Words and pastes put back, as a rewind does; each loaded once. */
  draft?: {
    readonly id: string;
    readonly text: string;
    readonly attachments?: readonly MessageAttachment[];
  };
  disabledReason?: string;
  disabledPlaceholder?: string;
  onSubmit?: (
    message: string,
    reasoning?: ReasoningSelection,
    attachments?: readonly MessageAttachment[],
  ) => void | Promise<void>;
  /** Keeps a long paste beside the conversation, so the field never holds it. */
  keepPaste?: (text: string) => Promise<PasteOutcome>;
  /** Opens a kept paste in the person's own editor. */
  openAttachment?: (id: string) => void;
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
  /** How full the next request is, and the budget it is held to. */
  context?: Omit<Parameters<typeof ContextRing>[0], "draftTokens" | "disabled">;
};

/** A paste this long is kept as a file and shown as a chip, not as text. */
const pasteCharacters = 15_000;
/** Past this, a paste is refused; the store keeps nothing larger. */
const pasteBytes = 50 * 1024 * 1024;

export function Composer({
  draft,
  disabledReason,
  disabledPlaceholder = "Composer paused",
  onSubmit,
  keepPaste,
  openAttachment,
  onAddContext,
  running = false,
  onStop,
  scope,
  reasoningCapabilities,
  initialReasoning,
  context,
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
  const [attachments, setAttachments] = useState<readonly MessageAttachment[]>(
    [],
  );
  const [keeping, setKeeping] = useState(0);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const loadedDraftId = useRef<string | undefined>(undefined);

  async function keep(text: string) {
    if (!keepPaste) return;
    setError("");
    if (utf8Bytes(text) > pasteBytes) {
      setError(
        "This paste is larger than 50 MB. Save it as a file in the folder and ask about the file instead.",
      );
      return;
    }
    setKeeping((count) => count + 1);
    try {
      const kept = await keepPaste(text);
      if (kept.status === "kept")
        setAttachments((current) => [...current, kept.attachment]);
      else setError(`The pasted text was not kept: ${kept.reason}`);
    } catch {
      setError("The pasted text could not be kept. Try pasting it again.");
    } finally {
      setKeeping((count) => count - 1);
    }
  }

  useEffect(() => {
    if (!draft || loadedDraftId.current === draft.id) return;
    loadedDraftId.current = draft.id;
    setMessage(draft.text);
    setAttachments(draft.attachments ?? []);
    setError("");
  }, [draft]);

  async function submit() {
    const typed = message.trim();
    const kept = attachments;
    if (
      (!typed && !kept.length) ||
      keeping ||
      disabledReason ||
      running ||
      submitting.current
    )
      return;
    submitting.current = true;
    setSending(true);
    setError("");
    try {
      let value = typed;
      let sent = kept;
      // Past the limit, what was typed goes as a file, as a long paste does;
      // if it cannot be kept, it stays in the field unsent.
      if (typed.length > typedMessageCharacters) {
        const file = await keepPaste?.(typed).catch(() => undefined);
        if (file?.status !== "kept") {
          setError(
            file
              ? `Your message was not sent: ${file.reason}`
              : "Your message could not be kept as a file. It is still here.",
          );
          return;
        }
        value = "";
        sent = [...kept, file.attachment];
      }
      setMessage("");
      setAttachments([]);
      try {
        if (sent.length)
          await onSubmit?.(value, capabilities ? reasoning : undefined, sent);
        else if (capabilities) await onSubmit?.(value, reasoning);
        else await onSubmit?.(value);
      } catch {
        setMessage(typed);
        setAttachments(kept);
        setError("Your message could not be sent. It is still here.");
      }
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
        onPaste={(event) => {
          if (!keepPaste) return;
          const text = event.clipboardData.getData("text/plain");
          if (text.length < pasteCharacters) return;
          // Taken before it reaches the field, so a paste of any size never
          // has to be laid out as text.
          event.preventDefault();
          void keep(text);
        }}
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
      {(attachments.length > 0 || keeping > 0) && (
        <div className={styles.composer__attachments}>
          {attachments.map((attachment) => (
            <PastedText
              key={attachment.id}
              attachment={attachment}
              {...(openAttachment ? { onOpen: openAttachment } : {})}
              onRemove={(id) =>
                setAttachments((current) =>
                  current.filter((item) => item.id !== id),
                )
              }
            />
          ))}
          {keeping > 0 && <span role="status">Keeping the pasted text…</span>}
        </div>
      )}
      {message.trim().length > typedMessageCharacters && (
        <p className={styles.composer__note} role="status">
          Longer than 50,000 characters: it will be sent as a file Zhiyin reads
          in parts.
        </p>
      )}
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
          {context && (
            <ContextRing
              {...context}
              draftTokens={estimatedTokens(message)}
              disabled={sending}
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
            disabled={
              Boolean(disabledReason) ||
              keeping > 0 ||
              (!message.trim() && !attachments.length)
            }
          >
            <Icon name="arrow-up" />
          </button>
        )}
      </div>
    </form>
  );
}
