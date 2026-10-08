import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { RewindPreview } from "@zhiyin/contract";
import { HoverTips } from "../shared/index.js";
import { RewindMessage } from "./RewindMessage.js";

const preview: RewindPreview = {
  id: "rewind-1",
  taskId: "task-1",
  messageId: "message-2",
  draft: "Change the second request",
  discardedMessages: 3,
  laterUserMessages: 1,
  discardedActions: [
    {
      id: "action-2",
      action: "Run a command",
      target: "pnpm test",
      status: "completed",
      sequence: 4,
    },
  ],
  files: [],
};

/** A rewind that loses only the selected message's own replies. */
const quiet: RewindPreview = {
  ...preview,
  discardedMessages: 2,
  laterUserMessages: 0,
  discardedActions: [],
  files: [],
};

type Props = Partial<Parameters<typeof RewindMessage>[0]> & {
  text?: string;
  reviewed?: RewindPreview;
};

/** The message as the conversation holds it, with its editing state. */
function Message({
  text = "Change the second request",
  reviewed,
  ...rest
}: Props) {
  const [editing, setEditing] = useState(false);
  return (
    <RewindMessage
      taskId="task-1"
      messageId="message-2"
      text={text}
      bubble={<p>{text}</p>}
      onPreview={async () => reviewed ?? preview}
      onCommit={async () => ({ files: [] })}
      onSend={async () => {}}
      editing={editing}
      onEditing={setEditing}
      {...rest}
    />
  );
}

