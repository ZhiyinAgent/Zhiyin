import type { LookId, LookStrength } from "@zhiyin/contract";
import { Logo } from "../shared/index.js";
import styles from "./onboarding.module.css";

/**
 * A small window wearing a look: the side column with its picture, the
 * ground with its picture, a message and the composer. It is drawn at the
 * window's own sizes and scaled down, and it reads the same variables the
 * window does, so it shows any listed look as that look draws itself.
 */
export function LookMiniature({
  look,
  strength,
}: {
  look: LookId;
  strength: LookStrength;
}) {
  return (
    <span
      className={styles["miniature"]}
      data-look={look}
      data-look-strength={strength}
      aria-hidden="true"
    >
      <span className={styles["miniature__window"]}>
        <span className={styles["miniature__side"]}>
          <Logo compact size={34} />
          <span className={styles["miniature__row"]} />
          <span
            className={`${styles["miniature__row"]} ${styles["miniature__row--short"]}`}
          />
          <span className={styles["miniature__row"]} />
          <span className={styles["miniature__side-picture"]} />
        </span>
        <span className={styles["miniature__main"]}>
          <span className={styles["miniature__ground"]} />
          <span className={styles["miniature__bubble"]} />
          <span className={styles["miniature__line"]} />
          <span
            className={`${styles["miniature__line"]} ${styles["miniature__line--short"]}`}
          />
          <span className={styles["miniature__composer"]} />
        </span>
      </span>
    </span>
  );
}
