import { prefersReducedMotion } from "../climb/climb";

/**
 * Whether the scene may be drawn at all: not where less motion is asked for, and only where
 * a WebGL context can be made. The test context is released at once, so it does not count
 * against the browser's limit. (Ticket #17 replaces this simple rule with the three tiers.)
 */
export function sceneSupported(): boolean {
  if (typeof document === "undefined") return false;
  if (prefersReducedMotion()) return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** The debug view is asked for in the address: `?debug`. Optionally `&at=3.5` pins the view. */
export function readDebug(search: string): {
  debug: boolean;
  at: number | null;
} {
  const params = new URLSearchParams(search);
  if (!params.has("debug")) return { debug: false, at: null };
  const at = Number(params.get("at"));
  return {
    debug: true,
    at:
      params.get("at") !== null && Number.isFinite(at)
        ? Math.min(6, Math.max(0, at))
        : null,
  };
}