function edit(to: string) {
  fireEvent.click(screen.getByRole("button", { name: "Edit this message" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Edit your message" }), {
    target: { value: to },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

describe("editing a message", () => {
  it("opens the message for editing where it is, with its words", () => {
    render(<Message />);

    fireEvent.click(screen.getByRole("button", { name: "Edit this message" }));

    const field = screen.getByRole("textbox", { name: "Edit your message" });
    expect(field).toHaveValue("Change the second request");
    expect(field).toHaveFocus();
  });

  it("leaves everything as it was when editing is cancelled, by button or Escape", () => {
    const preview = vi.fn(async () => quiet);
    render(<Message onPreview={preview} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit this message" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Change the second request")).toBeVisible();
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit this message" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(preview).not.toHaveBeenCalled();
  });

  it("sends the edited words at once when going back loses only this message's replies", async () => {
    const commit = vi.fn(async () => ({ files: [] }));
    const send = vi.fn(async () => {});
    render(<Message reviewed={quiet} onCommit={commit} onSend={send} />);

    edit("Change the third request");

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        { files: [] },
        "Change the third request",
      ),
    );
    expect(commit).toHaveBeenCalledWith("task-1", "rewind-1", "keep");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("sends with Enter and keeps Shift+Enter for a new line", async () => {
    const send = vi.fn(async () => {});
    render(<Message reviewed={quiet} onSend={send} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit this message" }));
    const field = screen.getByRole("textbox", { name: "Edit your message" });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(send).toHaveBeenCalled());
  });

  it("does not send an empty message", () => {
    render(<Message />);

    fireEvent.click(screen.getByRole("button", { name: "Edit this message" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  " } });

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("asks before going back, says what goes, and sends only once confirmed", async () => {
    const commit = vi.fn(async () => ({ files: [] }));
    const send = vi.fn(async () => {});
    render(<Message onCommit={commit} onSend={send} />);

    edit("Change it again");

    const dialog = await screen.findByRole("dialog", {
      name: "Go back to this message?",
    });
    expect(dialog).toHaveTextContent(
      "Everything after this message is removed, including your later message. Your edited message is then sent in its place.",
    );
    expect(dialog).toHaveTextContent("Run a command");
    expect(commit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Go back and send" }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ files: [] }, "Change it again"),
    );
    expect(commit).toHaveBeenCalledWith("task-1", "rewind-1", "keep");
  });

  it("keeps the edit open when going back is cancelled", async () => {
    const commit = vi.fn(async () => ({ files: [] }));
    render(<Message onCommit={commit} />);

    edit("Change it again");
    await screen.findByRole("dialog");
    fireEvent.click(
      screen.getByRole("button", { name: "Keep the conversation" }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("Change it again");
    expect(commit).not.toHaveBeenCalled();
  });

  it("puts files back only when asked, and says which cannot be", async () => {
    const commit = vi.fn(async () => ({ files: [] }));
    render(
      <Message
        reviewed={{
          ...preview,
          files: [
            { path: "note.txt", action: "restore", status: "recoverable" },
            { path: "manual.txt", action: "restore", status: "conflict" },
          ],
        }}
        onCommit={commit}
      />,
    );

    edit("Change it");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "You changed this file afterwards, so it is left as it is.",
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Put the files back as they were/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Go back and send" }));

    await waitFor(() =>
      expect(commit).toHaveBeenCalledWith("task-1", "rewind-1", "restore"),
    );
  });

  it("offers neither edit nor resend while a turn is running", () => {
    render(<Message disabled />);

    expect(
      screen.getByRole("button", { name: "Edit this message" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Resend this message" }),
    ).toBeDisabled();
  });

  it("names what each button does on hover", async () => {
    render(
      <>
        <HoverTips />
        <Message />
      </>,
    );

    fireEvent.pointerOver(
      screen.getByRole("button", { name: "Resend this message" }),
    );

    expect(await screen.findByText("Send again from here")).toBeInTheDocument();
  });
});

describe("resending a message", () => {
  function resend() {
    fireEvent.click(
      screen.getByRole("button", { name: "Resend this message" }),
    );
  }

  it("resends at once after a turn that only read and searched", async () => {
    const send = vi.fn(async () => {});
    render(
      <Message
        text="Summarise the notes"
        reviewed={{
          ...quiet,
          discardedActions: [readOnly("Read notes.md"), readOnly("Search")],
        }}
        onSend={send}
      />,
    );

    resend();

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({ files: [] }, "Summarise the notes"),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks before resending over a turn that called a connector, whatever the connector says it does", async () => {
    const commit = vi.fn(async () => ({ files: [] }));
    const send = vi.fn(async () => {});
    render(
      <Message
        text="Summarise the notes"
        reviewed={{
          ...quiet,
          discardedActions: [
            readOnly("Read notes.md"),
            {
              sequence: 1,
              id: "lookup",
              action: "Look up the weather",
              target: "Weather service",
              toolName: "lookup",
              status: "completed",
            },
          ],
        }}
        onCommit={commit}
        onSend={send}
      />,
    );

    resend();

    const dialog = await screen.findByRole("dialog", {
      name: "Go back to this message?",
    });
    expect(dialog).toHaveTextContent("Look up the weather");
    expect(dialog).toHaveTextContent(
      "Everything after this message is removed. It is then sent again.",
    );
    expect(commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Go back and resend" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
  });

  it("asks before removing later messages the person wrote", async () => {
    const send = vi.fn(async () => {});
    render(
      <Message
        reviewed={{ ...quiet, discardedMessages: 6, laterUserMessages: 2 }}
        onSend={send}
      />,
    );

    resend();

    expect(
      await screen.findByRole("dialog", { name: "Go back to this message?" }),
    ).toHaveTextContent("including 2 of your later messages");
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Go back and resend" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
  });
});

describe("going back over a command that changed files", () => {
  const converted: RewindPreview = {
    ...preview,
    discardedActions: [
      {
        id: "action-convert",
        action: "Run a command",
        target: "python convert.py",
        status: "completed",
        sequence: 4,
        commandChanges: {
          status: "checked",
          files: [
            { path: "out.csv", change: "created" },
            { path: "notes.md", change: "updated" },
          ],
        },
      },
    ],
  };

  async function goBack(reviewed: RewindPreview) {
    render(<Message reviewed={reviewed} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Resend this message" }),
    );
    return screen.findByRole("dialog", { name: "Go back to this message?" });
  }

  it("names each file the command changed as staying as it is, and counts them", async () => {
    const dialog = await goBack(converted);

    const listed = screen.getByRole("region", {
      name: "Changed while a command ran",
    });
    expect(listed).toHaveTextContent("out.csv");
    expect(listed).toHaveTextContent("notes.md");
    expect(listed).toHaveTextContent("No copy was kept, so it stays as it is.");
    expect(dialog).toHaveTextContent(
      "Files stay as they are, including the 2 files changed while a command ran.",
    );
  });

  it("says those files stay as they are even when others can be put back", async () => {
    await goBack({
      ...converted,
      files: [{ path: "draft.md", action: "restore", status: "recoverable" }],
    });

    expect(
      screen.getByRole("checkbox", { name: /Put the files back as they were/ }),
    ).toHaveAccessibleDescription(
      "Undoes 1 change Zhiyin made after this message. The 2 files changed while a command ran stay as they are.",
    );
  });

  it("says how many more changed than are listed, and when a command's changes could not be listed", async () => {
    await goBack({
      ...converted,
      discardedActions: [
        {
          ...converted.discardedActions[0]!,
          commandChanges: {
            status: "checked",
            files: [{ path: "out.csv", change: "created" }],
            more: 40,
          },
        },
        {
          id: "action-build",
          action: "Run a command",
          target: "make",
          status: "completed",
          sequence: 5,
          commandChanges: {
            status: "unchecked",
            reason: "The folder was too large to list.",
          },
        },
      ],
    });

    const listed = screen.getByRole("region", {
      name: "Changed while a command ran",
    });
    expect(listed).toHaveTextContent("and 40 more files");
    expect(listed).toHaveTextContent(
      "make: what it changed was not listed. The folder was too large to list.",
    );
  });
});

function readOnly(action: string): RewindPreview["discardedActions"][number] {
  return {
    sequence: 1,
    id: action,
    action,
    target: "",
    status: "completed",
    readOnly: true,
  };
}
