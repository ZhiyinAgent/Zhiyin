import { useEffect, useState } from "react";
import type { ActionDetail, CoreApi } from "@zhiyin/contract";
import { FullSizePicture } from "../../shared/index.js";
import common from "../actions.module.css";
import styles from "./action-history.module.css";

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
  readPicture?: ReadPicture | undefined;
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

  return (
    <section className={styles.inspector__block}>
      <h3>{detail.label}</h3>
      {broken || gone ? (
        <p className={styles.inspector__note}>
          This picture could not be shown. The action still ran.
        </p>
      ) : !source ? (
        <p className={styles.inspector__note}>Opening the picture…</p>
      ) : (
        // Named from what it holds, the picture's description and then what
        // it does, so a screen reader says both.
        <button
          className={styles["result-image__open"]}
          type="button"
          onClick={() => setFull(true)}
        >
          <img
            className={styles["result-image__frame"]}
            src={source}
            alt={detail.alt}
            onError={() => setBroken(true)}
          />
          <span className={common["visually-hidden"]}>, see it full size</span>
        </button>
      )}
      {full && !broken && source && (
        <FullSizePicture
          source={source}
          alt={detail.alt}
          onClose={() => setFull(false)}
        />
      )}
    </section>
  );
}
