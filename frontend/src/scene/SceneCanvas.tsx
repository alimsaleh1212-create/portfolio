import { Canvas, useFrame, useStore, useThree } from "@react-three/fiber";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PerspectiveCamera } from "three";

import { mediaQuery } from "../api/client";
import { subscribeClimb } from "../climb/climb";
import { SceneController } from "./controller";
import { DebugReadout } from "./DebugReadout";
import { Hiker } from "./hiker";
import { contentOver } from "./occlusion";
import { hikerModelUrl, loadHikerModel } from "./hikerModel";
import { partsSteps } from "./parts";
import { readSceneColors, type SceneColors } from "./palette";
import { MOUNTAIN_SEED } from "./landform";
import { createSlowWatch } from "./frameWatch";
import { QUALITY, type Quality } from "./quality";
import { drainAsync } from "./steps";
import { watchVisibility } from "./visibility";
import { getClimbScene } from "./registry";
import { worldSteps } from "./world";

/** The mountain, built in slices so the page stays responsive, and how long the longest slice held it. */
async function buildMountain(quality: Quality, colors: SceneColors) {
  const world = await drainAsync(worldSteps(MOUNTAIN_SEED, quality));
  const parts = await drainAsync(partsSteps(world.value, colors, quality));
  return {
    world: world.value,
    parts: parts.value,
    longestSliceMs: Math.max(world.longestSliceMs, parts.longestSliceMs),
  };
}

interface Built {
  controller: SceneController;
  colors: SceneColors;
}

interface Props {
  /** The tier being drawn. Changing it from full to light swaps the mountain's detail in place. */
  quality: Quality;
  /** Called when full-tier frames have stayed slow while the Visitor scrolls. */
  onSlow: () => void;
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
  quality,
  onSlow,
  debug,
  onDrawn,
  onLost,
  pinned = null,
}: Props) {
  const readout = useRef<HTMLPreElement>(null);
  const queryClient = useQueryClient();
  // Where the Hiker's model is. Asked for only once the scene has been drawn.
  const findModel = useMemo(
    () => async () => {
      try {
        return hikerModelUrl(await queryClient.fetchQuery(mediaQuery));
      } catch {
        return null;
      }
    },
    [queryClient],
  );
  const [built, setBuilt] = useState<Built | null>(null);
  const [drawn, setDrawn] = useState(false);
  const onDrawnRef = useRef(onDrawn);
  useEffect(() => {
    onDrawnRef.current = onDrawn;
  });

  // Build the mountain in slices (the page stays responsive), then make the canvas. The ground,
  // the light and the camera are the same in every tier; the quality only sets the detail.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const colors = readSceneColors();
      const { world, parts } = await buildMountain(quality, colors);
      if (cancelled) {
        parts.dispose();
        return;
      }
      const controller = new SceneController({
        world,
        colors,
        parts,
        onDrawn: () => {
          onDrawnRef.current();
          setDrawn(true);
        },
        pinned,
      });
      setBuilt({ controller, colors });
    })();
    return () => {
      cancelled = true;
    };
    // Built once for this canvas; a later change of quality is a swap, below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!built) return null;
  return (
    <>
      <Canvas
        frameloop={debug ? "always" : "demand"}
        dpr={[1, QUALITY[quality].maxPixelRatio]}
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
          built={built}
          drawn={drawn}
          quality={quality}
          onSlow={onSlow}
          debug={debug}
          readout={readout}
          findModel={findModel}
        />
      </Canvas>
      {debug && <DebugReadout ref={readout} />}
    </>
  );
}

