import { emptyConversationLists } from "@zhiyin/contract";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceTask } from "@zhiyin/contract";
import { ConversationPermissions } from "./ConversationPermissions.js";

describe("conversation permissions panel", () => {
  it("shows active scopes without action history or timestamps and revokes one", async () => {
    const onRevoke = vi.fn(async () => {});
    const task: WorkspaceTask = {
      id: "task-1",
      title: "Prepare report",
      titleSource: "generated",
      updatedLabel: "Now",
      updatedAt: "2026-10-05T09:00:00.000Z",
      ...emptyConversationLists,
      messages: [],
      phase: { kind: "draft" },
      conversationPermissions: [
        {
          id: "permission-1",
          kind: "outside-folder",
          toolName: "write_file",
          label: "Changes to files in reports/",
          at: "2026-09-28T14:02:00.000Z",
          folder: "D:/reports",
        },
      ],
      actions: [
        {
          sequence: 100,
          id: "action-1",
          action: "Edit report",
          target: "reports/one.md",
          status: "completed",
          approval: {
            by: "conversation-permission",
            at: "2026-09-28T14:03:00.000Z",
            permissionId: "permission-1",
            label: "Changes to files in reports/",
          },
        },
      ],
    };
    render(
      <ConversationPermissions
        task={task}
        onClose={() => {}}
        onRevoke={onRevoke}
      />,
    );
    expect(screen.getByText("Changes to files in reports/")).toBeVisible();
    expect(screen.queryByText(/Edit report/)).toBeNull();
    expect(screen.queryByText(/Given 9\/28\/2026/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Take back Changes to files in reports/",
      }),
    );
    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith("permission-1"));
  });

  it("says what a file's grant, a folder's grant and a grant to change a file without a copy each let run again", () => {
    render(
      <ConversationPermissions
        task={{
          id: "task-3",
          title: "Birthday card",
          updatedLabel: "Now",
          updatedAt: "2026-10-29T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [],
          phase: { kind: "draft" },
          conversationPermissions: [
            {
              id: "file",
              kind: "outside-file",
              toolName: "write_file",
              label: "Changes to D:\\Cards\\card.html",
              at: "2026-10-29T09:00:00.000Z",
              file: "D:\\Cards\\card.html",
            },
            {
              id: "folder",
              kind: "outside-folder",
              toolName: "run_python",
              label: "Changes to files in D:\\Reports\\",
              at: "2026-10-29T09:00:00.000Z",
              folder: "D:\\Reports",
            },
            {
              id: "uncopied",
              kind: "uncopied-file",
              toolName: "write_file",
              label: "Changes to D:\\Cards\\photo.psd",
              at: "2026-10-29T09:00:00.000Z",
              file: "D:\\Cards\\photo.psd",
            },
          ],
        }}
        onClose={() => {}}
        onRevoke={async () => {}}
      />,
    );

    expect(
      screen.getByText(
        "May change this file again in this conversation, until it is changed outside Zhiyin.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "May create and change files in this folder and the folders in it again in this conversation.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "May change this file again in this conversation without a copy kept first, until it is changed outside Zhiyin.",
      ),
    ).toBeVisible();
  });

  it("shows a connector permission by its label, keeps focus inside, and closes with Escape", () => {
    const onClose = vi.fn();
    render(
      <ConversationPermissions
        task={{
          id: "task-2",
          title: "Research",
          updatedLabel: "Now",
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [],
          phase: { kind: "draft" },
          conversationPermissions: [
            {
              id: "permission-2",
              kind: "connector-tool",
              toolName: "mcp__research__tavily__tavily_search",
              label: "Tavily · Search",
              at: "2026-09-28T14:02:00.000Z",
              identity: JSON.stringify({
                server: { id: "research/tavily", name: "Tavily" },
                schema: {},
              }),
            },
          ],
        }}
        onClose={onClose}
        onRevoke={async () => {}}
      />,
    );
    expect(screen.getByText("Tavily · Search")).toBeVisible();
    expect(screen.queryByText(/mcp__research/)).toBeNull();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(
      screen.getByRole("button", { name: "Take back Tavily · Search" }),
    ).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("says a permission for a set of a connection's calls covers that set, not one tool", () => {
    render(
      <ConversationPermissions
        task={{
          id: "task-3",
          title: "Mug",
          updatedLabel: "Now",
          updatedAt: "2026-10-10T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [],
          phase: { kind: "draft" },
          conversationPermissions: [
            {
              id: "permission-3",
              kind: "connector-tool",
              toolName: "mcp__blender__*",
              label:
                "3D studio · Changes to mug.blend, and new files in the workspace",
              at: "2026-10-10T09:00:00.000Z",
              identity: JSON.stringify({
                workspace: "C:/ws",
                scene: "mug.blend",
              }),
            },
          ],
        }}
        onClose={() => {}}
        onRevoke={async () => {}}
      />,
    );
    expect(
      screen.getByText(
        "What it names may run again in this conversation without asking.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/tool version/)).toBeNull();
  });

  it("says what a grant for a folder and one for a place each let happen, and no more", () => {
    render(
      <ConversationPermissions
        task={{
          id: "task-6",
          title: "Release",
          updatedLabel: "Now",
          updatedAt: "2026-10-31T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [],
          phase: { kind: "draft" },
          conversationPermissions: [
            {
              id: "folder",
              kind: "outside-folder",
              toolName: "run_python",
              label: "Changes to files in D:/release/",
              at: "2026-10-31T09:00:00.000Z",
              folder: "D:/release",
            },
            {
              id: "place",
              kind: "destination",
              toolName: "mcp__github__*",
              label: "GitHub · octo/hello",
              at: "2026-10-31T09:00:00.000Z",
              destination: "octo/hello",
            },
          ],
        }}
        onClose={() => {}}
        onRevoke={async () => {}}
      />,
    );

    expect(
      screen.getByText(
        "May create and change files in this folder and the folders in it again in this conversation.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "May act as you on this place again in this conversation. What can’t be taken back still asks each time.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/make these changes/)).toBeNull();
  });

  it("never says a permission for one exact call lets the tool run as it likes", () => {
    render(
      <ConversationPermissions
        task={{
          id: "task-4",
          title: "Mug",
          updatedLabel: "Now",
          updatedAt: "2026-10-10T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [],
          phase: { kind: "draft" },
          conversationPermissions: [
            {
              id: "permission-4",
              kind: "connector-tool",
              toolName: "mcp__blender__blender_render",
              label: "3D studio · Render a 3D scene · only this exact call",
              at: "2026-10-10T09:00:00.000Z",
              identity: JSON.stringify({ server: "blender", action: "call" }),
            },
          ],
        }}
        onClose={() => {}}
        onRevoke={async () => {}}
      />,
    );
    expect(
      screen.getByText(
        "May run again in this conversation while the tool stays the same.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/use this tool/)).toBeNull();
  });

  it("holds the window like any dialog: the top bar stops dragging, and a press outside closes it", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <>
        <button type="button">Beside</button>
        <ConversationPermissions
          task={{
            id: "task-5",
            title: "Report",
            updatedLabel: "Now",
            updatedAt: "2026-10-05T09:00:00.000Z",
            ...emptyConversationLists,
            messages: [],
            phase: { kind: "draft" },
            conversationPermissions: [],
          }}
          onClose={onClose}
          onRevoke={async () => {}}
        />
      </>,
    );

    expect(document.documentElement).toHaveAttribute("data-layer-open");
    fireEvent.pointerDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Beside" }));
    expect(onClose).toHaveBeenCalledOnce();

    unmount();
    expect(document.documentElement).not.toHaveAttribute("data-layer-open");
  });

  it("has a clear empty state after every permission is revoked", () => {
    render(
      <ConversationPermissions
        task={{
          id: "empty",
          title: "Empty conversation",
          updatedLabel: "Now",
          updatedAt: "2026-10-05T09:00:00.000Z",
          ...emptyConversationLists,
          messages: [],
          phase: { kind: "draft" },
          conversationPermissions: [],
        }}
        onClose={() => {}}
        onRevoke={async () => {}}
      />,
    );
    expect(
      screen.getByText("No active permissions for this conversation."),
    ).toBeVisible();
  });
});
