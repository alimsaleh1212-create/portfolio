import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { PerspectiveCamera } from "three";

import { subscribeClimb } from "../climb/climb";
import { SceneController } from "./controller";
import { DebugReadout } from "./DebugReadout";
import { createParts } from "./parts";
import { readSceneColors } from "./palette";
import { watchVisibility } from "./visibility";
import { createWorld } from "./world";

const MAX_PIXEL_RATIO = 1.5;

interface Props {
  /** Show the frames per second, triangles and draw calls; draw every frame so they mean something. */
  debug: boolean;
  /** Called after the first frame has been drawn. */
  onDrawn: () => void;
  /** Called if the graphics context is lost, so the page can carry on without the scene. */
  onLost: () => void;
  /** Pins the camera at a point on the journey (debug only): `?debug&at=3.5`. */
  pinned?: number | null;
}

/** The canvas, and everything in it. This module and what it imports are the scene's own download. */
export default function SceneCanvas({
  debug,
  onDrawn,
  onLost,
  pinned = null,
}: Props) {
  const readout = useRef<HTMLPreElement>(null);
  return (
    <>
      <Canvas
        frameloop={debug ? "always" : "demand"}
        dpr={[1, MAX_PIXEL_RATIO]}
        flat
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        }}
        camera={{ fov: 50, near: 0.5, far: 1800, position: [0, 10, 120] }}
        style={{ position: "absolute", inset: 0 }}
        aria-hidden="true"
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", onLost);
        }}
      >
        <Mountain
          debug={debug}
          pinned={pinned}
          onDrawn={onDrawn}
          readout={readout}
        />
      </Canvas>
      {debug && <DebugReadout ref={readout} />}
    </>
  );
}

/** Builds the mountain from the seed and the page's colour tokens, and drives it from the Climb. */
function Mountain({
  debug,
  pinned,
  onDrawn,
  readout,
}: {
  debug: boolean;
  pinned: number | null;
  onDrawn: () => void;
  readout: React.RefObject<HTMLPreElement | null>;
}) {
  const { scene, size, gl, invalidate, setFrameloop } = useThree();
  const built = useMemo(() => {
    const colors = readSceneColors();
    const world = createWorld();
    const parts = createParts(world, colors);
    const controller = new SceneController({
      world,
      colors,
      parts,
      onDrawn,
      pinned,
    });
    return { controller };
    // The scene is built once for this canvas; its props are fixed for its life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { controller } = built;

  // Put the objects in the scene, and take them out and free them when the page is left.
  useEffect(() => controller.mount(scene), [scene, controller]);

  // The page's position is the target. The camera eases toward it.
  useEffect(
    () =>
      subscribeClimb(() => {
        controller.retarget();
        invalidate();
      }),
    [controller, invalidate],
  );

  // Nothing is drawn while the tab is hidden; coming back draws one frame at once.
  useEffect(
    () =>
      watchVisibility(document, (hidden) => {
        setFrameloop(hidden ? "never" : debug ? "always" : "demand");
        if (!hidden) invalidate();
      }),
    [setFrameloop, invalidate, debug],
  );

  // Offer the scene's interface to the rest of the app while it is mounted.
  useEffect(() => controller.publish(), [controller]);

  useEffect(() => {
    controller.setPixelRatio(gl.getPixelRatio());
    invalidate();
  }, [controller, gl, size, invalidate]);

  // Debug only: the readout, and a hook to try a camera pose without a reload.
  useEffect(() => {
    if (!debug) return;
    controller.setReadout(readout.current);
    const hook = window as unknown as {
      setScenePose?: (values: number[] | null) => void;
    };
    hook.setScenePose = (values) => {
      controller.setManualPose(values);
      invalidate();
    };
    return () => {
      controller.setReadout(null);
      delete hook.setScenePose;
    };
  }, [debug, controller, readout, invalidate]);

  useFrame((state, delta) => {
    controller.frame(
      state.camera as PerspectiveCamera,
      state.size,
      state.gl,
      delta,
    );
    // Ask for another frame only while the camera is still easing toward the page.
    if (controller.settling) state.invalidate();
  });

  return null;
}
