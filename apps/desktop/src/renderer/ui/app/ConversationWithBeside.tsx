import type { ReactNode } from "react";
import type { ThreeDContent, WorkspaceView } from "@zhiyin/contract";
import { BrowserSurface } from "../browser/index.js";
import { DocumentPanel, documentShape } from "../document/index.js";
import { PartPanel } from "../parts/index.js";
import { SceneSurface } from "../scene/index.js";
import { SurfaceSwitch, BesideSplit } from "../beside/index.js";
import type { FrameParts } from "../shared/index.js";
import type { BesideConversation, useBesideView } from "./useBesideView.js";
import type { WindowCommands } from "./windowCommands.js";

type BesideViewing = ReturnType<typeof useBesideView>;

/**
 * The conversation with the space beside it, drawing whichever surface the
 * view says: the agent's browser, a document, or the 3D view, which shows the
 * Blender scene or the parts the CAD studio built. The modules that draw them do
 * not know of each other; this is where they meet.
 */
export function ConversationWithBeside({
  viewing,
  taskId,
  agentWorking,
  id,
  commands,
  act,
  children,
}: {
  viewing: BesideViewing;
  taskId: string | null;
  /** Whether the agent is at work in the conversation now. */
  agentWorking: boolean;
  id: string;
  commands: Pick<
    WindowCommands,
    | "driveBrowser"
    | "watchBrowser"
    | "openAnswerLink"
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
    <BesideSplit
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
      // Going to a document or the scene, the surface before stays until its
      // page or picture is drawn, rather than giving way to an empty frame.
      itemOf={(shown) => shown.kind}
      waits={(shown) =>
        shown.kind === "document" ||
        (shown.kind === "3d" &&
          !(shown.shows === "parts" && shown.parts) &&
          !!shown.scene)
      }
      render={(shown, lane, ready) =>
        shown.kind === "browser" ? (
          <BrowserSurface
            // Each conversation's page is watched apart: showing another
            // stops watching this one.
            key={taskId ?? ""}
            browser={shown.browser}
            inView={viewing.open}
            onReturn={viewing.toConversation}
            onDrive={(intent) => act(() => commands.driveBrowser(intent))}
            onOpenOutside={(url) =>
              void act(() => commands.openAnswerLink(url))
            }
            // Not said to the person when it fails: the page is still pictured
            // after each action.
            onWatch={(view) => {
              if (taskId)
                void commands.watchBrowser(taskId, view).catch(() => undefined);
            }}
          />
        ) : shown.kind === "3d" ? (
          shown.shows === "parts" && shown.parts ? (
            <PartPanel
              // Each conversation's parts start from the first angle, not
              // the one the person turned to in another.
              key={taskId ?? ""}
              parts={shown.parts}
              loadModel={viewing.partModel}
              frame={threeDFrame(shown, viewing)}
            />
          ) : shown.scene ? (
            <SceneSurface
              scene={shown.scene}
              agentWorking={agentWorking}
              onLook={(intent) => act(() => commands.lookAtScene(intent))}
              onReturn={viewing.toConversation}
              onDrawn={ready}
              frame={threeDFrame(shown, viewing)}
            />
          ) : null
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
            onReady={ready}
          />
        )
      }
    >
      {children}
    </BesideSplit>
  );
}

/**
 * The 3D view's frame, the same whichever of the scene and the parts it
 * shows: its menu offers the other, by name, when the conversation has both.
 * Its close puts the space away, as the header's Conversation tab does: the
 * scene and the parts belong to the conversation's studios, so nothing of
 * them is closed.
 */
function threeDFrame(
  shown: Extract<BesideConversation, { kind: "3d" }>,
  {
    choose,
    toConversation,
  }: {
    choose: (view: WorkspaceView, threeD?: ThreeDContent) => void;
    toConversation: () => void;
  },
): FrameParts {
  const items = [
    ...(shown.scene
      ? [
          {
            id: "scene",
            name: shown.scene.file?.split("/").pop() ?? "3D scene",
            detail: "Blender scene",
          },
        ]
      : []),
    ...(shown.parts
      ? [
          {
            id: "parts",
            name: shown.parts.script?.split("/").pop() ?? "Parts",
            detail: "Parts built",
          },
        ]
      : []),
  ];
  return {
    label: "3D view",
    menu: {
      label: "In 3D",
      listLabel: "What the 3D view can show",
      items,
      current: shown.shows,
      onPick: (id) => {
        if (id === "scene" || id === "parts") choose("3d", id);
      },
    },
    close: { label: "Put the 3D view away", onClose: toConversation },
  };
}
