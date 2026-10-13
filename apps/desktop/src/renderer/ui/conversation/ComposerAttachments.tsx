/**
 * What the next message carries besides its words: long pastes kept as files,
 * and pictures. The composer holds the message; this holds what is attached
 * to it, takes what is pasted, dropped or chosen, and draws it.
 */

import { useCallback, useRef, useState } from "react";
import { Icon } from "../shared/index.js";
import type {
  CoreApi,
  MessageAttachment,
  PasteOutcome,
  PictureToKeep,
} from "@zhiyin/contract";
import {
  attachablePictureTypes,
  picturesPerMessage,
  utf8Bytes,
} from "@zhiyin/contract";
import { AttachedPicture } from "./AttachedPicture.js";
import { PastedText } from "./PastedText.js";
import styles from "./conversation.module.css";

/** Past this, a paste is refused; the store keeps nothing larger. */
const pasteBytes = 50 * 1024 * 1024;

const cannotSee =
  "This model can't see pictures. Choose one that can, or describe what's in it.";

/** `pasted-2026-10-02-140512.png`: a picture from the clipboard has no name. */
function pastedPictureName(now: Date, mediaType: string): string {
  const two = (value: number) => String(value).padStart(2, "0");
  const extension =
    { "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[
      mediaType
    ] ?? "png";
  return `pasted-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}.${extension}`;
}

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Not read."));
    reader.readAsDataURL(file);
  });
}

type KeepPicture = (picture: PictureToKeep) => Promise<PasteOutcome>;

/**
 * The attachments of the message being written, and the ways one is added:
 * a long paste, and a pasted, a dropped or a chosen picture. `say` is given
 * the composer's one line of trouble, and an empty line when there is none.
 */
export function useMessageAttachments({
  keepPaste,
  keepPicture,
  seesPictures,
  say,
}: {
  keepPaste: ((text: string) => Promise<PasteOutcome>) | undefined;
  keepPicture: KeepPicture | undefined;
  seesPictures: boolean;
  say: (trouble: string) => void;
}) {
  const [attachments, setAttachments] = useState<readonly MessageAttachment[]>(
    [],
  );
  const [keeping, setKeeping] = useState(0);
  /** Each picture as this composer read it, to show before it is sent. */
  const [previews, setPreviews] = useState<Readonly<Record<string, string>>>(
    {},
  );
  /** Pictures on the message or on their way to it, counted as they come. */
  const pictures = useRef(0);

  /**
   * One way in for a pasted, a dropped and a chosen picture. Nothing offered is
   * dropped silently: what is left out, and why, is said.
   */
  function addPictures(files: readonly File[], pasted: boolean) {
    if (!files.length) return;
    say("");
    if (!seesPictures || !keepPicture) {
      say(cannotSee);
      return;
    }
    const usable = files.filter((file) =>
      attachablePictureTypes.includes(file.type),
    );
    const room = Math.max(0, picturesPerMessage - pictures.current);
    const taken = usable.slice(0, room);
    const problems = [
      ...files
        .filter((file) => !usable.includes(file))
        .map(
          (file) =>
            `${file.name} was left out: only PNG, JPEG, GIF and WebP pictures can be attached.`,
        ),
      ...(usable.length > taken.length
        ? [`A message can carry at most ${picturesPerMessage} pictures.`]
        : []),
    ];
    if (problems.length) say(problems.join(" "));
    pictures.current += taken.length;
    for (const file of taken) void keepOne(file, pasted, keepPicture);
  }

  async function keepOne(file: File, pasted: boolean, keep: KeepPicture) {
    const name = pasted ? pastedPictureName(new Date(), file.type) : file.name;
    setKeeping((count) => count + 1);
    try {
      const read = await dataUrl(file);
      const kept = await keep({
        name,
        mediaType: file.type,
        data: read.slice(read.indexOf(",") + 1),
      });
      if (kept.status === "kept") {
        setAttachments((current) => [...current, kept.attachment]);
        setPreviews((current) => ({ ...current, [kept.attachment.id]: read }));
        return;
      }
      pictures.current -= 1;
      say(`${name} was not added: ${kept.reason}`);
    } catch {
      pictures.current -= 1;
      say(`${name} could not be added. Try again.`);
    } finally {
      setKeeping((count) => count - 1);
    }
  }

  function remove(id: string) {
    setAttachments((current) => {
      const next = current.filter((item) => item.id !== id);
      pictures.current = next.filter((item) => item.kind === "picture").length;
      return next;
    });
  }

  async function keepText(text: string) {
    if (!keepPaste) return;
    say("");
    if (utf8Bytes(text) > pasteBytes) {
      say(
        "This paste is larger than 50 MB. Save it as a file in the folder and ask about the file instead.",
      );
      return;
    }
    setKeeping((count) => count + 1);
    try {
      const kept = await keepPaste(text);
      if (kept.status === "kept")
        setAttachments((current) => [...current, kept.attachment]);
      else say(`The pasted text was not kept: ${kept.reason}`);
    } catch {
      say("The pasted text could not be kept. Try pasting it again.");
    } finally {
      setKeeping((count) => count - 1);
    }
  }

  /**
   * Puts these in place of what is attached: a draft's, those of a message
   * that could not be sent, or none.
   */
  const replace = useCallback((next: readonly MessageAttachment[]) => {
    setAttachments(next);
    pictures.current = next.filter((item) => item.kind === "picture").length;
  }, []);

  return {
    attachments,
    keeping,
    previews,
    addPictures,
    keepText,
    remove,
    replace,
  };
}

/** What is attached so far, each removable, and a word while more is kept. */
export function AttachmentStrip({
  attached: { attachments, keeping, previews, remove },
  readPicture,
  openAttachment,
}: {
  attached: Pick<
    ReturnType<typeof useMessageAttachments>,
    "attachments" | "keeping" | "previews" | "remove"
  >;
  readPicture: NonNullable<CoreApi["readPicture"]> | undefined;
  openAttachment: ((id: string) => void) | undefined;
}) {
  if (!(attachments.length > 0 || keeping > 0)) return null;
  return (
    <div className={styles.composer__attachments}>
      {attachments.map((attachment) =>
        attachment.kind === "picture" ? (
          <AttachedPicture
            key={attachment.id}
            attachment={attachment}
            {...(previews[attachment.id]
              ? { preview: previews[attachment.id] }
              : {})}
            {...(readPicture ? { readPicture } : {})}
            onRemove={remove}
          />
        ) : (
          <PastedText
            key={attachment.id}
            attachment={attachment}
            {...(openAttachment ? { onOpen: openAttachment } : {})}
            onRemove={remove}
          />
        ),
      )}
      {keeping > 0 && <span role="status">Keeping what you added…</span>}
    </div>
  );
}

/**
 * The button that offers pictures from the person's files, and the chooser
 * it opens. A model that cannot see pictures leaves it there, saying why.
 */
export function PictureChooser({
  disabled,
  seesPictures,
  onChoose,
}: {
  disabled: boolean;
  seesPictures: boolean;
  onChoose: (files: readonly File[]) => void;
}) {
  const chooser = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        aria-label="Attach pictures"
        disabled={disabled || !seesPictures}
        {...(seesPictures
          ? {}
          : {
              title:
                "This model can't see pictures. Choose one that can in Model.",
            })}
        onClick={() => chooser.current?.click()}
      >
        <Icon name="image" />
      </button>
      <input
        ref={chooser}
        type="file"
        accept={attachablePictureTypes.join(",")}
        multiple
        hidden
        aria-label="Pictures to attach"
        onChange={(event) => {
          onChoose(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </>
  );
}
