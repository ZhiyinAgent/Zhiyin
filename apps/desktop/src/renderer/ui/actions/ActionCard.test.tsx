/**
 * One card for an action in every state: asking, running, done, and failed,
 * denied or blocked. The card that asks says why on one line, the reason's
 * name and what it means, with the whole explanation a press away, and what
 * the AI wrote is always shown as its words.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActionEffects, TaskAction } from "@zhiyin/contract";
import { ApprovalPrompt } from "./approvals/ApprovalPrompt.js";
import { ActionHistory } from "./action-history/ActionHistory.js";

const nothing: ActionEffects = {
  reads: "none",
  changes: "none",
  sends: "none",
  actsAsPerson: "none",
  runs: "none",
  lasting: false,
  brings: "none",
};
const shell: ActionEffects = {
  ...nothing,
  reads: "elsewhere",
  changes: "elsewhere",
  sends: "chosen",
  runs: "full-access",
  brings: "outside",
};
/** The line that says why the person is asked, as it reads. */
const reasonLine = (card: HTMLElement) =>
  within(card).getByLabelText("Why you’re asked").textContent ?? "";

/** The whole explanation, once More is pressed. */
function explanation(card: HTMLElement): string {
  fireEvent.click(within(card).getByRole("button", { name: "More" }));
  return reasonLine(card);
}

describe("the card that asks", () => {
  it("says on one line, before the AI's words, the reason's name and what it means, and keeps the rest for More", () => {
    render(
      <ApprovalPrompt
        title="Run a command"
        target="npm publish"
        effects={shell}
        why={{ code: "full-access" }}
        claim="Publish the package."
        onDecision={() => undefined}
      />,
    );

    const card = screen.getByRole("region", { name: "Permission request" });
    const text = card.textContent ?? "";
    const order = [
      "Run a command",
      "Full access",
      "The AI says",
      "Publish the package.",
    ].map((part) => text.indexOf(part));
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(reasonLine(card)).toBe(
      "Full access: it can change anything your Windows account can; only this folder can be undone. More",
    );
    expect(text).not.toContain("anything else it touches can't");
    expect(explanation(card)).toContain("anything else it touches can't");
  });

  it("opens the whole explanation on a press, which the keyboard reaches as any button, and folds it away again", () => {
    render(
      <ApprovalPrompt
        title="Run a command"
        target="npm publish"
        effects={shell}
        why={{ code: "full-access" }}
        onDecision={() => undefined}
      />,
    );

    const card = screen.getByRole("region", { name: "Permission request" });
    const more = within(card).getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(reasonLine(card)).toContain("anything else it touches can't");
    const less = within(card).getByRole("button", { name: "Less" });
    expect(less).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(less);
    expect(reasonLine(card)).not.toContain("anything else it touches can't");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("names where the outside content behind the question came from", () => {
    render(
      <ApprovalPrompt
        title="Type into a page"
        target="https://forms.example/contact"
        effects={{
          ...nothing,
          sends: "chosen",
          destination: "https://forms.example/contact",
          brings: "outside",
        }}
        why={{ code: "outside-and-private", outsideFrom: "news.example" }}
        onDecision={() => undefined}
      />,
    );

    const card = screen.getByRole("region", { name: "Permission request" });
    expect(reasonLine(card)).toMatch(/^Sends to forms\.example: /);
    expect(explanation(card)).toContain("news.example");
  });

  it("never shows the policy's own reason, and asks nothing it was not told to explain", () => {
    render(
      <ApprovalPrompt
        title="Read notes.md"
        target="notes.md"
        onDecision={() => undefined}
      />,
    );

    expect(screen.queryByLabelText("Why you’re asked")).toBeNull();
  });

  it("says where it acts as the person in its explanation, and lists only the other places it sends to", () => {
    render(
      <ApprovalPrompt
        title="GitHub · Add issue comment"
        target="GitHub"
        effects={{
          ...nothing,
          sends: "service",
          actsAsPerson: "once",
          destination: "octo/hello",
        }}
        why={{ code: "acts-as-you" }}
        destinations={["octo/hello", "", "https://api.githubcopilot.com/mcp/"]}
        onDecision={() => undefined}
      />,
    );

    const card = screen.getByRole("region", { name: "Permission request" });
    expect(reasonLine(card)).toBe(
      "Uses your account: it acts as you on octo/hello, where others can see it. More",
    );
    expect(explanation(card)).toContain("for the rest of the conversation");
    expect(
      within(card).getByText(
        (_text, element) =>
          element?.tagName === "P" &&
          element.textContent ===
            "Sends this to https://api.githubcopilot.com/mcp/:",
      ),
    ).toBeVisible();
  });

  it("puts Zhiyin's own account of the action before what the AI says it is for", () => {
    render(
      <ApprovalPrompt
        title="Publish the release notes"
        target="docs.zhiyin.app"
        description="This sends the reviewed draft to the public documentation site."
        claim="Ship the notes the person approved."
        onDecision={() => undefined}
      />,
    );

    const text =
      screen.getByRole("region", { name: "Permission request" }).textContent ??
      "";
    const order = [
      "This sends the reviewed draft to the public documentation site.",
      "The AI says",
      "Ship the notes the person approved.",
    ].map((part) => text.indexOf(part));
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("keeps the tool's own name under Technical details when it is not the action's", () => {
    render(
      <ApprovalPrompt
        title="Search workspace files"
        target="“invoice”"
        invocation={{
          name: "search_files",
          arguments: [
            { name: "query", value: '"invoice"' },
            { name: "includeIgnored", value: "false" },
          ],
        }}
        onDecision={() => undefined}
      />,
    );

    expect(screen.getByText("Include ignored")).toBeVisible();
    expect(screen.getByText("search_files")).not.toBeVisible();
    fireEvent.click(screen.getByText("Technical details"));
    expect(screen.getByText("search_files")).toBeVisible();
    expect(screen.getByText("includeIgnored")).toBeVisible();
  });
});

describe("the card that asks, for several reasons", () => {
  it("labels every reason the policy combined, and explains each", () => {
    render(
      <ApprovalPrompt
        title="Comment on an issue"
        target="octo/hello"
        effects={{
          ...nothing,
          reads: "elsewhere",
          actsAsPerson: "once",
          destination: "octo/hello",
        }}
        why={{ code: "several", parts: ["acts-as-you", "outside-folder"] }}
        onDecision={() => undefined}
      />,
    );

    const card = screen.getByRole("region", { name: "Permission request" });
    expect(reasonLine(card)).toBe(
      "Uses your account · Outside this folder More",
    );
    const said = explanation(card);
    expect(said).toContain("octo/hello");
    expect(said).toContain("outside the folder");
  });
});

describe("what a file grant says it covers", () => {
  it("names a folder outside the conversation's by its own name on its button, and by its whole path", () => {
    render(
      <ApprovalPrompt
        title="Edit a file outside the workspace"
        target="D:\\Shared\\notes\\plan.md"
        effects={{ ...nothing, reads: "elsewhere", changes: "elsewhere" }}
        why={{ code: "outside-folder" }}
        fileRules={[
          { choice: "file", label: "plan.md" },
          { choice: "folder", label: "D:\\Shared\\notes\\" },
        ]}
        onDecision={() => undefined}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Allow for this conversation: Changes to plan.md",
      }),
    ).toHaveTextContent(/^plan\.md$/);
    expect(
      screen.getByRole("button", {
        name: "Allow for this conversation: Changes to files in D:\\Shared\\notes\\",
      }),
    ).toHaveTextContent(/^notes\\$/);
  });

  it("offers a file Zhiyin could not copy as changes to it without a backup", () => {
    render(
      <ApprovalPrompt
        title="Run a Blender script"
        target="stand.blend"
        effects={{
          ...nothing,
          reads: "workspace",
          changes: "workspace-for-good",
        }}
        why={{ code: "cannot-undo" }}
        fileRules={[
          { choice: "file", label: "stand.blend", withoutBackup: true },
        ]}
        onDecision={() => undefined}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Allow for this conversation: Changes to stand.blend without a backup",
      }),
    ).toBeVisible();
  });
});

