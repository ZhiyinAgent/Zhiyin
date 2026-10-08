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
  attachablePictureTypes,
  picturesPerMessage,
  typedMessageCharacters,
  utf8Bytes,
} from "@zhiyin/contract";
import { AttachedPicture } from "./AttachedPicture.js";
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
/** Past this, a paste is refused; the store keeps nothing larger. */
const pasteBytes = 50 * 1024 * 1024;

const cannotSee =
  "This model can't see pictures. Choose one that can, or describe what's in it.";

/** `pasted-2026-10-02-140512.png`: a picture from the clipboard has no name. */
function pastedPictureName(now: Date, mediaType: string): string {
  const two = (value: number) => String(value).padStart(2, "0");
  const extension =
    { "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[
      mediaType
    ] ?? "png";
  return `pasted-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}.${extension}`;
}

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Not read."));
    reader.readAsDataURL(file);
  });
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
  /** Each picture as this composer read it, to show before it is sent. */
  const [previews, setPreviews] = useState<Readonly<Record<string, string>>>(
    {},
  );
  /** Pictures on the message or on their way to it, counted as they come. */
  const pictures = useRef(0);
  const chooser = useRef<HTMLInputElement>(null);

  /**
   * One way in for a pasted, a dropped and a chosen picture. Nothing offered is
   * dropped silently: what is left out, and why, is said.
   */
  function addPictures(files: readonly File[], pasted: boolean) {
    if (!files.length) return;
    setError("");
    if (!seesPictures || !keepPicture) {
      setError(cannotSee);
      return;
    }
    const usable = files.filter((file) =>
      attachablePictureTypes.includes(file.type),
    );
    const room = Math.max(0, picturesPerMessage - pictures.current);
    const taken = usable.slice(0, room);
    const problems = [
      ...files
        .filter((file) => !usable.includes(file))
        .map(
          (file) =>
            `${file.name} was left out: only PNG, JPEG, GIF and WebP pictures can be attached.`,
        ),
      ...(usable.length > taken.length
        ? [`A message can carry at most ${picturesPerMessage} pictures.`]
        : []),
    ];
    if (problems.length) setError(problems.join(" "));
    pictures.current += taken.length;
    for (const file of taken) void keepOne(file, pasted, keepPicture);
  }

  async function keepOne(
    file: File,
    pasted: boolean,
    keep: NonNullable<ComposerProps["keepPicture"]>,
  ) {
    const name = pasted ? pastedPictureName(new Date(), file.type) : file.name;
    setKeeping((count) => count + 1);
    try {
      const read = await dataUrl(file);
      const kept = await keep({
        name,
        mediaType: file.type,
        data: read.slice(read.indexOf(",") + 1),
      });
      if (kept.status === "kept") {
        setAttachments((current) => [...current, kept.attachment]);
        setPreviews((current) => ({ ...current, [kept.attachment.id]: read }));
        return;
      }
      pictures.current -= 1;
      setError(`${name} was not added: ${kept.reason}`);
    } catch {
      pictures.current -= 1;
      setError(`${name} could not be added. Try again.`);
    } finally {
      setKeeping((count) => count - 1);
    }
  }

  function remove(id: string) {
    setAttachments((current) => {
      const next = current.filter((item) => item.id !== id);
      pictures.current = next.filter((item) => item.kind === "picture").length;
      return next;
    });
  }

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
    pictures.current = (draft.attachments ?? []).filter(
      (item) => item.kind === "picture",
    ).length;
    setError("");
  }, [draft]);

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
      pictures.current = 0;
      try {
        if (sent.length)
          await onSubmit?.(value, capabilities ? reasoning : undefined, sent);
        else if (capabilities) await onSubmit?.(value, reasoning);
        else await onSubmit?.(value);
      } catch {
        setMessage(typed);
        setAttachments(kept);
        pictures.current = kept.filter(
          (item) => item.kind === "picture",
        ).length;
        setError("Your message could not be sent. It is still here.");
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
        addPictures(Array.from(event.dataTransfer.files), false);
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
          if (files.length && keepPicture) {
            event.preventDefault();
            addPictures(files, true);
            return;
          }
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
          {attachments.map((attachment) =>
            attachment.kind === "picture" ? (
              <AttachedPicture
                key={attachment.id}
                attachment={attachment}
                {...(previews[attachment.id]
                  ? { preview: previews[attachment.id] }
                  : {})}
                {...(readPicture ? { readPicture } : {})}
                onRemove={remove}
              />
            ) : (
              <PastedText
                key={attachment.id}
                attachment={attachment}
                {...(openAttachment ? { onOpen: openAttachment } : {})}
                onRemove={remove}
              />
            ),
          )}
          {keeping > 0 && <span role="status">Keeping what you added…</span>}
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
          {keepPicture && (
            <>
              <button
                type="button"
                aria-label="Attach pictures"
                disabled={Boolean(disabledReason) || !seesPictures}
                {...(seesPictures
                  ? {}
                  : {
                      title:
                        "This model can't see pictures. Choose one that can in Model.",
                    })}
                onClick={() => chooser.current?.click()}
              >
                <Icon name="image" />
              </button>
              <input
                ref={chooser}
                type="file"
                accept={attachablePictureTypes.join(",")}
                multiple
                hidden
                aria-label="Pictures to attach"
                onChange={(event) => {
                  addPictures(Array.from(event.target.files ?? []), false);
                  event.target.value = "";
                }}
              />
            </>
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
        {running && !message.trim() && !attachments.length ? (
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
