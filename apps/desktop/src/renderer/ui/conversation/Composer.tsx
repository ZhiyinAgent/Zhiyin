import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../shared/index.js";
import type {
  CoreApi,
  MessageAttachment,
  PasteOutcome,
  PictureToKeep,
  ReasoningCapabilities,
  ReasoningSelection,
} from "@zhiyin/contract";
import {
  contextTarget,
  estimatedTokens,
  offeredReasoning,
  typedMessageTokens,
} from "@zhiyin/contract";
import {
  AttachmentStrip,
  PictureChooser,
  useMessageAttachments,
} from "./ComposerAttachments.js";
import { ContextRing } from "./ContextRing.js";
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
  /** Keeps a picture for the next message; absent, pictures are not offered. */
  keepPicture?: (picture: PictureToKeep) => Promise<PasteOutcome>;
  /** Whether the chosen model can see pictures. */
  seesPictures?: boolean;
  /** Shows a picture a restored draft carried. */
  readPicture?: NonNullable<CoreApi["readPicture"]>;
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
  context?: Omit<Parameters<typeof ContextRing>[0], "disabled">;
};

/** A paste this long is kept as a file and shown as a chip, not as text. */
const pasteCharacters = 15_000;

/**
 * The reasoning the next message asks for: what the person chose where the
 * model leaves it to them, and otherwise what the model does by default. A
 * saved effort the model does not offer is shown and sent as its default.
 */
function reasoningFor(
  capabilities:
    | Extract<ReasoningCapabilities, { readonly status: "available" }>
    | undefined,
  chosen: ReasoningSelection | undefined,
): ReasoningSelection {
  const selectedReasoning = offeredReasoning(capabilities, chosen);
  return capabilities &&
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
}

export function Composer({
  draft,
  disabledReason,
  disabledPlaceholder = "Composer paused",
  onSubmit,
  keepPaste,
  openAttachment,
  keepPicture,
  seesPictures = false,
  readPicture,
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
  const reasoning = reasoningFor(
    capabilities,
    reasoningDraft ?? initialReasoning,
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // The smallest budget when none is known: a message that fits it fits any.
  const typedLimit = typedMessageTokens(
    contextTarget(context?.budget ?? "low", context?.model ?? {}).targetTokens,
  );
  const sentAsFile = estimatedTokens(message.trim()) > typedLimit;
  const attached = useMessageAttachments({
    keepPaste,
    keepPicture,
    seesPictures,
    say: setError,
  });
  const { attachments, keeping, replace } = attached;
  const submitting = useRef(false);
  const loadedDraftId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!draft || loadedDraftId.current === draft.id) return;
    loadedDraftId.current = draft.id;
    setMessage(draft.text);
    replace(draft.attachments ?? []);
    setError("");
  }, [draft, replace]);

  async function submit() {
    const typed = message.trim();
    const kept = attachments;
    if (
      (!typed && !kept.length) ||
      keeping ||
      disabledReason ||
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
      if (estimatedTokens(typed) > typedLimit) {
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
      replace([]);
      try {
        if (sent.length)
          await onSubmit?.(value, capabilities ? reasoning : undefined, sent);
        else if (capabilities) await onSubmit?.(value, reasoning);
        else await onSubmit?.(value);
      } catch (error) {
        setMessage(typed);
        replace(kept);
        const reason = error instanceof Error ? error.message.trim() : "";
        const sentence = /[.!?]$/.test(reason) ? reason : `${reason}.`;
        setError(
          reason
            ? `Your message could not be sent: ${sentence} It is still here.`
            : "Your message could not be sent. It is still here.",
        );
      }
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }

  return (
    /*
     * A running turn accepts guidance while Stop stays available.
     */
    <form
      className={`${styles.composer}${disabledReason ? ` ${styles["composer--disabled"]}` : ""}${running ? ` ${styles["composer--running"]}` : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onDragOver={(event) => {
        if (
          keepPicture &&
          Array.from(event.dataTransfer.types).includes("Files")
        )
          event.preventDefault();
      }}
      onDrop={(event) => {
        if (!keepPicture || !event.dataTransfer.files.length) return;
        event.preventDefault();
        attached.addPictures(Array.from(event.dataTransfer.files), false);
      }}
    >
      <textarea
        aria-label="Message Zhiyin"
        placeholder={
          running
            ? "Add to current work"
            : disabledReason
              ? disabledPlaceholder
              : "Ask anything. Start somewhere."
        }
        value={message}
        disabled={Boolean(disabledReason)}
        rows={1}
        onChange={(event) => setMessage(event.target.value)}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files ?? []).filter(
            (file) => file.type.startsWith("image/"),
          );
          const text = event.clipboardData.getData("text/plain");
          // Office apps put a picture of the cells or words copied beside
          // their text; a paste with text in it is the text.
          if (files.length && keepPicture && !text.trim()) {
            event.preventDefault();
            attached.addPictures(files, true);
            return;
          }
          if (!keepPaste) return;
          if (text.length < pasteCharacters) return;
          // Taken before it reaches the field, so a paste of any size never
          // has to be laid out as text.
          event.preventDefault();
          void attached.keepText(text);
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
      <AttachmentStrip
        attached={attached}
        readPicture={readPicture}
        openAttachment={openAttachment}
      />
      {sentAsFile && (
        <p className={styles.composer__note} role="status">
          Longer than about {typedLimit.toLocaleString("en-US")} tokens, a tenth
          of the budget: it will be sent as a file Zhiyin reads in parts.
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
          {keepPicture && (
            <PictureChooser
              disabled={Boolean(disabledReason)}
              seesPictures={seesPictures}
              onChoose={(files) => attached.addPictures(files, false)}
            />
          )}
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
          {context && <ContextRing {...context} disabled={sending} />}
          {disabledReason && <span>{disabledReason}</span>}
        </div>
        <SendOrStop
          running={running}
          empty={!message.trim() && !attachments.length}
          blocked={Boolean(disabledReason) || keeping > 0}
          onStop={onStop}
        />
      </div>
    </form>
  );
}

/**
 * The button that ends the footer. While a turn runs and nothing is written
 * it stops the turn; with something written it sends, as guidance if a turn
 * is running.
 */
function SendOrStop({
  running,
  empty,
  blocked,
  onStop,
}: {
  running: boolean;
  /** Nothing is typed and nothing is attached. */
  empty: boolean;
  /** The composer is paused, or something added is still being kept. */
  blocked: boolean;
  onStop: (() => void) | undefined;
}) {
  return running && empty ? (
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
      aria-label={running ? "Add to current work" : "Send message"}
      disabled={blocked || empty}
    >
      <Icon name="arrow-up" />
    </button>
  );
}
