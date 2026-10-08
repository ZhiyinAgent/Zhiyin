import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RunningCommand } from "@zhiyin/contract";
import { RunningCommands } from "./RunningCommands.js";

const build: RunningCommand = {
  id: "J1",
  command: "npm run build",
  explanation: "Builds the app to check that the release compiles.",
  startedAt: Date.now() - 125_000,
};

function commands(
  overrides: Partial<Parameters<typeof RunningCommands>[0]["commands"]> = {},
) {
  return {
    runningCommands: vi.fn(async () => [build]),
    commandOutput: vi.fn(async () => ({
      stdout: "step 1\nstep 2\ncompiled 42 files\n",
      stderr: "",
    })),
    stopCommand: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("a conversation's running commands", () => {
  it("shows nothing while no command runs", () => {
    const { container } = render(
      <RunningCommands
        taskId="task-1"
        running={[]}
        commands={commands({ runningCommands: vi.fn(async () => []) })}
        onListed={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("asks which commands run when the conversation is shown", async () => {
    const onListed = vi.fn();
    const core = commands();

    render(
      <RunningCommands
        taskId="task-1"
        running={[]}
        commands={core}
        onListed={onListed}
      />,
    );

    await waitFor(() => expect(onListed).toHaveBeenCalledWith([build]));
    expect(core.runningCommands).toHaveBeenCalledWith("task-1");
  });

  it("says first why each command was run, and what stopping it does", () => {
    render(
      <RunningCommands
        taskId="task-1"
        running={[build]}
        commands={commands()}
        onListed={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1 command running" }));

    const dialog = screen.getByRole("dialog", { name: "Running commands" });
    expect(dialog).toHaveTextContent(
      "Builds the app to check that the release compiles.",
    );
    expect(dialog).toHaveTextContent(
      "Stop ends a command and all it started. Its work so far stays, and Zhiyin is told.",
    );
  });

  it("opens on each command, how long it has run and what it printed last", async () => {
    const core = commands();
    render(
      <RunningCommands
        taskId="task-1"
        running={[build]}
        commands={core}
        onListed={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1 command running" }));

    const dialog = screen.getByRole("dialog", { name: "Running commands" });
    expect(dialog).toHaveTextContent("npm run build");
    expect(dialog).toHaveTextContent("Running for 2 min");
    expect(await screen.findByText(/compiled 42 files/)).toBeVisible();
    expect(core.commandOutput).toHaveBeenCalledWith("task-1", "J1");
  });

  it("stops a command the person chooses, and says it is stopping", async () => {
    let finish: () => void = () => {};
    const core = commands({
      stopCommand: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    render(
      <RunningCommands
        taskId="task-1"
        running={[build]}
        commands={core}
        onListed={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "1 command running" }));

    fireEvent.click(screen.getByRole("button", { name: "Stop npm run build" }));

    expect(core.stopCommand).toHaveBeenCalledWith("task-1", "J1");
    expect(
      screen.getByRole("button", { name: "Stop npm run build" }),
    ).toBeDisabled();
    expect(screen.getByText("Stopping…")).toBeVisible();
    await act(async () => finish());
  });

  it("says when a stop failed, and lets the person try again", async () => {
    const core = commands({
      stopCommand: vi.fn(async () => {
        throw new Error("The command could not be stopped.");
      }),
    });
    render(
      <RunningCommands
        taskId="task-1"
        running={[build]}
        commands={core}
        onListed={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "1 command running" }));

    fireEvent.click(screen.getByRole("button", { name: "Stop npm run build" }));

    expect(
      await screen.findByText("The command could not be stopped."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Stop npm run build" }),
    ).toBeEnabled();
  });

  it("says nothing is running once the last command ends while it is open", () => {
    const core = commands();
    const { rerender } = render(
      <RunningCommands
        taskId="task-1"
        running={[build]}
        commands={core}
        onListed={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "1 command running" }));

    rerender(
      <RunningCommands
        taskId="task-1"
        running={[]}
        commands={core}
        onListed={() => {}}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Running commands" }),
    ).toHaveTextContent("No command is running now.");
  });

  it("closes with Escape", () => {
    render(
      <RunningCommands
        taskId="task-1"
        running={[build]}
        commands={commands()}
        onListed={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "1 command running" }));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
