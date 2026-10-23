import { useRef, useState } from "react";
import type { DocumentPlace } from "@zhiyin/contract";
import { Icon, useDismiss } from "../shared/index.js";
import styles from "./document.module.css";

/** The conversation's documents, to show another of them. */
export function DocumentMenu({
  documents,
  current,
  onShow,
}: {
  documents: readonly DocumentPlace[];
  current: string;
  onShow: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useDismiss(open, [container], () => setOpen(false));

  return (
    <div
      className={styles["document-menu"]}
      ref={container}
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape") return;
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }}
    >
      <button
        ref={button}
        className={styles["document-panel__icon-button"]}
        type="button"
        aria-label="Documents"
        aria-expanded={open}
        data-tip="This conversation's documents"
        onClick={() => setOpen((shown) => !shown)}
      >
        <Icon name="chevron" />
      </button>
      {open && (
        <ul
          className={styles["document-menu__list"]}
          aria-label="This conversation's documents"
        >
          {documents.map((item) => (
            <li key={item.path}>
              <button
                type="button"
                aria-current={item.path === current}
                onClick={() => {
                  setOpen(false);
                  if (item.path !== current) onShow(item.path);
                }}
              >
                <span>{item.name}</span>
                {item.folder && <small>{item.folder}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
