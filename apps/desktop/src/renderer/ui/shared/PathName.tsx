import styles from "./shared.module.css";

/**
 * A file path on one line that gives way where it matters least: the folder
 * first, then the middle of the file's name, never its end, so the extension
 * always shows. The folder is drawn quieter than the name, and the whole path
 * is named on hover.
 */
export function PathName({
  path,
  className,
}: {
  path: string;
  className?: string | undefined;
}) {
  const split = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
  const folder = path.slice(0, split);
  const name = path.slice(split);
  const extension = name.lastIndexOf(".");
  const tail = Math.min(
    name.length,
    (extension > 0 ? name.length - extension : 0) + 8,
  );
  return (
    <span
      className={`${styles["path-name"]}${className ? ` ${className}` : ""}`}
      data-tip={path}
      data-testid="path"
    >
      {folder && <span className={styles["path-name__folder"]}>{folder}</span>}
      <span className={styles["path-name__head"]}>
        {name.slice(0, name.length - tail)}
      </span>
      <span className={styles["path-name__tail"]}>
        {name.slice(name.length - tail)}
      </span>
    </span>
  );
}
