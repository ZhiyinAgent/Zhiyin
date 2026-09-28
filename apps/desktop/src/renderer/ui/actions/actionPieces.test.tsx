/** What this module draws about an action: the decision, and the record. */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalPrompt } from "./ApprovalPrompt.js";
import { ActionHistory } from "./ActionHistory.js";

describe("ApprovalPrompt", () => {
  it("shows a named action once without an empty input box and keeps its exact call inspectable", () => {
    const onDecision = vi.fn();
    render(
      <ApprovalPrompt
        title="Read page"
        target="Zhiyin’s browser"
        detail="Uses Zhiyin’s isolated browser, without your personal browser sign-ins."
        command="browser_snapshot({})"
        invocation={{ name: "Read page", arguments: [] }}
        onDecision={onDecision}
      />,
    );
    expect(screen.getAllByText("Read page")).toHaveLength(1);
    expect(screen.queryByText("No inputs.")).toBeNull();
    expect(screen.queryByText("browser_snapshot({})")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("browser_snapshot({})")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(onDecision).toHaveBeenCalledWith("allow-once");
  });

  it("keeps named action inputs readable without repeating the approval title", () => {
    render(
      <ApprovalPrompt
        title="Open page"
        target="https://example.com/a-page"
        command={'browser_navigate({"url":"https://example.com/a-page"})'}
        invocation={{
          name: "Open page",
          arguments: [{ name: "Address", value: "https://example.com/a-page" }],
        }}
        onDecision={() => undefined}
      />,
    );
    expect(screen.getAllByText("Open page")).toHaveLength(1);
    expect(screen.getByText("Address")).toBeVisible();
    expect(screen.getByText("https://example.com/a-page")).toBeVisible();
  });

  it("keeps technical detail collapsed and returns an explicit decision", () => {
    const onDecision = vi.fn();
    render(
      <ApprovalPrompt
        title="Publish the release notes"
        target="docs.zhiyin.app"
        description="This sends the reviewed draft to the public documentation site."
        command="pnpm docs:publish --production"
        onDecision={onDecision}
      />,
    );

    expect(screen.getByText("Publish the release notes")).toBeInTheDocument();
    expect(screen.queryByText(/needs your approval/i)).toBeNull();
    expect(screen.queryByText("pnpm docs:publish --production")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("pnpm docs:publish --production")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(onDecision).toHaveBeenCalledWith("allow-once");
  });

  /**
   * The decision is made in this order, so the prompt is written in it: what
   * the action is, what it can do, what Zhiyin claims it is for, and only then
   * the exact text. Anything above the warning is something a person reads
   * before they know the stakes.
   */
  it("reads in decision order, with the warning above Zhiyin's own account", () => {
    render(
      <ApprovalPrompt
        title="Run a shell command"
        effect="Run a shell command"
        detail="This runs in TestZhiyin and can read, change, or delete files there."
        claim="Check whether Python 3 with pandas is installed."
        target="command -v python3"
        command={'bash({"command":"command -v python3"})'}
        onDecision={() => undefined}
      />,
    );

    const prompt = screen.getByRole("region", { name: "Permission request" });
    const readingOrder = [
      "Run a shell command",
      "This runs in TestZhiyin and can read, change, or delete files there.",
      "Zhiyin says this is for",
      "Check whether Python 3 with pandas is installed.",
      "What will run",
      "command -v python3",
    ].map((text) =>
      (prompt.textContent ?? "").indexOf(
        // The claim's label and the claim itself share an element.
        text,
      ),
    );

    expect(readingOrder).not.toContain(-1);
    expect(readingOrder).toEqual([...readingOrder].sort((a, b) => a - b));
  });

  it("explains on hover and keyboard focus that the AI claim can deceive", () => {
    render(
      <ApprovalPrompt
        title="Run a shell command"
        target="rm report.txt"
        command="bash({})"
        claim="Clean up a draft."
        onDecision={() => undefined}
      />,
    );
    const about = screen.getByRole("button", {
      name: "About this AI explanation",
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(about);
    expect(screen.getByRole("tooltip").textContent).toContain(
      "deliberately misleading",
    );
    fireEvent.mouseLeave(about);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(about);
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.blur(about);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByText("Clean up a draft.")).toBeVisible();
  });

  it("shows a long command whole rather than clipping what is consented to", () => {
    const command = `python3 -c "import pandas, numpy; print('pandas', pandas.__version__, '| numpy', numpy.__version__)" && echo done && ls -la && git status --short && git log --oneline -20`;
    render(
      <ApprovalPrompt
        title="Run a shell command"
        detail="This runs in TestZhiyin and cannot be undone."
        claim="Check the installed data libraries."
        target={command}
        command={`bash({"command":${JSON.stringify(command)}})`}
        onDecision={() => undefined}
      />,
    );

    expect(screen.getByText(command)).toBeVisible();
  });

  it("says nothing at all when there is no specific reason to give", () => {
    render(
      <ApprovalPrompt
        title="Run a shell command"
        detail="This runs in TestZhiyin and cannot be undone."
        target="git status --short"
        command={'bash({"command":"git status --short"})'}
        onDecision={() => undefined}
      />,
    );

    expect(screen.queryByText(/apply this action/i)).toBeNull();
    expect(screen.queryByText(/for the current task/i)).toBeNull();
  });

  /**
   * The difference is the reviewable thing. Before this, a file change was
   * presented as the call that would make it, which asks someone to consent to
   * replacing a document by reading a JSON argument.
   */
  it("reviews a file change as a difference rather than as the call", () => {
    render(
      <ApprovalPrompt
        title="Overwrite an existing workspace file"
        target="brief.md"
        detail="This replaces the current contents of brief.md."
        command={'write_file({"path":"brief.md","text":"New draft.\n"})'}
        changes={[
          {
            path: "brief.md",
            change: "updated",
            before: "Old draft.\nKept line.\n",
            after: "New draft.\nKept line.\n",
          },
        ]}
        onDecision={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Review this change/ }));

    const review = screen.getByRole("dialog", { name: /Review this change/ });
    expect(within(review).getByText("Old draft.")).toBeVisible();
    expect(within(review).getByText("New draft.")).toBeVisible();
    expect(within(review).getByText("+1")).toBeVisible();
    expect(within(review).getByText("−1")).toBeVisible();
  });

  it("states whether declared file changes are protected before approval", () => {
    render(
      <ApprovalPrompt
        title="Update workspace files"
        target="brief.md, archive.zip"
        command="write_files(…)"
        recovery={{
          files: [
            { path: "brief.md", status: "protected" },
            {
              path: "archive.zip",
              status: "unprotected",
              reason: "This file exceeds the recovery size limit.",
            },
          ],
        }}
        onDecision={vi.fn()}
      />,
    );

    const prompt = screen.getByRole("region", { name: "Permission request" });
    expect(prompt).toHaveTextContent(
      "Some file changes cannot be restored after this action.",
    );
    expect(prompt).toHaveTextContent("archive.zip");
    expect(prompt).toHaveTextContent(
      "This file exceeds the recovery size limit.",
    );
  });

  it("closes the review with Escape and leaves the decision unanswered", () => {
    const onDecision = vi.fn();
    render(
      <ApprovalPrompt
        title="Overwrite an existing workspace file"
        target="brief.md"
        command="write_file(…)"
        changes={[
          { path: "brief.md", change: "created", after: "One line.\n" },
        ]}
        onDecision={onDecision}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Review this change/ }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onDecision).not.toHaveBeenCalled();
  });

  /**
   * A change too large to carry must not look like a change with nothing in
   * it. The person is told they are approving something they have not seen.
   */
  it("says when a change is too large to show instead of showing an empty diff", () => {
    render(
      <ApprovalPrompt
        title="Overwrite an existing workspace file"
        target="dump.csv"
        command="write_file(…)"
        changes={[
          {
            path: "dump.csv",
            change: "updated",
            omitted: "This change is too large to show here.",
          },
        ]}
        onDecision={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Review this change/ }));

    const review = screen.getByRole("dialog");
    expect(review).toHaveTextContent("too large to show");
    expect(review).toHaveTextContent("have not seen in full");
  });

  it("offers no review when the action changes no files it can name", () => {
    render(
      <ApprovalPrompt
        title="Run a shell command"
        target="git status --short"
        command={'bash({"command":"git status --short"})'}
        onDecision={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /Review/ })).toBeNull();
  });

  it("makes denying the action directly available", () => {
    const onDecision = vi.fn();
    render(
      <ApprovalPrompt
        title="Publish the release notes"
        target="docs.zhiyin.app"
        description="This sends the reviewed draft to the public documentation site."
        command="pnpm docs:publish --production"
        onDecision={onDecision}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onDecision).toHaveBeenCalledWith("deny");
  });

  it("sends optional denial guidance to the agent", () => {
    const onDecision = vi.fn();
    render(
      <ApprovalPrompt
        title="Run a shell command"
        target="echo hello"
        command="echo hello"
        onDecision={onDecision}
      />,
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Guidance if you deny (optional)" }),
      {
        target: { value: "Use the project script instead." },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onDecision).toHaveBeenCalledWith(
      "deny",
      "Use the project script instead.",
    );
  });

  it("prevents duplicate decisions while the chosen response is pending", async () => {
    let finishDecision: (() => void) | undefined;
    const onDecision = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDecision = resolve;
        }),
    );
    render(
      <ApprovalPrompt
        title="Read project manifest"
        target="package.json"
        description="I need package.json to identify the project."
        command={'read_file({"path":"package.json"})'}
        onDecision={onDecision}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    fireEvent.click(screen.getByRole("button", { name: "Allowing…" }));

    expect(onDecision).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Allowing…" })).toBeDisabled();

    finishDecision?.();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Allow once" })).toBeEnabled(),
    );
  });
});