/** Drives the built mountain from the Climb: camera, light, the Hiker, and the swap to light. */
function Mountain({
  built,
  drawn,
  quality,
  onSlow,
  debug,
  readout,
  findModel,
}: {
  built: Built;
  drawn: boolean;
  quality: Quality;
  onSlow: () => void;
  debug: boolean;
  readout: React.RefObject<HTMLPreElement | null>;
  findModel: () => Promise<string | null>;
}) {
  const { scene, size, gl, invalidate, setFrameloop } = useThree();
  const dpr = useThree((state) => state.viewport.dpr);
  const store = useStore();
  const { controller, colors } = built;
  const builtQuality = useRef<Quality>(quality);
  const watch = useMemo(() => createSlowWatch(), []);
  const wasSettling = useRef(false);
  const onSlowRef = useRef(onSlow);
  useEffect(() => {
    onSlowRef.current = onSlow;
  });

  // A lighter tier while running: build the cheaper ground in slices, then swap it in. The
  // camera, the light and the Hiker carry on untouched, so nothing in the picture jumps.
  useEffect(() => {
    if (builtQuality.current === quality) return;
    let cancelled = false;
    void (async () => {
      const { world, parts } = await buildMountain(quality, colors);
      if (cancelled) {
        parts.dispose();
        return;
      }
      builtQuality.current = quality;
      controller.swap(world, parts);
      invalidate();
    })();
    return () => {
      cancelled = true;
    };
  }, [quality, controller, colors, invalidate]);

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

  // The Hiker comes after the scene has been drawn, never before, and its failure costs nothing.
  useEffect(() => {
    if (!drawn) return;
    const abort = new AbortController();
    let detach: (() => void) | null = null;
    void (async () => {
      try {
        const url = await findModel();
        if (!url || abort.signal.aborted) return;
        const { model, clips } = await loadHikerModel(url, abort.signal);
        const climb = getClimbScene();
        if (!climb || abort.signal.aborted) return;
        detach = controller.attachHiker(
          new Hiker({ scene: climb, model, clips, colors }),
          scene,
        );
        invalidate();
      } catch {
        // No Hiker: the mountain carries on.
      }
    })();
    return () => {
      abort.abort();
      detach?.();
    };
  }, [drawn, findModel, controller, colors, scene, invalidate]);

  useEffect(() => {
    controller.setPixelRatio(gl.getPixelRatio());
    invalidate();
  }, [controller, gl, size, dpr, invalidate]);

  // Page content over the Hiker makes it step aside. The scene itself never reads the page: this
  // is the one place that asks what is on screen at a point.
  useEffect(() => {
    controller.setOccluder(contentOver);
    return () => controller.setOccluder(null);
  }, [controller]);

  // Debug only: the readout, and a hook to try a camera pose without a reload.
  useEffect(() => {
    if (!debug) return;
    controller.setReadout(readout.current);
    const hook = window as unknown as {
      setScenePose?: (values: number[] | null) => void;
      probeHiker?: () => unknown;
      simulateFrames?: (frameMs: number, count: number) => void;
    };
    hook.probeHiker = () => {
      const { camera, size } = store.getState();
      const info = gl.info.render;
      return {
        hiker: controller.probe(camera as PerspectiveCamera, size),
        frames: info.frame,
        calls: info.calls,
      };
    };
    // Tests feed frame times by hand, so a slow run needs no slow machine and no clock. In the
    // debug view the real frames are not watched, only these.
    hook.simulateFrames = (frameMs, count) => {
      for (let i = 0; i < count; i++) {
        if (watch.push(frameMs, true)) {
          onSlowRef.current();
          return;
        }
      }
    };
    hook.setScenePose = (values) => {
      controller.setManualPose(values);
      invalidate();
    };
    return () => {
      controller.setReadout(null);
      delete hook.setScenePose;
      delete hook.probeHiker;
      delete hook.simulateFrames;
    };
  }, [debug, controller, readout, invalidate, store, gl, watch]);

  useFrame((state, delta) => {
    controller.frame(
      state.camera as PerspectiveCamera,
      state.size,
      state.gl,
      delta,
    );
    // Frames that follow one another while the camera eases are what show how the device copes.
    if (!debug && quality === "full") {
      if (watch.push(delta * 1000, wasSettling.current)) onSlowRef.current();
    }
    wasSettling.current = controller.settling;
    // Ask for another frame only while the camera is still easing toward the page.
    if (controller.settling) state.invalidate();
  });

  return null;
}
