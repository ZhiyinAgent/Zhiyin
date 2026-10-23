import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../shared/index.js";
import { useGoingBack, type GoingBackProps } from "./goingBack.js";
import styles from "./rewind.module.css";

type RewindMessageProps = GoingBackProps & {
  /** The message as the conversation draws it; rewind adds its controls. */
  bubble: ReactNode;
  disabled?: boolean;
  /** Whether the message is open for editing, held by the conversation. */
  editing: boolean;
  onEditing: (editing: boolean) => void;
};

/**
 * A person's own message, which they can edit where it is or send again. Both
 * go back to it: what came after is removed and the words are sent in its
 * place, asking first when that removes more than this message's replies.
 */
export function RewindMessage({
  bubble,
  disabled = false,
  editing,
  onEditing,
  ...going
}: RewindMessageProps) {
  // Once gone back, the edited words are sent from where the message was.
  const { busy, send, question } = useGoingBack({
    ...going,
    onSend: async (result, words) => {
      onEditing(false);
      await going.onSend(result, words);
    },
  });
  const editButton = useRef<HTMLButtonElement>(null);

  return (
    <div className={styles.message}>
      {editing ? (
        <MessageEditor
          initial={going.text}
          busy={busy}
          onCancel={() => {
            onEditing(false);
            editButton.current?.focus();
          }}
          onSend={(words) => send("edit", words)}
        />
      ) : (
        <>
          {bubble}
          <div className={styles.actions}>
            <button
              ref={editButton}
              type="button"
              className={styles.action}
              aria-label="Edit this message"
              data-tip="Edit and send again from here"
              disabled={disabled || busy}
              onClick={() => onEditing(true)}
            >
              <Icon name="pencil" />
            </button>
            <button
              type="button"
              className={styles.action}
              aria-label="Resend this message"
              data-tip="Send again from here"
              disabled={disabled || busy}
              onClick={() => void send("resend")}
            >
              <Icon name="rewind" />
            </button>
          </div>
        </>
      )}
      {question}
    </div>
  );
}

/**
 * The message's words, open where the message was, as a conversation is
 * renamed in the sidebar. Enter sends and Shift+Enter starts a new line, as
 * in the message box; Escape puts the message back as it was.
 */
function MessageEditor({
  initial,
  busy,
  onCancel,
  onSend,
}: {
  initial: string;
  busy: boolean;
  onCancel: () => void;
  onSend: (words: string) => Promise<unknown>;
}) {
  const [words, setWords] = useState(initial);
  const field = useRef<HTMLTextAreaElement>(null);
  const empty = !words.trim();

  useEffect(() => {
    const box = field.current;
    if (!box) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, []);

  // The box grows with what is written, up to the cap its style sets.
  useEffect(() => {
    const box = field.current;
    if (!box) return;
    box.style.height = "auto";
    // Its border is outside what it scrolls, and inside the height it is given.
    box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`;
  }, [words]);

  function submit() {
    if (!empty && !busy) void onSend(words.trim());
  }

  return (
    <form
      className={styles.editor}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={field}
        aria-label="Edit your message"
        rows={1}
        value={words}
        disabled={busy}
        onChange={(event) => setWords(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className={styles.editorActions}>
        <button
          type="button"
          className="button button--quiet button--small"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="button button--accent button--small"
          disabled={empty || busy}
          {...(empty ? { "data-tip": "Write something first" } : {})}
        >
          Send
        </button>
      </div>
    </form>
  );
}
