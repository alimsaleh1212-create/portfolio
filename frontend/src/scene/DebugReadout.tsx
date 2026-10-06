import { forwardRef } from "react";

export interface DebugStats {
  frames: number;
  last: number;
  fps: number;
  sinceReport: number;
  frameMs: number;
}

/**
 * The performance readout behind `?debug`: frames per second, triangles and draw calls, as
 * the renderer reports them. It is plain text updated from the render loop, never React state.
 */
export const DebugReadout = forwardRef<HTMLPreElement>(
  function DebugReadout(_props, ref) {
    return (
      <pre
        ref={ref}
        data-testid="scene-debug"
        className="bg-ground/80 text-ink rounded-control pointer-events-none fixed right-3 bottom-3 z-50 p-3 font-mono text-sm"
      />
    );
  },
);
