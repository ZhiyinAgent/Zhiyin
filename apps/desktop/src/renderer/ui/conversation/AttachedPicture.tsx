import { useEffect, useState } from "react";
import type { CoreApi, PictureAttachment } from "@zhiyin/contract";
import { FullSizePicture, Icon } from "../shared/index.js";
import styles from "./conversation.module.css";

type ReadPicture = NonNullable<CoreApi["readPicture"]>;

/**
 * A picture the person attached, shown small with its name. It opens full
 * size; in the composer it can also be taken off. One no longer stored says
 * why, in place of a frame with nothing in it.
 */
export function AttachedPicture({
  attachment,
  preview,
  readPicture,
  onRemove,
}: {
  attachment: PictureAttachment;
  /** The picture as the composer read it, before it has been sent. */
  preview?: string;
  readPicture?: ReadPicture;
  onRemove?: (id: string) => void;
}) {
  const [stored, setStored] = useState<
    { readonly source: string } | { readonly gone: string }
  >();
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (preview || !readPicture || !attachment.source) return;
    let current = true;
    void readPicture(attachment.source)
      .then((picture) => {
        if (!current) return;
        setStored(
          picture.status === "ready"
            ? { source: `data:${picture.mediaType};base64,${picture.data}` }
            : { gone: picture.reason },
        );
      })
      .catch(() => {
        if (current) setStored({ gone: "This picture could not be read." });
      });
    return () => {
      current = false;
    };
  }, [attachment.source, preview, readPicture]);

  const source = preview ?? (stored && "source" in stored ? stored.source : "");
  return (
    <span className={styles["attached-picture"]}>
      {stored && "gone" in stored ? (
        <span className={styles["attached-picture__gone"]}>
          <Icon name="image" />
          <span>
            {attachment.name}: {stored.gone}
          </span>
        </span>
      ) : source ? (
        <button
          type="button"
          aria-label={`Open picture ${attachment.name}`}
          onClick={() => setFull(true)}
        >
          <img
            className={styles["attached-picture__thumbnail"]}
            src={source}
            alt=""
          />
          <span className={styles["attached-picture__name"]}>
            {attachment.name}
          </span>
        </button>
      ) : (
        <span className={styles["attached-picture__gone"]}>
          <Icon name="image" />
          <span>{attachment.name}</span>
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove picture ${attachment.name}`}
          onClick={() => onRemove(attachment.id)}
        >
          <Icon name="x" />
        </button>
      )}
      {full && source && (
        <FullSizePicture
          source={source}
          alt={attachment.name}
          onClose={() => setFull(false)}
        />
      )}
    </span>
  );
}
