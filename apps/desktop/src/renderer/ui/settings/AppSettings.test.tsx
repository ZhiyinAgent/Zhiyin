import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";
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
      "Alerts you in another app when Zhiyin needs an answer or an approval, or finishes a long task.",
    );
    fireEvent.click(toggle);

    await waitFor(() => expect(onNotifications).toHaveBeenCalledWith(false));
  });

  it("turns reviews of studio work off with one switch, saying what they cost", async () => {
    const onStudioReviews = vi.fn(async () => undefined);
    render(
      <AppSettings
        notifications
        studioReviews
        onStudioReviews={onStudioReviews}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Long tasks" })).toBeVisible();
    const toggle = screen.getByRole("switch", {
      name: "Review 3D and CAD work",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAccessibleDescription(
      "Before a 3D or CAD task ends, a second model checks the result against what you asked, up to twice. This adds to the conversation's cost.",
    );
    fireEvent.click(toggle);

    await waitFor(() => expect(onStudioReviews).toHaveBeenCalledWith(false));
  });

  it("reviews on the conversation's model until the person chooses another, from a button that opens the choice", () => {
    const onChooseReviewerModel = vi.fn();
    render(
      <AppSettings
        notifications
        studioReviews
        onStudioReviews={vi.fn(async () => undefined)}
        onChooseReviewerModel={onChooseReviewerModel}
        onUseConversationModel={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />,
    );

    const choose = screen.getByRole("button", { name: "Choose…" });
    expect(choose).toHaveAccessibleDescription(
      "By default, the same model starting fresh. A model from another lab may catch different mistakes.",
    );
    expect(
      screen.queryByRole("button", { name: "Use the conversation's" }),
    ).toBeNull();
    fireEvent.click(choose);

    expect(onChooseReviewerModel).toHaveBeenCalledOnce();
  });

  it("names the model chosen for reviews, and goes back to the conversation's with one button", async () => {
    const onUseConversationModel = vi.fn(async () => undefined);
    render(
      <AppSettings
        notifications
        studioReviews
        onStudioReviews={vi.fn(async () => undefined)}
        reviewerModel="DeepSeek V4 on DeepSeek · Mainland China"
        onChooseReviewerModel={vi.fn()}
        onUseConversationModel={onUseConversationModel}
        onClose={vi.fn()}
      />,
    );

    const back = screen.getByRole("button", {
      name: "Use the conversation's",
    });
    expect(back).toHaveAccessibleDescription(
      "DeepSeek V4 on DeepSeek · Mainland China, whichever model the conversation uses.",
    );
    expect(screen.getByRole("button", { name: "Change…" })).toBeVisible();
    fireEvent.click(back);

    await waitFor(() => expect(onUseConversationModel).toHaveBeenCalledOnce());
  });

  it("offers no reviewer model while reviews are off", () => {
    render(
      <AppSettings
        notifications
        studioReviews={false}
        onStudioReviews={vi.fn(async () => undefined)}
        onChooseReviewerModel={vi.fn()}
        onUseConversationModel={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText("Reviewer model")).toBeNull();
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
      "Where your conversations, pictures and file copies are kept on this computer, exactly as sent to the model, including any passwords or keys the assistant used.",
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
      "Light, dark, or the same as Windows.",
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

describe("the look in settings", () => {
  it("offers every listed look by name, and saves the one chosen at the strength already set", async () => {
    const onLook = vi.fn(async () => undefined);
    render(
      <AppSettings
        notifications
        look={{ look: "ink", strength: "vivid" }}
        onLook={onLook}
        onClose={vi.fn()}
      />,
    );

    const looks = screen.getByRole("radiogroup", { name: "Look" });
    expect(
      within(looks)
        .getAllByRole("radio")
        .map((choice) => choice.closest("label")?.textContent),
    ).toEqual(["Neutral", "Ink", "Dots"]);
    expect(within(looks).getByRole("radio", { name: "Ink" })).toBeChecked();
    fireEvent.click(within(looks).getByRole("radio", { name: "Neutral" }));

    await waitFor(() =>
      expect(onLook).toHaveBeenCalledWith({
        look: "neutral",
        strength: "vivid",
      }),
    );
  });

  it("sets how strongly the look's pictures show, keeping the look", async () => {
    const onLook = vi.fn(async () => undefined);
    render(
      <AppSettings
        notifications
        look={{ look: "ink", strength: "default" }}
        onLook={onLook}
        onClose={vi.fn()}
      />,
    );

    const strengths = screen.getByRole("radiogroup", { name: "Strength" });
    expect(strengths).toHaveAccessibleDescription(
      "How strongly the look's pictures show.",
    );
    expect(
      within(strengths)
        .getAllByRole("radio")
        .map((choice) => choice.closest("label")?.textContent),
    ).toEqual(["Subtle", "Default", "Vivid"]);
    fireEvent.click(within(strengths).getByRole("radio", { name: "Subtle" }));

    await waitFor(() =>
      expect(onLook).toHaveBeenCalledWith({
        look: "ink",
        strength: "subtle",
      }),
    );
  });

  it("keeps the strength in its place under a look with no picture, switched off, saying why", () => {
    const onLook = vi.fn(async () => undefined);
    render(
      <AppSettings
        notifications
        look={{ look: "neutral", strength: "subtle" }}
        onLook={onLook}
        onClose={vi.fn()}
      />,
    );

    const strengths = screen.getByRole("radiogroup", { name: "Strength" });
    expect(strengths).toHaveAttribute("aria-disabled", "true");
    expect(strengths).toHaveAccessibleDescription(
      "Neutral has no picture to adjust. Choose Ink or Dots to set it.",
    );
    expect(
      within(strengths).getByRole("radio", { name: "Subtle" }),
    ).toBeChecked();
    fireEvent.click(within(strengths).getByRole("radio", { name: "Vivid" }));
    expect(onLook).not.toHaveBeenCalled();
  });

  it("says when the look was not saved, and keeps the one before", async () => {
    render(
      <AppSettings
        notifications
        look={{ look: "ink", strength: "default" }}
        onLook={async () => {
          throw new Error("The settings could not be saved.");
        }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Neutral" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The settings could not be saved.",
    );
    expect(screen.getByRole("radio", { name: "Ink" })).toBeChecked();
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
      "Underlines misspelled words as you type. Right-click one to correct it.",
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

describe("long tasks in settings", () => {
  const pauses = { rounds: 50, minutes: 30, dollars: 10, yuan: 70 };

  function settings(
    onWorkPauses: Mock<(next: typeof pauses) => Promise<void>> = vi.fn(
      async () => undefined,
    ),
  ) {
    render(
      <AppSettings
        notifications
        workPauses={pauses}
        onWorkPauses={onWorkPauses}
        onClose={vi.fn()}
      />,
    );
    return onWorkPauses;
  }

  it("shows when a long task stops to ask, each limit saying what it counts", () => {
    settings();

    expect(screen.getByRole("heading", { name: "Long tasks" })).toBeVisible();
    const rounds = screen.getByRole("spinbutton", {
      name: "Rounds of actions",
    });
    expect(rounds).toHaveValue(50);
    expect(rounds).toHaveAccessibleDescription(
      "Zhiyin asks whether to continue after this many rounds of actions. The limit doubles each time you continue.",
    );
    expect(screen.getByRole("spinbutton", { name: "Time" })).toHaveValue(30);
    expect(
      screen.getByRole("spinbutton", { name: "Spending in US dollars" }),
    ).toHaveValue(10);
    expect(
      screen.getByRole("spinbutton", { name: "Spending in yuan" }),
    ).toHaveValue(70);
  });

  it("saves a limit once it is typed and left, or entered", async () => {
    const onWorkPauses = settings();
    const rounds = screen.getByRole("spinbutton", {
      name: "Rounds of actions",
    });

    fireEvent.change(rounds, { target: { value: "120" } });
    expect(onWorkPauses).not.toHaveBeenCalled();
    fireEvent.blur(rounds);
    await waitFor(() =>
      expect(onWorkPauses).toHaveBeenCalledWith({ ...pauses, rounds: 120 }),
    );

    const yuan = screen.getByRole("spinbutton", { name: "Spending in yuan" });
    fireEvent.change(yuan, { target: { value: "200" } });
    fireEvent.keyDown(yuan, { key: "Enter" });
    await waitFor(() =>
      expect(onWorkPauses).toHaveBeenLastCalledWith({
        ...pauses,
        rounds: 120,
        yuan: 200,
      }),
    );
  });

  it("keeps both of two limits changed while the first is still being saved", async () => {
    let finish!: () => void;
    const onWorkPauses = vi
      .fn<(next: typeof pauses) => Promise<void>>()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (finish = resolve)),
      )
      .mockResolvedValue(undefined);
    settings(onWorkPauses);

    const rounds = screen.getByRole("spinbutton", {
      name: "Rounds of actions",
    });
    fireEvent.change(rounds, { target: { value: "120" } });
    fireEvent.blur(rounds);
    const minutes = screen.getByRole("spinbutton", { name: "Time" });
    fireEvent.change(minutes, { target: { value: "90" } });
    fireEvent.blur(minutes);
    finish();

    await waitFor(() =>
      expect(onWorkPauses).toHaveBeenLastCalledWith({
        ...pauses,
        rounds: 120,
        minutes: 90,
      }),
    );
  });

  it("keeps a limit still being saved when an earlier save reaches the window, and what saved when a later one fails", async () => {
    const finishes: (() => void)[] = [];
    const failures: ((cause: Error) => void)[] = [];
    const onWorkPauses = vi.fn<(next: typeof pauses) => Promise<void>>(
      () =>
        new Promise<void>((resolve, reject) => {
          finishes.push(resolve);
          failures.push(reject);
        }),
    );
    const view = (current: typeof pauses) => (
      <AppSettings
        notifications
        workPauses={current}
        onWorkPauses={onWorkPauses}
        onClose={vi.fn()}
      />
    );
    const { rerender } = render(view(pauses));
    const field = (name: string) => screen.getByRole("spinbutton", { name });

    fireEvent.change(field("Rounds of actions"), { target: { value: "120" } });
    fireEvent.blur(field("Rounds of actions"));
    fireEvent.change(field("Time"), { target: { value: "90" } });
    fireEvent.blur(field("Time"));
    // The rounds are saved and reach the window; the time is still saving.
    finishes[0]!();
    rerender(view({ ...pauses, rounds: 120 }));
    fireEvent.change(field("Spending in yuan"), { target: { value: "200" } });
    fireEvent.blur(field("Spending in yuan"));
    await waitFor(() => expect(onWorkPauses).toHaveBeenCalledTimes(3));
    expect(onWorkPauses).toHaveBeenLastCalledWith({
      ...pauses,
      rounds: 120,
      minutes: 90,
      yuan: 200,
    });

    // The time fails to save; the rounds that did save stay.
    failures[1]!(new Error("The settings could not be saved."));
    finishes[2]!();
    await screen.findByRole("alert");
    fireEvent.change(field("Spending in US dollars"), {
      target: { value: "20" },
    });
    fireEvent.blur(field("Spending in US dollars"));
    await waitFor(() => expect(onWorkPauses).toHaveBeenCalledTimes(4));
    expect(onWorkPauses).toHaveBeenLastCalledWith({
      ...pauses,
      rounds: 120,
      yuan: 200,
      dollars: 20,
    });
  });

  it("puts a limit whose second change failed back to its first, once the core has it", async () => {
    const finishes: (() => void)[] = [];
    const failures: ((cause: Error) => void)[] = [];
    const onWorkPauses = vi.fn<(next: typeof pauses) => Promise<void>>(
      () =>
        new Promise<void>((resolve, reject) => {
          finishes.push(resolve);
          failures.push(reject);
        }),
    );
    const view = (current: typeof pauses) => (
      <AppSettings
        notifications
        workPauses={current}
        onWorkPauses={onWorkPauses}
        onClose={vi.fn()}
      />
    );
    const { rerender } = render(view(pauses));
    const rounds = () =>
      screen.getByRole("spinbutton", { name: "Rounds of actions" });

    fireEvent.change(rounds(), { target: { value: "120" } });
    fireEvent.keyDown(rounds(), { key: "Enter" });
    fireEvent.change(rounds(), { target: { value: "150" } });
    fireEvent.keyDown(rounds(), { key: "Enter" });
    await waitFor(() => expect(onWorkPauses).toHaveBeenCalledTimes(2));
    finishes[0]!();
    rerender(view({ ...pauses, rounds: 120 }));
    failures[1]!(new Error("The settings could not be saved."));
    await screen.findByRole("alert");
    const dollars = screen.getByRole("spinbutton", {
      name: "Spending in US dollars",
    });
    fireEvent.change(dollars, { target: { value: "20" } });
    fireEvent.blur(dollars);

    await waitFor(() =>
      expect(onWorkPauses).toHaveBeenLastCalledWith({
        ...pauses,
        rounds: 120,
        dollars: 20,
      }),
    );
  });

  it("leaves a limit that failed to save out of the next one saved", async () => {
    const onWorkPauses = vi
      .fn<(next: typeof pauses) => Promise<void>>()
      .mockRejectedValueOnce(new Error("The settings could not be saved."))
      .mockResolvedValue(undefined);
    settings(onWorkPauses);

    const rounds = screen.getByRole("spinbutton", {
      name: "Rounds of actions",
    });
    fireEvent.change(rounds, { target: { value: "80" } });
    fireEvent.blur(rounds);
    await screen.findByRole("alert");
    const minutes = screen.getByRole("spinbutton", { name: "Time" });
    fireEvent.change(minutes, { target: { value: "90" } });
    fireEvent.blur(minutes);

    await waitFor(() =>
      expect(onWorkPauses).toHaveBeenLastCalledWith({ ...pauses, minutes: 90 }),
    );
  });

  it("refuses a limit outside its range, saying the range, and saves nothing", async () => {
    const onWorkPauses = settings();
    const minutes = screen.getByRole("spinbutton", { name: "Time" });

    for (const typed of ["2", "1500", "12.5", ""]) {
      fireEvent.change(minutes, { target: { value: typed } });
      fireEvent.keyDown(minutes, { key: "Enter" });
      expect(minutes).toHaveAttribute("aria-invalid", "true");
      expect(minutes).toHaveAccessibleDescription(
        expect.stringContaining("A whole number from 5 to 1,440."),
      );
    }
    fireEvent.keyDown(minutes, { key: "Escape" });

    expect(minutes).toHaveValue(30);
    expect(minutes).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("A whole number from 5 to 1,440.")).toBeNull();
    expect(onWorkPauses).not.toHaveBeenCalled();
  });

  it("saves nothing when a limit is left as it was", () => {
    const onWorkPauses = settings();
    const dollars = screen.getByRole("spinbutton", {
      name: "Spending in US dollars",
    });

    fireEvent.focus(dollars);
    fireEvent.blur(dollars);
    fireEvent.change(dollars, { target: { value: "11" } });
    fireEvent.change(dollars, { target: { value: "11" } });
    fireEvent.change(dollars, { target: { value: "10" } });
    fireEvent.blur(dollars);

    expect(onWorkPauses).not.toHaveBeenCalled();
    expect(dollars).toHaveValue(10);
  });

  it("says when a limit was not saved, and shows the one before", async () => {
    settings(
      vi.fn(async () => {
        throw new Error("The settings could not be saved.");
      }),
    );
    const rounds = screen.getByRole("spinbutton", {
      name: "Rounds of actions",
    });

    fireEvent.change(rounds, { target: { value: "80" } });
    fireEvent.blur(rounds);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The settings could not be saved.",
    );
    expect(rounds).toHaveValue(50);
  });
});
