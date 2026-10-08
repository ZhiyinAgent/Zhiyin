/**
 * The right-click menu at a point in the page: corrections first on an
 * underlined word, then editing in text, Copy for a selection elsewhere.
 */

/** What Chromium says about the point clicked. */
export type TextMenuRequest = {
  readonly editable: boolean;
  /** The underlined word clicked, or empty. */
  readonly misspelledWord: string;
  readonly suggestions: readonly string[];
  readonly selection: string;
  readonly can: {
    readonly cut: boolean;
    readonly copy: boolean;
    readonly paste: boolean;
    readonly selectAll: boolean;
  };
};

type EditAction = "cut" | "copy" | "paste" | "selectAll";

/** Each item as the person reads it, with what choosing it does. */
export type TextMenuItem =
  | { readonly kind: "replace"; readonly word: string; readonly label: string }
  /** Adds the word to the person's own dictionary. */
  | { readonly kind: "learn"; readonly word: string; readonly label: string }
  /** Says there are no suggestions, and does nothing. */
  | { readonly kind: "none"; readonly label: string }
  | {
      readonly kind: "edit";
      readonly action: EditAction;
      readonly label: string;
      readonly enabled: boolean;
    }
  | { readonly kind: "separator" };

const editLabels: Readonly<Record<EditAction, string>> = {
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  selectAll: "Select all",
};

const edit = (action: EditAction, enabled: boolean): TextMenuItem => ({
  kind: "edit",
  action,
  label: editLabels[action],
  enabled,
});

/** As many as fit without the menu outgrowing what it corrects. */
const shownSuggestions = 5;

export function textMenu(request: TextMenuRequest): readonly TextMenuItem[] {
  if (!request.editable)
    return request.selection.trim() ? [edit("copy", true)] : [];
  const editing: TextMenuItem[] = [
    edit("cut", request.can.cut),
    edit("copy", request.can.copy),
    edit("paste", request.can.paste),
    { kind: "separator" },
    edit("selectAll", request.can.selectAll),
  ];
  if (!request.misspelledWord) return editing;
  const corrections: TextMenuItem[] = request.suggestions.length
    ? request.suggestions
        .slice(0, shownSuggestions)
        .map((word) => ({ kind: "replace", word, label: word }))
    : [{ kind: "none", label: "No suggestions" }];
  return [
    ...corrections,
    { kind: "separator" },
    {
      kind: "learn",
      word: request.misspelledWord,
      label: "Add to dictionary",
    },
    { kind: "separator" },
    ...editing,
  ];
}
