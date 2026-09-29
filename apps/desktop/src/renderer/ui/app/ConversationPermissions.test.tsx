import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationPermissions } from "./ConversationPermissions.js";
import type { WorkspaceTask } from "./workspaceState.js";

describe("conversation permissions panel", () => {
  it("shows active scopes without action history or timestamps and revokes one", async () => {
    const onRevoke = vi.fn(async () => {});
    const task: WorkspaceTask = {
      id: "task-1",
      title: "Prepare report",
      updatedLabel: "Now",
      messages: [],
      phase: { kind: "draft" },
      conversationPermissions: [
        {
          id: "permission-1",
          kind: "file-folder",
          toolName: "write_file",
          label: "Changes to files in reports/",
          at: "2026-09-28T14:02:00.000Z",
          workspaceRoot: "C:/workspace",
          folder: "C:/workspace/reports",
        },
      ],
      actions: [
        {
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
        name: "Revoke Changes to files in reports/",
      }),
    );
    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith("permission-1"));
  });

  it("gives an older connector grant a readable title and closes with Escape", () => {
    const onClose = vi.fn();
    render(
      <ConversationPermissions
        task={{
          id: "task-2",
          title: "Research",
          updatedLabel: "Now",
          messages: [],
          phase: { kind: "draft" },
          conversationPermissions: [
            {
              id: "permission-2",
              kind: "connector-tool",
              toolName: "mcp__research__tavily__tavily_search",
              label: "mcp__research__tavily__tavily_search, this version",
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
      screen.getByRole("button", { name: "Revoke Tavily · Search" }),
    ).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("has a clear empty state after every permission is revoked", () => {
    render(
      <ConversationPermissions
        task={{
          id: "empty",
          title: "Empty conversation",
          updatedLabel: "Now",
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
