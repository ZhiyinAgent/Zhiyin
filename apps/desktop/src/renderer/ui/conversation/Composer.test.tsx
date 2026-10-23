import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  MessageAttachment,
  ReasoningCapabilities,
} from "@zhiyin/contract";
import { Composer } from "./Composer.js";

const reasoning: ReasoningCapabilities = {
  status: "available",
  required: false,
  defaultEnabled: true,
  defaultEffort: "medium",
  efforts: ["low", "medium", "high"],
};

describe("Composer", () => {
  it("loads each restored draft once without overwriting later edits", () => {
    const { rerender } = render(
      <Composer draft={{ id: "rewind-1", text: "Original request" }} />,
    );
    const composer = screen.getByRole("textbox", { name: "Message Zhiyin" });
    expect(composer).toHaveValue("Original request");

    fireEvent.change(composer, { target: { value: "Edited request" } });
    rerender(<Composer draft={{ id: "rewind-1", text: "Original request" }} />);
    expect(composer).toHaveValue("Edited request");

    rerender(<Composer draft={{ id: "rewind-2", text: "Earlier request" }} />);
    expect(composer).toHaveValue("Earlier request");
  });

  it("shows the context already used, not what the message being written would add", () => {
    render(
      <Composer
        context={{
          model: {
            model: "wide",
            contextWindow: 1_000_000,
            maximumOutputTokens: 131_072,
          },
          budget: "medium",
          onChoose: () => {},
        }}
      />,
    );
    const ring = screen.getByRole("button", { name: /^Context/ });
    expect(ring).toHaveAccessibleName("Context: 0% of the Medium budget");

    fireEvent.change(screen.getByRole("textbox", { name: "Message Zhiyin" }), {
      target: { value: "word ".repeat(40_000) },
    });
    expect(ring).toHaveAccessibleName("Context: 0% of the Medium budget");
  });

  it("accepts guidance while a response is in progress", () => {
    const onSubmit = vi.fn();
    render(<Composer running onSubmit={onSubmit} />);

    const field = screen.getByRole("textbox", { name: "Message Zhiyin" });
    expect(field).toBeEnabled();
    expect(field).toHaveAttribute("placeholder", "Add to current work");

    fireEvent.change(field, { target: { value: "Use the newer file" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("Use the newer file");
  });

  it("keeps the settings and stop controls usable while a response is in progress", () => {
    const onStop = vi.fn();
    const onAddContext = vi.fn();
    render(
      <Composer
        running
        onStop={onStop}
        onAddContext={onAddContext}
        reasoningCapabilities={reasoning}
      />,
    );

    const stop = screen.getByRole("button", { name: "Stop task" });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledOnce();

    const settings = screen.getByRole("button", { name: "Reasoning settings" });
    expect(settings).toBeEnabled();
    fireEvent.click(settings);
    expect(screen.getByRole("dialog", { name: "Reasoning" })).toBeVisible();

    const addContext = screen.getByRole("button", { name: "Add context" });
    expect(addContext).toBeEnabled();
    fireEvent.click(addContext);
    expect(onAddContext).toHaveBeenCalledOnce();
  });

  it("closes the reasoning settings when the person clicks away, or the window loses focus", () => {
    render(<Composer reasoningCapabilities={reasoning} />);
    const settings = screen.getByRole("button", { name: "Reasoning settings" });

    fireEvent.click(settings);
    fireEvent.pointerDown(screen.getByRole("dialog", { name: "Reasoning" }));
    expect(screen.getByRole("dialog", { name: "Reasoning" })).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Reasoning" })).toBeNull();

    fireEvent.click(settings);
    fireEvent.blur(window);
    expect(screen.queryByRole("dialog", { name: "Reasoning" })).toBeNull();
  });

  it("keeps every control unavailable while the composer itself is paused", () => {
    render(
      <Composer
        disabledReason="Answer the permission request first"
        onAddContext={() => undefined}
        reasoningCapabilities={reasoning}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Message Zhiyin" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add context" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Reasoning settings" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(
      screen.getByText("Answer the permission request first"),
    ).toBeVisible();
  });

  it("says nothing about the keyboard when there is nothing to explain", () => {
    render(<Composer />);

    expect(screen.queryByText(/Enter to send/)).toBeNull();
    expect(screen.queryByText(/Shift\+Enter/)).toBeNull();
  });

  it("keeps a long paste as an attachment rather than putting it in the field", async () => {
    const onSubmit = vi.fn();
    const keepPaste = vi.fn(async () => ({
      status: "kept" as const,
      attachment: paste,
    }));
    render(<Composer onSubmit={onSubmit} keepPaste={keepPaste} />);
    const field = screen.getByRole("textbox", { name: "Message Zhiyin" });
    const long = "log line\n".repeat(2_000);

    const inserted = fireEvent.paste(field, pasted(long));

    expect(inserted).toBe(false);
    expect(keepPaste).toHaveBeenCalledWith(long);
    expect(
      await screen.findByRole("button", { name: /Open pasted text/ }),
    ).toHaveTextContent("47 KB · 1,200 lines");
    expect(field).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith("", undefined, [paste]),
    );
    expect(
      screen.queryByRole("button", { name: /Open pasted text/ }),
    ).toBeNull();
  });

  it("sends a message typed past a tenth of the smallest budget as a file when no budget is known, and says so before it is sent", async () => {
    const onSubmit = vi.fn();
    const keepPaste = vi.fn(async () => ({
      status: "kept" as const,
      attachment: paste,
    }));
    render(<Composer onSubmit={onSubmit} keepPaste={keepPaste} />);
    const field = screen.getByRole("textbox", { name: "Message Zhiyin" });
    // A tenth of a 96,000-token budget, at three characters a token.
    const long = "a".repeat(28_801);

    fireEvent.change(field, { target: { value: "a".repeat(28_800) } });
    expect(screen.queryByText(/will be sent as a file/)).toBeNull();
    fireEvent.change(field, { target: { value: long } });
    expect(
      screen.getByText(
        /Longer than about 9,600 tokens, a tenth of the budget: it will be sent as a file/,
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith("", undefined, [paste]),
    );
    expect(keepPaste).toHaveBeenCalledWith(long);
    expect(field).toHaveValue("");
  });

  it("measures a message in estimated tokens, so one in Chinese gets the same share as one in English", async () => {
    const onSubmit = vi.fn();
    const keepPaste = vi.fn(async () => ({
      status: "kept" as const,
      attachment: paste,
    }));
    render(<Composer onSubmit={onSubmit} keepPaste={keepPaste} />);
    const field = screen.getByRole("textbox", { name: "Message Zhiyin" });
    // A tenth of a 96,000-token budget: 9,600 characters of Chinese, each
    // counted as about one token.
    const long = "中".repeat(9_601);

    fireEvent.change(field, { target: { value: "中".repeat(9_600) } });
    expect(screen.queryByText(/will be sent as a file/)).toBeNull();
    fireEvent.change(field, { target: { value: long } });
    expect(screen.getByText(/will be sent as a file/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith("", undefined, [paste]),
    );
    expect(keepPaste).toHaveBeenCalledWith(long);
  });

  it("sends as text a message that fits a tenth of the budget chosen, however long", async () => {
    const onSubmit = vi.fn();
    const keepPaste = vi.fn();
    render(
      <Composer
        onSubmit={onSubmit}
        keepPaste={keepPaste}
        context={{
          model: { model: "wide", contextWindow: 1_000_000 },
          budget: "ultra",
          onChoose: () => {},
        }}
      />,
    );
    const field = screen.getByRole("textbox", { name: "Message Zhiyin" });
    // Ultra holds this model's requests under 850,000 tokens.
    const long = "a".repeat(255_000);

    fireEvent.change(field, { target: { value: long } });
    expect(screen.queryByText(/will be sent as a file/)).toBeNull();
    fireEvent.change(field, { target: { value: `${long}a` } });
    expect(screen.getByText(/Longer than about 85,000 tokens/)).toBeVisible();
    fireEvent.change(field, { target: { value: long } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(long));
    expect(keepPaste).not.toHaveBeenCalled();
  });

  it("keeps a long typed message in the field when it cannot be kept as a file", async () => {
    const onSubmit = vi.fn();
    const keepPaste = vi.fn(async () => ({
      status: "refused" as const,
      reason: "The disk is full.",
    }));
    render(<Composer onSubmit={onSubmit} keepPaste={keepPaste} />);
    const field = screen.getByRole("textbox", { name: "Message Zhiyin" });
    const long = "a".repeat(28_801);
    fireEvent.change(field, { target: { value: long } });

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The disk is full.",
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(field).toHaveValue(long);
  });

  it("never puts a 10 MB paste in the field", async () => {
    const keepPaste = vi.fn(async () => ({
      status: "kept" as const,
      attachment: { ...paste, bytes: 10 * 1024 * 1024 },
    }));
    render(<Composer keepPaste={keepPaste} />);
    const field = screen.getByRole("textbox", { name: "Message Zhiyin" });

    const inserted = fireEvent.paste(
      field,
      pasted("x".repeat(10 * 1024 * 1024)),
    );

    expect(inserted).toBe(false);
    expect(
      await screen.findByRole("button", { name: /Open pasted text/ }),
    ).toHaveTextContent("10.0 MB");
    expect(field).toHaveValue("");
  });

  it("leaves a short paste to the field", () => {
    const keepPaste = vi.fn();
    render(<Composer keepPaste={keepPaste} />);

    const inserted = fireEvent.paste(
      screen.getByRole("textbox", { name: "Message Zhiyin" }),
      pasted("a short note"),
    );

    expect(inserted).toBe(true);
    expect(keepPaste).not.toHaveBeenCalled();
  });

  it("opens a kept paste, and can take it off the message", async () => {
    const openAttachment = vi.fn();
    render(
      <Composer
        keepPaste={async () => ({ status: "kept", attachment: paste })}
        openAttachment={openAttachment}
      />,
    );
    fireEvent.paste(
      screen.getByRole("textbox", { name: "Message Zhiyin" }),
      pasted("x".repeat(15_000)),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /Open pasted text/ }),
    );
    expect(openAttachment).toHaveBeenCalledWith(paste.id);
    fireEvent.click(screen.getByRole("button", { name: "Remove pasted text" }));
    expect(
      screen.queryByRole("button", { name: /Open pasted text/ }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("refuses a paste over 50 MB and says what to do instead", () => {
    const keepPaste = vi.fn();
    render(<Composer keepPaste={keepPaste} />);

    fireEvent.paste(
      screen.getByRole("textbox", { name: "Message Zhiyin" }),
      pasted("x".repeat(50 * 1024 * 1024 + 1)),
    );

    expect(keepPaste).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "larger than 50 MB. Save it as a file",
    );
  });

  it("puts the pastes back with the words when a message could not be sent", async () => {
    render(
      <Composer
        onSubmit={async () => {
          throw new Error("offline");
        }}
        keepPaste={async () => ({ status: "kept", attachment: paste })}
      />,
    );
    fireEvent.paste(
      screen.getByRole("textbox", { name: "Message Zhiyin" }),
      pasted("x".repeat(15_000)),
    );
    await screen.findByRole("button", { name: /Open pasted text/ });

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be sent",
    );
    expect(
      screen.getByRole("button", { name: /Open pasted text/ }),
    ).toBeVisible();
  });

  it("shows and sends the model's default effort when the saved one is not offered", async () => {
    const submit = vi.fn();
    const { unmount } = render(
      <Composer
        initialReasoning={{ enabled: true, effort: "xhigh" }}
        reasoningCapabilities={reasoning}
        onSubmit={submit}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Reasoning settings" }),
    ).toHaveAttribute("data-tip", "Reasoning: Medium");
    fireEvent.change(screen.getByRole("textbox", { name: "Message Zhiyin" }), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("Hello", {
        enabled: true,
        effort: "medium",
      }),
    );
    unmount();

    // A model with reasoning on or off, and no efforts to choose from.
    render(
      <Composer
        initialReasoning={{ enabled: true, effort: "xhigh" }}
        reasoningCapabilities={{
          status: "available",
          required: false,
          defaultEnabled: true,
          efforts: [],
        }}
        onSubmit={submit}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Reasoning settings" }),
    ).toHaveAttribute("data-tip", "Reasoning: On");
    fireEvent.change(screen.getByRole("textbox", { name: "Message Zhiyin" }), {
      target: { value: "Again" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(submit).toHaveBeenLastCalledWith("Again", { enabled: true }),
    );
  });

  it("says why a message was refused, and keeps it", async () => {
    render(
      <Composer
        onSubmit={async () => {
          throw new Error(
            "The folder for this conversation could not be opened. Choose its new location, then send again.",
          );
        }}
      />,
    );
    const field = screen.getByRole("textbox", { name: "Message Zhiyin" });
    fireEvent.change(field, { target: { value: "Tidy the notes" } });

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your message could not be sent: The folder for this conversation could not be opened. Choose its new location, then send again. It is still here.",
    );
    expect(field).toHaveValue("Tidy the notes");
  });
});

const paste: MessageAttachment = {
  kind: "pastedText",
  id: "pasted-2026-09-24-101500.txt",
  bytes: 48_000,
  lines: 1_200,
};

function pasted(text: string) {
  return { clipboardData: { getData: () => text } };
}
