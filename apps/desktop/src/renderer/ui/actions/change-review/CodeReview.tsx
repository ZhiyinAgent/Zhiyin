import { counted, visibleText } from "../../shared/index.js";
import common from "../actions.module.css";
import styles from "./change-review.module.css";

/** The lines of code as an editor numbers them: a final line break opens no line. */
export function codeLines(code: string): string[] {
  const lines = code.split(/\r\n|\r|\n/);
  return lines.length > 1 && lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

/**
 * Code too long to read on the card: past this, the card names it and its
 * review shows it whole. A short command stays where it is read at a glance.
 */
export function readOnItsOwn(code: string): boolean {
  return codeLines(code).length > 12 || code.length > 1_200;
}

/**
 * Code that will run, shown whole and numbered as its file is, so a line an
 * error names later is the line read here. Hidden characters are written out,
 * as everywhere a person approves something.
 */
export function CodeReview({ code }: { code: string }) {
  const lines = codeLines(code);
  return (
    <>
      <p className={styles["change-review__summary"]}>
        <span className={styles["change-review__path"]}>Code that runs</span>
        <span>{counted(lines.length, "line")}</span>
      </p>
      <table className={styles.diff}>
        <caption className={common["visually-hidden"]}>
          The code that runs, line by line
        </caption>
        <tbody>
          {lines.map((line, index) => (
            <tr className={styles.diff__row} key={index}>
              <td className={styles.diff__number}>{index + 1}</td>
              <td className={styles.diff__text}>
                <code>{visibleText(line) || " "}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
