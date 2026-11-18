/** Which way the 3D view looks: through the scene's camera, or round it. */
export type SceneView = "camera" | "overview";

/** A picture of the scene, as Blender rendered it for the 3D view. */
export type ScenePreview = {
  /** A JPEG, base64-encoded. */
  readonly data: string;
  readonly width: number;
  readonly height: number;
  /** What it shows; the overview stands in when the scene has no camera. */
  readonly view: SceneView;
  /** Grows with every new picture, so the view can tell a new one apart. */
  readonly sequence: number;
  /** Drawn quickly while the view moves; a full picture follows once it stops. */
  readonly quick?: true;
  /** The scene has nothing in it to show. */
  readonly empty?: true;
};

export type ScenePanelState = {
  readonly status: "closed" | "starting" | "open" | "failed";
  /** The scene file, workspace-relative, once one is open. */
  readonly file?: string;
  /** What the person chose to look through. */
  readonly view: SceneView;
  /** Whether a command is running in the scene now. */
  readonly working: boolean;
  /** Why the scene is unusable, written to be read by a person. */
  readonly reason?: string;
  /** How this PC draws the scene, when the person should know: one plain sentence. */
  readonly note?: string;
  readonly preview?: ScenePreview;
};

export type ConversationSceneState = {
  readonly taskId: string;
  readonly scene: ScenePanelState;
};

/**
 * What a person can do to the 3D view. Each changes only the picture, never
 * the scene: one shape rather than five commands, so the boundary has one
 * thing to check.
 */
export type SceneIntent =
  | { readonly kind: "view"; readonly view: SceneView }
  /** Turns the overview by these degrees, round and up. */
  | { readonly kind: "turn"; readonly yaw: number; readonly pitch: number }
  | { readonly kind: "zoom"; readonly factor: number }
  /** Back to the overview's first angle and distance. */
  | { readonly kind: "reset" }
  /** The size the view is drawn at, in device pixels. */
  | { readonly kind: "size"; readonly width: number; readonly height: number };

/** The views of a drawing of the scene, as the CAD studio's drawing asks for them (ADR 0022). */
export type SceneLinesRequest = {
  /** The objects drawn, by name; left out, every shape the scene shows. */
  readonly objects?: readonly string[];
  /** The straight, angled, section and auxiliary views, as the drawing names them. */
  readonly views: readonly Readonly<Record<string, unknown>>[];
};

export type SceneLinesOutcome =
  | {
      readonly ok: true;
      /** The lines of each view, as JSON, for the drafting to lay out and dimension. */
      readonly lines: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * A conversation's Blender scene as a drawing sees it: the edges of each view,
 * found by Blender's Line Art, which the CAD studio's drafting draws as it
 * draws a part's (ADR 0022). Reading them leaves the scene as it was.
 */
export type SceneLines = {
  /** Whether Blender is installed, without which no scene is drawn. */
  readonly installed: () => Promise<boolean>;
  /**
   * The scene open in the conversation, named as `workspace` has it, or
   * nothing when none is open or the open one is not in that workspace.
   */
  readonly open: (workspace: string) => Promise<string | undefined>;
  readonly lines: (
    request: SceneLinesRequest,
    options: { readonly workspace: string; readonly signal?: AbortSignal },
  ) => Promise<SceneLinesOutcome>;
};
