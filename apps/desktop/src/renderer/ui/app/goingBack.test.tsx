import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyConversationLists, type CoreApi } from "@zhiyin/contract";
import { createWindowState } from "./windowState.js";
import { WindowShell } from "./WindowShell.js";
import { stubCommands } from "../../stubCommands.js";

describe("going back to a message", () => {
  it("edits a message where it is, then goes back and sends the new words, keeping what came before", async () => {
    const commitRewind = vi.fn(async () => ({ files: [] }));
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          selectedTaskId: "task-1",
          tasks: [
            {
              id: "task-1",
              title: "Draft a note",
              updatedLabel: "Now",
              updatedAt: "2026-10-05T09:00:00.000Z",
              ...emptyConversationLists,
              messages: [
                {
                  id: "message-1",
                  role: "user",
                  text: "Draft a note",
                  sequence: 0,
                },
                {
                  id: "message-2",
                  role: "assistant",
                  text: "Here is a draft.",
                  sequence: 1,
                },
                {
                  id: "message-3",
                  role: "user",
                  text: "Make it shorter",
                  sequence: 2,
                },
                {
                  id: "message-4",
                  role: "assistant",
                  text: "Shortened.",
                  sequence: 3,
                },
              ],
              phase: {
                kind: "completed",
                outcome: { title: "Done", summary: "The note is ready." },
              },
            },
          ],
        })}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          previewRewind: async () => ({
            id: "rewind-1",
            taskId: "task-1",
            messageId: "message-3",
            draft: "Make it shorter",
            discardedMessages: 2,
            laterUserMessages: 0,
            discardedActions: [],
            files: [],
          }),
          commitRewind,
          sendMessage,
        }}
      />,
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "Edit this message" })[1]!,
    );
    const field = screen.getByRole("textbox", { name: "Edit your message" });
    expect(field).toHaveValue("Make it shorter");
    expect(commitRewind).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "Make it much shorter" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        "task-1",
        "Make it much shorter",
        undefined,
      ),
    );
    expect(commitRewind).toHaveBeenCalledWith("task-1", "rewind-1", "keep");
    expect(screen.getByText("Here is a draft.")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Message Zhiyin" })).toHaveValue(
      "",
    );
  });

  it("sends an edited message with the pastes it carried", async () => {
    const paste = {
      kind: "pastedText" as const,
      id: "pasted-2026-09-24-101500.txt",
      bytes: 48_000,
      lines: 1_200,
    };
    const openAttachment = vi.fn<CoreApi["openAttachment"]>(async () => {});
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    render(
      <WindowShell
        state={createWindowState({
          connection: "ready",
          runtime: { tasks: "available", capabilities: "available" },
          selectedTaskId: "task-1",
          tasks: [
            {
              id: "task-1",
              title: "Read a log",
              updatedLabel: "Now",
              updatedAt: "2026-10-05T09:00:00.000Z",
              ...emptyConversationLists,
              messages: [
                {
                  id: "message-1",
                  role: "user",
                  text: "Summarise this",
                  attachments: [paste],
                  sequence: 0,
                },
                {
                  id: "message-2",
                  role: "assistant",
                  text: "A summary.",
                  sequence: 1,
                },
              ],
              phase: {
                kind: "completed",
                outcome: { title: "Done", summary: "Summarised." },
              },
            },
          ],
        })}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          previewRewind: async () => ({
            id: "rewind-1",
            taskId: "task-1",
            messageId: "message-1",
            draft: "Summarise this",
            discardedMessages: 2,
            laterUserMessages: 0,
            discardedActions: [],
            files: [],
          }),
          openAttachment,
          sendMessage,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit this message" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Edit your message" }),
      {
        target: { value: "Summarise this briefly" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        "task-1",
        "Summarise this briefly",
        undefined,
        [paste.id],
      ),
    );
  });

  it("resends a message whose reply was only text: the same words and pastes, with nothing left in the composer", async () => {
    const sendMessage = vi.fn<CoreApi["sendMessage"]>(async () => {});
    const commitRewind = vi.fn(async () => ({ files: [] }));
    render(
      <WindowShell
        state={answered()}
        dispatch={() => undefined}
        commands={{
          ...stubCommands,
          previewRewind: async () => onlyItsReply,
          commitRewind,
          sendMessage,
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Resend this message" }),
    );

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        "task-1",
        "Summarise this",
        { enabled: true, effort: "high" },
        [pasted.id],
      ),
    );
    expect(commitRewind).toHaveBeenCalledWith("task-1", "rewind-1", "keep");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message Zhiyin" })).toHaveValue(
      "",
    );
  });

  it("puts a resent message back in the composer, with its pastes, when it could not be sent", async () => {
    const dispatch = vi.fn();
    render(
      <WindowShell
        state={answered()}
        dispatch={dispatch}
        commands={{
          ...stubCommands,
          previewRewind: async () => onlyItsReply,
          sendMessage: async () => {
            throw new Error("No model is selected.");
          },
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Resend this message" }),
    );

    const field = screen.getByRole("textbox", { name: "Message Zhiyin" });
    await waitFor(() => expect(field).toHaveValue("Summarise this"));
    expect(
      within(field.closest("form")!).getByRole("button", {
        name: /Open pasted text/,
      }),
    ).toBeVisible();
    expect(dispatch).toHaveBeenCalledWith({
      type: "commandErrorShown",
      message:
        "The message was not sent again: No model is selected. It is back in the message box.",
    });
  });
});

const pasted = {
  kind: "pastedText" as const,
  id: "pasted-2026-10-01-101500.txt",
  bytes: 48_000,
  lines: 1_200,
};

/** One request with a pasted log, answered in words only. */
function answered() {
  return createWindowState({
    connection: "ready",
    runtime: { tasks: "available", capabilities: "available" },
    selectedTaskId: "task-1",
    tasks: [
      {
        id: "task-1",
        title: "Read a log",
        updatedLabel: "Now",
        updatedAt: "2026-10-05T09:00:00.000Z",
        ...emptyConversationLists,
        reasoning: { enabled: true, effort: "high" },
        messages: [
          {
            id: "message-1",
            role: "user",
            text: "Summarise this",
            attachments: [pasted],
            sequence: 0,
          },
          {
            id: "message-2",
            role: "assistant",
            text: "A summary.",
            sequence: 1,
          },
        ],
        phase: {
          kind: "completed",
          outcome: { title: "Done", summary: "Summarised." },
        },
      },
    ],
  });
}

const onlyItsReply = {
  id: "rewind-1",
  taskId: "task-1",
  messageId: "message-1",
  draft: "Summarise this",
  discardedMessages: 2,
  laterUserMessages: 0,
  discardedActions: [],
  files: [],
};
