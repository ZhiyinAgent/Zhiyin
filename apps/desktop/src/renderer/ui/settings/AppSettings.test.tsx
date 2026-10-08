import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppSettings } from "./AppSettings.js";

describe("the app's settings", () => {
  it("turns notifications off with one switch that says what they are for", async () => {
    const onNotifications = vi.fn(async () => undefined);
    render(
      <AppSettings
        notifications
        onNotifications={onNotifications}
        onClose={vi.fn()}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "Notifications" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAccessibleDescription(
      "When Zhiyin needs your approval or an answer, or finishes a long task, while you are in another app.",
    );
    fireEvent.click(toggle);

    await waitFor(() => expect(onNotifications).toHaveBeenCalledWith(false));
  });

  it("says when the change was not saved, and keeps the switch as it was", async () => {
    render(
      <AppSettings
        notifications={false}
        onNotifications={async () => {
          throw new Error("The settings could not be saved.");
        }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Notifications" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The settings could not be saved.",
    );
    expect(
      screen.getByRole("switch", { name: "Notifications" }),
    ).toHaveAttribute("aria-checked", "false");
  });
});

describe("the data folder in settings", () => {
  it("opens with one button, saying plainly what it holds", async () => {
    const onOpenDataFolder = vi.fn(async () => undefined);
    render(
      <AppSettings
        notifications
        onOpenDataFolder={onOpenDataFolder}
        onClose={vi.fn()}
      />,
    );

    const open = screen.getByRole("button", { name: "Open data folder" });
    expect(open).toHaveAccessibleDescription(
      "Your conversations, pictures and file copies are kept here, exactly as sent to the model, including any passwords or keys the assistant used. This folder stays on this computer.",
    );
    fireEvent.click(open);

    await waitFor(() => expect(onOpenDataFolder).toHaveBeenCalledOnce());
  });

  it("says when the folder could not be opened", async () => {
    render(
      <AppSettings
        notifications
        onOpenDataFolder={async () => {
          throw new Error("The folder could not be opened.");
        }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open data folder" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The folder could not be opened.",
    );
  });
});

describe("the appearance in settings", () => {
  it("offers Match Windows, Light and Dark, and saves the one chosen", async () => {
    const onAppearance = vi.fn(async () => undefined);
    render(
      <AppSettings
        notifications
        appearance="system"
        onAppearance={onAppearance}
        onClose={vi.fn()}
      />,
    );

    const choices = screen.getByRole("radiogroup", { name: "Appearance" });
    expect(choices).toHaveAccessibleDescription(
      "Match Windows follows the light or dark mode set in Windows, and changes when it does.",
    );
    expect(
      within(choices)
        .getAllByRole("radio")
        .map((choice) => choice.closest("label")?.textContent),
    ).toEqual(["Match Windows", "Light", "Dark"]);
    expect(screen.getByRole("radio", { name: "Match Windows" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));

    await waitFor(() => expect(onAppearance).toHaveBeenCalledWith("light"));
  });

  it("says when the choice was not saved, and keeps the one before", async () => {
    render(
      <AppSettings
        notifications
        appearance="dark"
        onAppearance={async () => {
          throw new Error("The settings could not be saved.");
        }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Light" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The settings could not be saved.",
    );
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  });
});

describe("spelling in settings", () => {
  const offered = [
    { code: "de", name: "Deutsch", englishName: "German" },
    {
      code: "en-US",
      name: "American English",
      englishName: "American English",
    },
    { code: "fr", name: "Français", englishName: "French" },
  ];
  const checking = (
    languages: readonly {
      code: string;
      status: "loading" | "ready" | "unavailable";
    }[],
    enabled = true,
  ) => ({ enabled, languages, offered });

  it("turns spelling off with one switch, keeping the languages chosen", async () => {
    const onSpelling = vi.fn(async () => undefined);
    render(
      <AppSettings
        notifications
        spelling={checking([
          { code: "fr", status: "ready" },
          { code: "en-US", status: "ready" },
        ])}
        onSpelling={onSpelling}
        onClose={vi.fn()}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "Check spelling" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAccessibleDescription(
      "Underlines words that look misspelled as you type. Right-click one to correct it.",
    );
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(onSpelling).toHaveBeenCalledWith({
        enabled: false,
        languages: ["fr", "en-US"],
      }),
    );
  });

  it("adds a language from the list and removes one, but never the last", async () => {
    const onSpelling = vi.fn(async () => undefined);
    const { rerender } = render(
      <AppSettings
        notifications
        spelling={checking([
          { code: "fr", status: "ready" },
          { code: "en-US", status: "ready" },
        ])}
        onSpelling={onSpelling}
        onClose={vi.fn()}
      />,
    );

    const languages = screen.getByRole("list", { name: "Spelling languages" });
    expect(
      within(languages)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["French (Français)", "American English"]);
    const add = screen.getByRole("combobox", { name: "Add a language" });
    expect(
      within(add)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Add a language…", "German (Deutsch)"]);
    fireEvent.change(add, { target: { value: "de" } });
    await waitFor(() =>
      expect(onSpelling).toHaveBeenLastCalledWith({
        enabled: true,
        languages: ["fr", "en-US", "de"],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove French" }));
    await waitFor(() =>
      expect(onSpelling).toHaveBeenLastCalledWith({
        enabled: true,
        languages: ["en-US"],
      }),
    );

    rerender(
      <AppSettings
        notifications
        spelling={checking([{ code: "en-US", status: "ready" }])}
        onSpelling={onSpelling}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Remove American English" }),
    ).toBeDisabled();
  });

  it("says which language could not be loaded, and hides the languages while spelling is off", () => {
    const { rerender } = render(
      <AppSettings
        notifications
        spelling={checking([
          { code: "fr", status: "ready" },
          { code: "de", status: "unavailable" },
        ])}
        onSpelling={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />,
    );

    expect(
      within(screen.getByRole("list", { name: "Spelling languages" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["French (Français)", "German (Deutsch)Could not be loaded"]);

    rerender(
      <AppSettings
        notifications
        spelling={checking([{ code: "fr", status: "ready" }], false)}
        onSpelling={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("list", { name: "Spelling languages" }),
    ).toBeNull();
  });
});
