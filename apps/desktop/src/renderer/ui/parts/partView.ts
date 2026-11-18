import {
  Box3,
  DirectionalLight,
  EdgesGeometry,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  cameraPosition,
  fittingDistance,
  startingOrbit,
  type Orbit,
} from "./orbit.js";

/** Parts read from their mesh, ready to draw and not yet on screen. */
export type ParsedParts = {
  /** Draws them in place of the parts before. */
  show(): void;
  /** Lets them go without drawing them. */
  discard(): void;
};

/** What the part view asks of its drawing. */
export type PartView = {
  /**
   * Reads parts from a glTF binary. Nothing changes on screen until they are
   * shown, so whoever asked can still decide they are no longer wanted.
   */
  parse(model: Uint8Array): Promise<ParsedParts>;
  look(orbit: Orbit): void;
  /** The size it is drawn at, in CSS pixels, and the screen's pixel ratio. */
  resize(width: number, height: number, ratio: number): void;
  dispose(): void;
};

/** Each part's own muted tone, in the order the script showed them. */
const tones = [0xc6cbd2, 0xc9bfa9, 0xa9bcc9, 0xbfc9a9, 0xc9a9b4, 0xb4a9c9];
/** Edges drawn where faces meet at more than this many degrees. */
const creaseAngle = 25;
const fieldOfView = 32;

/**
 * The parts drawn with WebGL, as a CAD program shows them: matte, each part
 * its own tone, with the edges where faces meet drawn over them. It draws
 * only when asked, never on a loop. Throws when this computer cannot draw
 * with WebGL.
 */
export function createPartView(canvas: HTMLCanvasElement): PartView {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0x7d828a, 1.7));
  // Over the viewer's shoulder, so the faces turned to them are lit.
  const key = new DirectionalLight(0xffffff, 1.6);
  scene.add(key);
  const camera = new PerspectiveCamera(fieldOfView, 1, 0.01, 100);
  let parts: Object3D | undefined;
  let centre: [number, number, number] = [0, 0, 0];
  let radius = 1;
  let corners: [number, number, number][] = [];
  let orbit = startingOrbit;

  const draw = () => {
    const fits = corners.length
      ? fittingDistance(corners, fieldOfView, camera.aspect)
      : radius * 4;
    camera.position.set(...cameraPosition(orbit, centre, fits));
    camera.near = Math.max(fits * orbit.distance - radius * 2, radius / 100);
    camera.far = fits * orbit.distance + radius * 4;
    camera.updateProjectionMatrix();
    camera.lookAt(new Vector3(...centre));
    key.position.copy(camera.position).add(new Vector3(radius, radius * 2, 0));
    key.target.position.set(...centre);
    key.target.updateMatrixWorld();
    renderer.render(scene, camera);
  };

  return {
    async parse(model) {
      const loaded = await new GLTFLoader().parseAsync(
        model.slice().buffer,
        "",
      );
      const root = loaded.scene;
      let index = 0;
      // Each part is a node the script named; its meshes take its tone.
      for (const part of root.children.length ? root.children : [root]) {
        const tone = tones[index++ % tones.length]!;
        part.traverse((node) => {
          if (!(node instanceof Mesh)) return;
          disposeMaterial(node.material);
          node.material = new MeshStandardMaterial({
            color: tone,
            roughness: 0.62,
            metalness: 0.04,
            // Pushed back a little, so the edges drawn on it stay in front.
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          });
          node.add(
            new LineSegments(
              new EdgesGeometry(node.geometry, creaseAngle),
              new LineBasicMaterial({ color: 0x2c3036 }),
            ),
          );
        });
      }
      return {
        show() {
          if (parts) {
            scene.remove(parts);
            disposeTree(parts);
          }
          parts = root;
          scene.add(root);
          const box = new Box3().setFromObject(root);
          const middle = box.getCenter(new Vector3());
          const half = box.getSize(new Vector3()).multiplyScalar(0.5);
          centre = [middle.x, middle.y, middle.z];
          radius = half.length() > 0 ? half.length() : 1;
          corners = [-1, 1].flatMap((i) =>
            [-1, 1].flatMap((j) =>
              [-1, 1].map((k): [number, number, number] => [
                i * half.x,
                j * half.y,
                k * half.z,
              ]),
            ),
          );
          draw();
        },
        discard() {
          disposeTree(root);
        },
      };
    },
    look(next) {
      orbit = next;
      draw();
    },
    resize(width, height, ratio) {
      if (width < 1 || height < 1) return;
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      draw();
    },
    dispose() {
      if (parts) disposeTree(parts);
      renderer.dispose();
    },
  };
}

function disposeMaterial(material: Material | Material[]) {
  for (const each of Array.isArray(material) ? material : [material])
    each.dispose();
}

function disposeTree(root: Object3D) {
  root.traverse((node) => {
    if (node instanceof Mesh || node instanceof LineSegments) {
      node.geometry.dispose();
      disposeMaterial(node.material);
    }
  });
}
