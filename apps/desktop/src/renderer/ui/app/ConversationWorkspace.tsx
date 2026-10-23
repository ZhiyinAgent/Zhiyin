import type { ReactNode } from "react";
import { BrowserSurface } from "../browser/index.js";
import { DocumentPanel, documentShape } from "../document/index.js";
import { SceneSurface } from "../scene/index.js";
import { SurfaceSwitch, WorkspaceSplit } from "../workspace/index.js";
import type { useWorkspaceView } from "./useWorkspaceView.js";
import type { WorkspaceCommands } from "./workspaceCommands.js";

type WorkspaceViewing = ReturnType<typeof useWorkspaceView>;

/**
 * The conversation with the space beside it, drawing whichever surface the
 * view says: the agent's browser, a document or the 3D view. The modules that draw them do
 * not know of each other; this is where they meet.
 */
export function ConversationWorkspace({
  viewing,
  taskId,
  agentWorking,
  id,
  commands,
  act,
  children,
}: {
  viewing: WorkspaceViewing;
  taskId: string | null;
  /** Whether the agent is at work in the conversation now. */
  agentWorking: boolean;
  id: string;
  commands: Pick<
    WorkspaceCommands,
    | "driveBrowser"
    | "watchBrowser"
    | "lookAtScene"
    | "showDocument"
    | "closeDocument"
    | "openDocument"
    | "showDocumentInFolder"
  >;
  act: (operation: () => Promise<unknown>) => Promise<void>;
  children: ReactNode;
}) {
  const withTask = (operation: (taskId: string) => Promise<unknown>) => {
    if (taskId) void act(() => operation(taskId));
  };
  return (
    <WorkspaceSplit
      split={viewing.open}
      id={id}
      // A portrait document gets a narrower space, sized to its page; the
      // browser and landscape documents keep the wide one.
      layout={
        viewing.beside?.kind === "document" &&
        documentShape(viewing.beside.document).tall
          ? "tall"
          : "wide"
      }
      shows={viewing.beside}
      switcher={
        viewing.available.length > 1 && viewing.beside ? (
          <SurfaceSwitch
            available={viewing.available}
            selected={viewing.beside.kind}
            onSelect={viewing.choose}
          />
        ) : undefined
      }
      render={(shown, lane) =>
        shown.kind === "browser" ? (
          <BrowserSurface
            // Each conversation's page is watched apart: showing another
            // stops watching this one.
            key={taskId ?? ""}
            browser={shown.browser}
            inView={viewing.open}
            onReturn={viewing.toConversation}
            onDrive={(intent) => act(() => commands.driveBrowser(intent))}
            // Not said to the person when it fails: the page is still pictured
            // after each action.
            onWatch={(view) => {
              if (taskId)
                void commands.watchBrowser(taskId, view).catch(() => undefined);
            }}
          />
        ) : shown.kind === "scene" ? (
          <SceneSurface
            scene={shown.scene}
            agentWorking={agentWorking}
            onLook={(intent) => act(() => commands.lookAtScene(intent))}
            onReturn={viewing.toConversation}
          />
        ) : (
          <DocumentPanel
            document={shown.document}
            drawPage={viewing.drawPage}
            onShow={(path) =>
              withTask(async (task) => {
                const outcome = await commands.showDocument(task, path);
                if (!outcome.ok) throw new Error(outcome.reason);
              })
            }
            onOpen={(path) =>
              withTask((task) => commands.openDocument(task, path))
            }
            onShowInFolder={(path) =>
              withTask((task) => commands.showDocumentInFolder(task, path))
            }
            onClose={() => withTask((task) => commands.closeDocument(task))}
            onFitHeight={lane.resizeBy}
          />
        )
      }
    >
      {children}
    </WorkspaceSplit>
  );
}
