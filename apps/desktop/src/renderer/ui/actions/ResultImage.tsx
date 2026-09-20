import { useEffect, useState } from "react";
import type { ActionDetail, CoreApi } from "@zhiyin/contract";
import styles from "./actions.module.css";

type ImageDetail = Extract<ActionDetail, { kind: "image" }>;
type ReadPicture = NonNullable<CoreApi["readPicture"]>;

/**
 * A picture an action produced, shown as a picture.
 *
 * It is drawn small enough to sit in a record of what happened and opens to
 * the size it was taken at, because a screenshot scaled into a column is
 * evidence nobody can actually read.
 *
 * The record names the picture rather than carrying it, so the bytes are asked
 * for when there is something to draw them into — a conversation with fifty
 * screenshots in it does not put fifty screenshots in the renderer's memory to
 * show one row of history.
 *
 * A picture that is gone, or will not decode, says so. A broken frame beside
 * the words "what it did" reads as though the action failed, which is a
 * different claim.
 */
export function ResultImage({
  detail,
  readPicture,
}: {
  detail: ImageDetail;
  readPicture?: ReadPicture;
}) {
  const [full, setFull] = useState(false);
  const [broken, setBroken] = useState(false);
  const [source, setSource] = useState<string>();
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!readPicture) return;
    let current = true;
    void readPicture(detail.source)
      .then((picture) => {
        if (!current) return;
        if (picture.status === "ready")
          setSource(`data:${picture.mediaType};base64,${picture.data}`);
        else setGone(true);
      })
      .catch(() => current && setGone(true));
    return () => {
      current = false;
    };
  }, [detail.source, readPicture]);

  useEffect(() => {
    if (!full) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setFull(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [full]);

  return (
    <section className={`${styles.inspector__block} ${styles["result-image"]}`}>
      <h3>{detail.label}</h3>
      {broken || gone ? (
        <p className={styles.inspector__note}>
          This picture could not be shown. The action still ran.
        </p>
      ) : !source ? (
        <p className={styles.inspector__note}>Opening the picture…</p>
      ) : (
        <>
          <img
            className={styles["result-image__frame"]}
            src={source}
            alt={detail.alt}
            onError={() => setBroken(true)}
          />
          <button
            className="text-button"
            type="button"
            onClick={() => setFull(true)}
          >
            See it full size
          </button>
        </>
      )}
      {full && !broken && source && (
        <div
          className={styles["result-image__scrim"]}
          role="dialog"
          aria-modal="true"
          aria-label={detail.alt}
          onMouseDown={() => setFull(false)}
        >
          <img src={source} alt={detail.alt} />
        </div>
      )}
    </section>
  );
}
