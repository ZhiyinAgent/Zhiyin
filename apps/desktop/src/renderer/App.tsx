import { useEffect, useReducer, useState } from "react";
import type { CoreApi } from "@zhiyin/contract";
import {
  ConnectionRecovery,
  WorkspaceShell,
  createWorkspaceState,
  workspaceReducer,
} from "./ui/app/index.js";
import { validateView } from "./ui/views/index.js";

export function App({ core }: { core: CoreApi }) {
  const [connectionError, setConnectionError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [state, dispatch] = useReducer(
    workspaceReducer,
    undefined,
    createWorkspaceState,
  );

  useEffect(() => {
    let mounted = true;
    const unsubscribe = core.onAppEvent((event) => {
      if (event.kind === "coreReady") dispatch({ type: "connected" });
      else if (event.kind === "workspaceSnapshot")
        dispatch({ type: "workspaceHydrated", snapshot: event.data });
      else if (event.kind === "taskChanged")
        dispatch({ type: "taskReplaced", task: event.data });
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
      <ConnectionRecovery
        onRetry={() => {
          setConnectionError(false);
          setRetry((value) => value + 1);
        }}
      />
    );

  return <WorkspaceShell state={state} dispatch={dispatch} commands={core} />;
}
