/**
 * Electron's spellchecker and menus, as the spelling feature asks for them.
 * Which items the right-click menu shows, and when, is the feature's.
 */

import { Menu, type BrowserWindow, type Session } from "electron";
import {
  textMenuAt,
  type SpellcheckEngine,
  type TextMenuItem,
} from "./composition.js";

/**
 * Made before the window, so the spellchecker reads no dictionary until the
 * person's choice is applied. Left alone, it starts on the app's language: it
 * would fetch that dictionary from Google where Windows has no spellchecker
 * for it, and report it before anything listens.
 */
export function electronSpellchecker(session: Session): SpellcheckEngine {
  session.setSpellCheckerEnabled(false);
  session.setSpellCheckerLanguages([]);
  return {
    setEnabled: (enabled) => session.setSpellCheckerEnabled(enabled),
    // Chromium reads, and so reports, only languages that differ from the ones
    // it has; emptying the list first has it read and report each one.
    setLanguages: (codes) => {
      session.setSpellCheckerLanguages([]);
      session.setSpellCheckerLanguages([...codes]);
    },
    onLanguage: (listener) => {
      session.on("spellcheck-dictionary-initialized", (_event, code) =>
        listener(code, "ready"),
      );
      session.on("spellcheck-dictionary-download-failure", (_event, code) =>
        listener(code, "unavailable"),
      );
    },
  };
}

/** Shows the right-click menu wherever the window is right-clicked. */
export function showTextMenus(window: BrowserWindow): void {
  const contents = window.webContents;
  contents.on("context-menu", (_event, point) => {
    const items = textMenuAt({
      editable: point.isEditable,
      misspelledWord: point.misspelledWord,
      suggestions: point.dictionarySuggestions,
      selection: point.selectionText,
      can: {
        cut: point.editFlags.canCut,
        copy: point.editFlags.canCopy,
        paste: point.editFlags.canPaste,
        selectAll: point.editFlags.canSelectAll,
      },
    });
    if (!items.length) return;
    const entry = (item: TextMenuItem): Electron.MenuItemConstructorOptions => {
      switch (item.kind) {
        case "replace":
          return {
            label: item.label,
            click: () => contents.replaceMisspelling(item.word),
          };
        case "learn":
          return {
            label: item.label,
            click: () =>
              contents.session.addWordToSpellCheckerDictionary(item.word),
          };
        case "none":
          return { label: item.label, enabled: false };
        case "edit":
          return {
            role: item.action,
            label: item.label,
            enabled: item.enabled,
          };
        case "separator":
          return { type: "separator" };
      }
    };
    Menu.buildFromTemplate(items.map(entry)).popup({ window });
  });
}
