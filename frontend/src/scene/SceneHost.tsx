import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { readDebug, sceneSupported } from "./support";

// The 3D code is its own download: nothing here imports three or the scene until it is wanted.
const SceneCanvas = lazy(() => import("./SceneCanvas"));

/** If drawing the scene throws (no context, a failed shader), the page carries on without it. */
class SceneBoundary extends Component<
  { children: ReactNode; onFail: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Marks the page as having a scene behind it, so the stylesheet lets it show through. */
function setSceneOn(on: boolean) {
  if (on) document.documentElement.dataset.scene = "on";
  else delete document.documentElement.dataset.scene;
}

/**
 * The 3D mountain behind the Climb. It mounts after the page's text has been painted, and
 * only where WebGL works and the Visitor has not asked for less motion. Everywhere else it
 * renders nothing, and the page looks as it did without it. Leaving the page unmounts it,
 * and with it the canvas, the renderer and its context.
 */
export function SceneHost() {
  const [wanted, setWanted] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Let the text paint first; the 3D code is fetched only after that.
    let cancelled = false;
    const start = () => {
      if (!cancelled && sceneSupported()) setWanted(true);
    };
    let cancel: () => void;
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(start, { timeout: 1500 });
      cancel = () => window.cancelIdleCallback(handle);
    } else {
      const handle = window.setTimeout(start, 120);
      cancel = () => window.clearTimeout(handle);
    }
    return () => {
      cancelled = true;
      cancel();
    };
  }, []);

  useEffect(() => {
    setSceneOn(drawn && !failed);
    return () => setSceneOn(false);
  }, [drawn, failed]);

  if (!wanted || failed) return null;
  const { debug, at } = readDebug(window.location.search);
  return (
    <div
      aria-hidden="true"
      data-testid="scene"
      data-drawn={drawn ? "" : undefined}
      className="scene-layer pointer-events-none fixed inset-0 -z-10"
    >
      <SceneBoundary onFail={() => setFailed(true)}>
        <Suspense fallback={null}>
          <SceneCanvas
            debug={debug}
            pinned={at}
            onDrawn={() => setDrawn(true)}
            onLost={() => setFailed(true)}
          />
        </Suspense>
      </SceneBoundary>
      {/* Behind the altitude meter's rail on wide screens, so its labels stay readable. */}
      <div className="bg-rail-shade absolute inset-y-0 right-0 hidden w-72 lg:block" />
    </div>
  );
}
