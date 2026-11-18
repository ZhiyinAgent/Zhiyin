import type { PastedTextAttachment } from "@zhiyin/contract";
import { Icon } from "./Icon.js";
import { fileSize } from "./quantities.js";
import styles from "./shared.module.css";

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
  onOpen?: ((id: string) => void) | undefined;
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
          {fileSize(attachment.bytes)} ·{" "}
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
