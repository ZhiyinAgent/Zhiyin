import { useEffect, useReducer, useState } from "react";
import type { CoreApi } from "@zhiyin/contract";
import { WindowCopy } from "@zhiyin/window-changes";
import {
  WindowShell,
  actionFor,
  createWindowState,
  useDimmedWindowControls,
  useStillInBackground,
  windowReducer,
} from "./ui/app/index.js";
import { ConnectionRecovery } from "./ui/notices/index.js";
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
    windowReducer,
    undefined,
    createWindowState,
  );
  useDimmedWindowControls((dimmed) => core.dimWindowControls(dimmed));
  useStillInBackground();

  useEffect(() => {
    let mounted = true;
    // The core sends the workspace whole once, then what changed in it.
    const copy = new WindowCopy();
    const unsubscribe = core.onAppEvent((event) => {
      const update = copy.receive(event);
      // A resend fails only when the core cannot be reached; reconnecting
      // sends the workspace whole again.
      for (const taskId of update?.resend ?? [])
        void core.resendTask(taskId).catch(() => {
          if (mounted) setConnectionError(true);
        });
      if (update?.snapshot)
        dispatch({ type: "windowHydrated", snapshot: update.snapshot });
      else if (update?.task)
        dispatch({ type: "taskReplaced", task: update.task });
      else {
        const action = actionFor(event);
        if (action) dispatch(action);
      }
    });
    const unsubscribeView = core.onViewCheck((request) => {
      void validateView(request).then((outcome) =>
        core.answerViewCheck(request.id, outcome),
      );
    });

    void core.frontendReady().then(
      // What memory holds, and where updating Zhiyin stands, read once;
      // every change after comes as an event. A copy that does not update
      // itself says so, and shows nothing about updates.
      () => {
        void core.appUpdate().then(
          (update) => {
            if (mounted) dispatch({ type: "appUpdateReceived", update });
          },
          () => undefined,
        );
        return core.memory().then(
          (memory) => {
            if (mounted) dispatch({ type: "memoryReceived", memory });
          },
          (cause: unknown) => {
            if (mounted)
              dispatch({
                type: "memoryFailed",
                reason:
                  cause instanceof Error
                    ? cause.message
                    : "Memory could not be read.",
              });
          },
        );
      },
      () => {
        if (mounted) setConnectionError(true);
      },
    );
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
      <WindowShell
        state={state}
        dispatch={dispatch}
        commands={core}
        restarted={restartNotice}
        onRestartNoticed={() => setRestartNotice(false)}
      />
    </>
  );
}
