import type { Group, AnimationClip } from "three";

import type { MediaItem } from "../api/types";

export interface HikerModel {
  model: Group;
  clips: AnimationClip[];
}

/** The address of the Hiker's model in the media list, or null when none was seeded. */
export function hikerModelUrl(media: MediaItem[]): string | null {
  const item = media.find((entry) => entry.role === "hiker");
  return (
    item?.variants.find((variant) => variant.format === "glb")?.url ?? null
  );
}

/**
 * Fetch and parse the Hiker's model. The loader is imported here, not at the top, so it is
 * its own small download that starts only once the scene has been drawn.
 */
export async function loadHikerModel(
  url: string,
  signal?: AbortSignal,
): Promise<HikerModel> {
  const { GLTFLoader } =
    await import("three/examples/jsm/loaders/GLTFLoader.js");
  const response = await fetch(url, { credentials: "omit", signal });
  if (!response.ok)
    throw new Error(`The Hiker's model answered ${response.status}`);
  const data = await response.arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(data, "");
  return { model: gltf.scene, clips: gltf.animations };
}
