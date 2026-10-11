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
