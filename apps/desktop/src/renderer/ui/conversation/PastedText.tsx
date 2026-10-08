import type { PastedTextAttachment } from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./conversation.module.css";

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A long paste, shown as the file it was kept as rather than as its text. It
 * opens in the person's own editor; in the composer it can also be taken off.
 */
export function PastedText({
  attachment,
  onOpen,
  onRemove,
}: {
  attachment: PastedTextAttachment;
  onOpen?: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  return (
    <span className={styles["pasted-text"]}>
      <button
        type="button"
        aria-label={`Open pasted text ${attachment.id}`}
        disabled={!onOpen}
        onClick={() => onOpen?.(attachment.id)}
      >
        <Icon name="file" />
        <span className={styles["pasted-text__name"]}>{attachment.id}</span>
        <span className={styles["pasted-text__size"]}>
          {readableSize(attachment.bytes)} ·{" "}
          {attachment.lines.toLocaleString("en-US")} lines
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label="Remove pasted text"
          onClick={() => onRemove(attachment.id)}
        >
          <Icon name="x" />
        </button>
      )}
    </span>
  );
}
