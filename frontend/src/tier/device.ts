import type { DeviceReport } from "./decide";

/** Renderer names that mean the graphics are drawn by the CPU. */
const SOFTWARE_RENDERER =
  /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render|mesa offscreen/i;

interface NavigatorHints {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  connection?: { saveData?: boolean };
}

function releaseContext(gl: WebGL2RenderingContext) {
  gl.getExtension("WEBGL_lose_context")?.loseContext();
}

/** Whether the renderer is software, from its name, or null when the browser does not say. */
export function rendererIsSoftware(name: string | null): boolean | null {
  if (name === null || name === "") return null;
  return SOFTWARE_RENDERER.test(name);
}

/**
 * Makes a WebGL 2 context to see whether one exists and what draws it. The context is
 * released at once, so it does not count against the browser's limit.
 */
function probeWebGl(): Pick<DeviceReport, "webgl2" | "software"> {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return { webgl2: false, software: null };
    let name: string | null = null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    if (info) name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
    releaseContext(gl);
    let software = rendererIsSoftware(name);
    if (software !== true) {
      // A browser may hide the renderer's name but still refuse a context that would be slow.
      const strict = document.createElement("canvas");
      const hardware = strict.getContext("webgl2", {
        failIfMajorPerformanceCaveat: true,
      });
      if (hardware) {
        releaseContext(hardware);
        software = software ?? false;
      } else {
        software = true;
      }
    }
    return { webgl2: true, software };
  } catch {
    return { webgl2: false, software: null };
  }
}

/** Reads what the browser says about the device. Quick: no network, no waiting. */
export function readDevice(): DeviceReport {
  const hints = navigator as unknown as NavigatorHints;
  const memory = hints.deviceMemory;
  const cores = hints.hardwareConcurrency;
  return {
    ...probeWebGl(),
    reducedMotion:
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    saveData: hints.connection?.saveData === true,
    memoryGb: typeof memory === "number" && memory > 0 ? memory : null,
    cores: typeof cores === "number" && cores > 0 ? cores : null,
  };
}
