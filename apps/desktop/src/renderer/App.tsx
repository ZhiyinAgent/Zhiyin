import { useEffect, useReducer, useState } from "react";
import { WindowCopy, type CoreApi } from "@zhiyin/contract";
import {
  ConnectionRecovery,
  WorkspaceShell,
  createWorkspaceState,
  workspaceReducer,
} from "./ui/app/index.js";
import { HoverTips } from "./ui/shared/index.js";
import { validateView } from "./ui/views/index.js";

export function App({
  core,
  restarted = false,
}: {
  core: CoreApi;
  /** The window was reloaded after its page crashed. */
  restarted?: boolean;
}) {
  const [connectionError, setConnectionError] = useState(false);
  // Said once: dismissed, or left for another page, it is not said again.
  const [restartNotice, setRestartNotice] = useState(restarted);
  const [retry, setRetry] = useState(0);
  const [state, dispatch] = useReducer(
    workspaceReducer,
    undefined,
    createWorkspaceState,
  );

  useEffect(() => {
    let mounted = true;
    // The core sends the workspace whole once, then what changed in it.
    const copy = new WindowCopy();
    const unsubscribe = core.onAppEvent((event) => {
      const update = copy.receive(event);
      for (const taskId of update?.resend ?? [])
        void core.resendTask(taskId).catch(() => undefined);
      if (update?.snapshot)
        dispatch({ type: "workspaceHydrated", snapshot: update.snapshot });
      else if (update?.task)
        dispatch({ type: "taskReplaced", task: update.task });
      else if (event.kind === "coreReady") dispatch({ type: "connected" });
      else if (event.kind === "taskRemoved")
        dispatch({ type: "taskRemoved", ...event.data });
      else if (event.kind === "taskSelectionChanged")
        dispatch({ type: "selectionReceived", taskId: event.data.taskId });
      else if (event.kind === "mcpServersChanged")
        dispatch({ type: "mcpServersReceived", servers: event.data });
      else if (event.kind === "pluginsChanged")
        dispatch({ type: "pluginsReceived", plugins: event.data });
      else if (event.kind === "browserChanged")
        dispatch({
          type: "browserChanged",
          taskId: event.data.taskId,
          browser: event.data.browser,
        });
      else if (event.kind === "documentChanged")
        dispatch({
          type: "documentChanged",
          taskId: event.data.taskId,
          document: event.data.document,
        });
      else if (event.kind === "workspaceViewChanged")
        dispatch({ type: "workspaceViewChanged", ...event.data });
      else if (event.kind === "commandsChanged")
        dispatch({ type: "commandsChanged", ...event.data });
      else if (event.kind === "usageChanged")
        dispatch({ type: "usageReceived", usage: event.data });
      else if (event.kind === "providerSettingsChanged")
        dispatch({ type: "providerReceived", provider: event.data });
    });
    const unsubscribeView = core.onViewCheck((request) => {
      void validateView(request).then((outcome) =>
        core.answerViewCheck(request.id, outcome),
      );
    });

    void core.frontendReady().catch(() => {
      if (mounted) setConnectionError(true);
    });
    return () => {
      mounted = false;
      unsubscribe();
      unsubscribeView();
    };
  }, [core, retry]);

  if (connectionError)
    return (
      <>
        <HoverTips />
        <ConnectionRecovery
          triedAgain={retry > 0}
          onRetry={() => {
            setConnectionError(false);
            setRetry((value) => value + 1);
          }}
        />
      </>
    );

  return (
    <>
      <HoverTips />
      <WorkspaceShell
        state={state}
        dispatch={dispatch}
        commands={core}
        restarted={restartNotice}
        onRestartNoticed={() => setRestartNotice(false)}
      />
    </>
  );
}