describe("ActionHistory", () => {
  it("keeps running, completed, failed, and denied actions in human-readable history", () => {
    render(
      <ActionHistory
        actions={[
          {
            id: "read-package",
            action: "Read project manifest",
            description: "Identify the project and package manager.",
            target: "package.json",
            status: "completed",
          },
          {
            id: "read-readme",
            action: "Read a workspace file",
            target: "README.md",
            status: "failed",
            reason: "README.md was not found in this workspace.",
          },
          {
            id: "publish",
            action: "Publish the release notes",
            target: "docs.zhiyin.app",
            status: "denied",
            reason: "The action was denied. No further work ran.",
          },
          {
            id: "scan-source",
            action: "Scan the source tree",
            target: "packages",
            status: "running",
          },
        ]}
      />,
    );

    const history = screen.getByRole("region", { name: "Action history" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(4);
    expect(within(history).queryByText("Completed")).toBeNull();
    expect(
      within(history).getByRole("img", { name: "Completed" }),
    ).toBeVisible();
    expect(
      within(history).getByText("Identify the project and package manager."),
    ).toBeVisible();
    expect(within(history).getByText("Failed")).toBeVisible();
    expect(within(history).getByText("Denied")).toBeVisible();
    // Work still going on is neither a success nor a failure, and does not
    // borrow the marker of one.
    expect(within(history).getByText("Pending")).toBeVisible();
    expect(
      within(history).getByText("README.md was not found in this workspace."),
    ).toBeVisible();
    expect(within(history).queryByText(/read_file/i)).toBeNull();
  });

  /**
   * Reviewing a change before it happens and checking afterwards what was done
   * are the same question. The record used to answer the second with the call
   * and a blob of JSON, which is the tool's language rather than an account of
   * what happened to a file.
   */
  it("shows the change an action made, as the difference it made", () => {
    render(
      <ActionHistory
        actions={[
          {
            id: "write-brief",
            action: "Overwrite an existing workspace file",
            target: "brief.md",
            status: "completed",
            command: 'write_file({"path":"brief.md","text":"New draft."})',
            changes: [
              {
                path: "brief.md",
                change: "updated",
                before: "Old draft.\nKept.",
                after: "New draft.\nKept.",
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inspect action" }));

    const inspector = screen.getByRole("dialog");
    expect(within(inspector).getByText("Old draft.")).toBeVisible();
    expect(within(inspector).getByText("New draft.")).toBeVisible();
    // The call is gone: the difference already says what happened, and the
    // call said it again in the tool's own encoding.
    expect(within(inspector).queryByText(/write_file/)).toBeNull();
  });

  it("draws what a tool reported in the shapes the tool named", () => {
    render(
      <ActionHistory
        actions={[
          {
            id: "search",
            action: "Search workspace files",
            target: "budget",
            status: "completed",
            details: [
              {
                kind: "facts",
                items: [
                  { label: "Files read", value: "42" },
                  { label: "Matches", value: "1" },
                ],
              },
              {
                kind: "matches",
                items: [
                  { path: "notes/budget.md", line: 3, text: "Q3 Budget total" },
                ],
                note: "Not searched: .git, node_modules.",
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect action" }));

    const inspector = screen.getByRole("dialog");
    expect(within(inspector).getByText("Files read")).toBeVisible();
    expect(within(inspector).getByText("42")).toBeVisible();
    expect(within(inspector).getByText("notes/budget.md")).toBeVisible();
    expect(within(inspector).getByText("Q3 Budget total")).toBeVisible();
    expect(
      within(inspector).getByText("Not searched: .git, node_modules."),
    ).toBeVisible();
  });

  /**
   * A shell command is the one case where the call itself is the thing worth
   * reading, and it is what the tool puts in front of the reader.
   */
  it("puts a command's own output in front, not its call", () => {
    render(
      <ActionHistory
        actions={[
          {
            id: "shell",
            action: "Run a shell command",
            target: "command -v python3",
            status: "reported",
            reason: "The command exited with code 1.",
            command: 'bash({"command":"command -v python3"})',
            details: [
              {
                kind: "facts",
                items: [
                  { label: "Command", value: "command -v python3" },
                  { label: "Exit code", value: "1" },
                ],
              },
              { kind: "text", label: "Errors", text: "python3 not found" },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect action" }));

    const inspector = screen.getByRole("dialog");
    expect(within(inspector).getByText("python3 not found")).toBeVisible();
    expect(within(inspector).getByText("Exit code")).toBeVisible();
    expect(within(inspector).queryByText(/bash\(/)).toBeNull();
    // And the target is not repeated above the command it duplicates.
    expect(within(inspector).getAllByText("command -v python3")).toHaveLength(
      1,
    );
  });

  /**
   * Going back to a shell command later should show what was agreed to, not
   * just that something happened. The unverified claim stays attributed.
   */
  it("keeps what was agreed to with the record of what happened", () => {
    render(
      <ActionHistory
        actions={[
          {
            id: "shell",
            action: "Run a shell command",
            description: "Checks the installed data libraries.",
            detail:
              "This runs in TestZhiyin but is not confined to that folder.",
            claim: "Check whether pandas is installed.",
            target: 'python3 -c "import pandas"',
            status: "reported",
            reason: "The command exited with code 1.",
            details: [
              { kind: "facts", items: [{ label: "Exit code", value: "1" }] },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect action" }));

    const inspector = screen.getByRole("dialog");
    expect(
      within(inspector).getByText("Checks the installed data libraries."),
    ).toBeVisible();
    expect(
      within(inspector).getByText(
        "This runs in TestZhiyin but is not confined to that folder.",
      ),
    ).toBeVisible();
    expect(
      within(inspector).getByText("Zhiyin said this was for"),
    ).toBeVisible();
    expect(
      within(inspector).getByText("Check whether pandas is installed."),
    ).toBeVisible();
    // The status sentence is on the record it was opened from; repeating it
    // above the exit code it restates is the same thing said twice.
    expect(
      within(inspector).queryByText("The command exited with code 1."),
    ).toBeNull();
  });

  /**
   * The other half of that rule. A skill's instructions never name the skill,
   * so dropping the target here would leave a reader unable to tell which one
   * was read.
   */
  it("keeps naming what was acted on when the answer does not", () => {
    render(
      <ActionHistory
        actions={[
          {
            id: "skill",
            action: "Read skill instructions",
            target: "builtin-analysis",
            status: "completed",
            command: 'load_skill({"id":"builtin-analysis"})',
            details: [
              {
                kind: "text",
                label: "Instructions",
                text: "Inspect the available data before interpreting it.",
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect action" }));

    const inspector = screen.getByRole("dialog");
    expect(within(inspector).getByText("builtin-analysis")).toBeVisible();
    expect(
      within(inspector).getByText(
        "Inspect the available data before interpreting it.",
      ),
    ).toBeVisible();
    expect(within(inspector).queryByText(/load_skill/)).toBeNull();
  });

  it("closes the inspector with Escape", () => {
    render(
      <ActionHistory
        actions={[
          {
            id: "read",
            action: "Read a workspace file",
            target: "notes.md",
            status: "completed",
            details: [{ kind: "text", label: "Contents", text: "Hello." }],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect action" }));
    expect(screen.getByRole("dialog")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /**
   * A tool that described nothing — a remote one, or a built-in not yet taught
   * to — still has to be inspectable. Its raw answer is then the only record
   * there is, so it is shown rather than withheld.
   */
  it("shows what a remote tool was asked to do, not only that it was asked", () => {
    render(
      <ActionHistory
        actions={[
          {
            id: "remote",
            action: "Use Tavily: tavily_search",
            target: "Tavily",
            status: "completed",
            command:
              'mcp__tavily__tavily_search({"max_results":8,"query":"ZEvent 2026"})',
            evidence: '{"ok":true,"value":{"results":[]}}',
            invocation: {
              name: "tavily_search",
              via: "https://mcp.tavily.com/mcp/",
              arguments: [
                { name: "max_results", value: "8" },
                { name: "query", value: "ZEvent 2026" },
              ],
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect action" }));
    const inspector = screen.getByRole("dialog");

    // The arguments are readable in the open, not folded away inside a
    // heading that says they are what the tool returned.
    expect(within(inspector).getByText("query")).toBeVisible();
    expect(within(inspector).getByText("ZEvent 2026")).toBeVisible();
    expect(
      within(inspector).getByText("https://mcp.tavily.com/mcp/"),
    ).toBeVisible();
    expect(
      within(inspector).queryByText(/mcp__tavily__tavily_search\(/),
    ).toBeNull();
  });

  it("lays a remote answer out instead of dumping it as one escaped line", () => {
    const answer = JSON.stringify({
      ok: true,
      value: {
        content: [
          {
            type: "text",
            text: JSON.stringify({ query: "box office", results: [] }),
          },
        ],
      },
    });
    render(
      <ActionHistory
        actions={[
          {
            id: "remote",
            action: "Use Tavily: tavily_search",
            target: "Tavily",
            status: "completed",
            evidence: answer,
            invocation: {
              name: "tavily_search",
              arguments: [{ name: "query", value: "box office" }],
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect action" }));
    const inspector = screen.getByRole("dialog");
    const shown =
      inspector.querySelector(".inspector__json")?.textContent ?? "";

    // Indented, and the payload that arrived escaped inside a field is read
    // as the structure it is.
    expect(shown).toContain('"query": "box office"');
    expect(shown).not.toContain('\\"query\\"');
    expect(inspector.querySelector(".json-key")).not.toBeNull();
  });

  it("falls back to the raw answer for a tool that described nothing", () => {
    render(
      <ActionHistory
        actions={[
          {
            id: "remote",
            action: "Search the web",
            target: "current news",
            status: "completed",
            command: 'tavily_search({"query":"current news"})',
            evidence: '{"ok":true,"value":{"results":[]}}',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect action" }));

    const inspector = screen.getByRole("dialog");
    expect(within(inspector).getByText("What the tool returned")).toBeVisible();
    // Present, behind the disclosure: the only record there is, not the lead.
    expect(within(inspector).getByText(/tavily_search/)).toBeInTheDocument();
  });

  it("offers no inspection for an action with nothing recorded about it", () => {
    render(
      <ActionHistory
        actions={[
          {
            id: "denied",
            action: "Publish the release notes",
            target: "docs.zhiyin.app",
            status: "denied",
            reason: "The action was denied. No further work ran.",
          },
        ]}
      />,
    );

    expect(screen.queryByRole("button", { name: "Inspect action" })).toBeNull();
  });
});