describe("the record of an action", () => {
  const action = (more: Partial<TaskAction>): TaskAction => ({
    id: "one",
    sequence: 1,
    action: "Run a command",
    target: "npm test",
    status: "completed",
    ...more,
  });

  it("carries no labels: they say why a question was asked, which a record no longer is", () => {
    render(
      <ActionHistory
        actions={[action({ effects: shell, brings: "outside" })]}
      />,
    );

    expect(screen.queryByLabelText("Why you’re asked")).toBeNull();
  });

  it("says what the AI wrote is its words, and leaves Zhiyin's own account plain", () => {
    render(
      <ActionHistory
        actions={[
          action({
            id: "model",
            description: "Run the tests the fix touches.",
            descriptionBy: "model",
          }),
          action({
            id: "zhiyin",
            status: "failed",
            description: "The requested action used invalid input.",
            reason: "The command was empty.",
          }),
        ]}
      />,
    );

    const [model, zhiyin] = screen.getAllByRole("listitem");
    expect(
      within(model!).getByText("Run the tests the fix touches."),
    ).toHaveTextContent(/^The AI says Run the tests the fix touches\.$/);
    expect(zhiyin).not.toHaveTextContent("The AI says");
    expect(zhiyin).toHaveTextContent(
      "The requested action used invalid input.",
    );
  });

  it("names how each state stands in the same words as everywhere", () => {
    render(
      <ActionHistory
        actions={[
          action({ id: "a", status: "running" }),
          action({ id: "b", status: "reported" }),
          action({ id: "c", status: "denied" }),
          action({ id: "d", status: "blocked" }),
          action({ id: "e", status: "cancelled" }),
        ]}
      />,
    );

    for (const word of ["Running", "Reported", "Denied", "Blocked", "Stopped"])
      expect(screen.getByText(word)).toBeVisible();
    expect(screen.queryByText("Pending")).toBeNull();
  });

  it("shows the AI's words again, as its words, in the account opened from it", () => {
    render(
      <ActionHistory
        actions={[
          action({
            effects: shell,
            claim: "Check the build.",
            command: 'run_command({"command":"npm test"})',
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect action" }));
    const account = screen.getByRole("dialog");
    expect(within(account).getByText("Check the build.")).toHaveTextContent(
      /^The AI says Check the build\.$/,
    );
  });
});
