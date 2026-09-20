import { useMemo, useReducer } from "react";
import { WorkspaceShell } from "../ui/app/index.js";
import { createDemoWorkspaceState, type DemoScenario } from "./fixtures.js";
import { demoCommands } from "./demoCommands.js";
import { demoReducer } from "./demoReducer.js";

export type { DemoScenario } from "./fixtures.js";

export function DemoApp({
  initialScenario = "working",
}: {
  initialScenario?: DemoScenario;
}) {
  const [state, dispatch] = useReducer(
    demoReducer,
    initialScenario,
    createDemoWorkspaceState,
  );
  // The shell drives the app through the core's commands, so the demo answers
  // them from its own store rather than reaching into the shell.
  const commands = useMemo(() => demoCommands(dispatch), []);

  return (
    <div className="demo-stage">
      <div className="demo-window">
        <div className="window-bar" aria-hidden="true">
          <span className="window-dot window-dot--coral" />
          <span className="window-dot window-dot--amber" />
          <span className="window-dot window-dot--green" />
          <span className="window-bar__title">ZHIYIN</span>
        </div>
        <WorkspaceShell state={state} dispatch={dispatch} commands={commands} />
      </div>
    </div>
  );
}
