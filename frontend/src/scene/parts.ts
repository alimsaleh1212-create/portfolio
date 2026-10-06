import {
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Points,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";

import {
  createAtmosphere,
  createGlowMaterial,
  createLitMaterial,
  createSkyMaterial,
  createStarMaterial,
} from "./materials";
import {
  buildCampGeometry,
  buildPineGeometry,
  buildRangeGeometry,
  buildStarGeometry,
  buildTrailGeometry,
  campSite,
  type TreePlan,
  SNOW_LINE,
  terrainGeometrySteps,
  treePlanSteps,
} from "./meshes";
import type { SceneColors } from "./palette";
import { QUALITY, type Quality } from "./quality";
import { drain } from "./steps";
import type { World } from "./world";

/** Everything drawn, built once from the world and the palette. */
export type Parts = ReturnType<typeof createParts>;

/** Keeps every n-th tree, so the light tier's forest is the same forest, thinner. */
function thinned(plan: TreePlan, every: number): TreePlan {
  if (every <= 1) return plan;
  const kept: number[] = [];
  for (let i = 0; i < plan.count; i += every) {
    kept.push(...Array.from(plan.data.subarray(i * 6, i * 6 + 6)));
  }
  return { data: new Float32Array(kept), count: kept.length / 6 };
}

/**
 * The scene's objects: sky and stars, the far ranges, the ground, the trail, the pines,
 * High Camp and its lantern, and the lamps. Six or seven draw calls in all. `dispose`
 * frees every geometry and material, so leaving the page leaks nothing.
 */
export function createParts(
  world: World,
  colors: SceneColors,
  quality: Quality = "full",
) {
  return drain(partsSteps(world, colors, quality));
}

/** `createParts` as pausable work, so the build does not freeze the page (see `steps.ts`). */
export function* partsSteps(
  world: World,
  colors: SceneColors,
  quality: Quality = "full",
) {
  const settings = QUALITY[quality];
  const atmosphere = createAtmosphere(world.landform.summit.y, SNOW_LINE);

  const sky = new Mesh(new SphereGeometry(500, 24, 12), createSkyMaterial());
  sky.frustumCulled = false;
  sky.renderOrder = -20;

  const starMaterial = createStarMaterial();
  const stars = new Points(buildStarGeometry(settings.stars), starMaterial);
  stars.frustumCulled = false;
  stars.renderOrder = -10;

  const rangeMaterial = createLitMaterial(atmosphere, {});
  const ranges = new Mesh(buildRangeGeometry(colors), rangeMaterial);
  ranges.frustumCulled = false;

  const terrainMaterial = createLitMaterial(atmosphere, {
    shade: true,
    summit: true,
  });
  yield;
  const terrain = new Mesh(
    yield* terrainGeometrySteps(world.terrain, colors),
    terrainMaterial,
  );
  terrain.frustumCulled = false;

  const trailMaterial = createLitMaterial(atmosphere, { vertexColors: false });
  trailMaterial.color.copy(colors.trail);
  // The path holds a little of the sky's light, so it can be followed even at night.
  trailMaterial.emissive.copy(colors.trail).multiplyScalar(0.3);
  trailMaterial.polygonOffset = true;
  trailMaterial.polygonOffsetFactor = -2;
  trailMaterial.polygonOffsetUnits = -2;
  const trail = new Mesh(buildTrailGeometry(world), trailMaterial);
  trail.frustumCulled = false;

  yield;
  const full = yield* treePlanSteps(world);
  const plan = thinned(full, settings.pineEvery);
  const pine = buildPineGeometry();
  const treeMaterial = createLitMaterial(atmosphere, { vertexColors: false });
  const trees = new InstancedMesh(pine, treeMaterial, Math.max(1, plan.count));
  trees.count = plan.count;
  trees.instanceMatrix.setUsage(DynamicDrawUsage);
  const matrix = new Matrix4();
  const tint = new Color();
  const dark = colors.pine.clone().lerp(colors["light-ground"], 0.3);
  const quaternion = new Quaternion();
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < plan.count; i++) {
    const [x, y, z, h, w, t] = Array.from(plan.data.subarray(i * 6, i * 6 + 6));
    quaternion.setFromAxisAngle(up, t * 6.28);
    matrix.compose(
      new Vector3(x, y, z),
      quaternion,
      new Vector3(w, h / 4.4, w),
    );
    trees.setMatrixAt(i, matrix);
    tint.copy(colors.pine).lerp(dark, t);
    trees.setColorAt(i, tint);
  }
  trees.instanceMatrix.needsUpdate = true;
  if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
  trees.frustumCulled = false;

  const campMaterial = createLitMaterial(atmosphere, {});
  const camp = new Mesh(buildCampGeometry(world, colors), campMaterial);
  camp.frustumCulled = false;
  const site = campSite(world);
  const glowMaterial = createGlowMaterial();
  glowMaterial.uniforms.uColor.value.copy(colors["first-light"]);
  const glow = new Mesh(new PlaneGeometry(14, 14), glowMaterial);
  glow.position.set(site.x + 0.2, site.y + 2.2, site.z + 2.2);
  glow.renderOrder = 5;

  const hemisphere = new HemisphereLight();
  const sun = new DirectionalLight();
  const fill = new DirectionalLight();
  fill.position.set(60, 40, 75);

  const geometries: BufferGeometry[] = [
    sky.geometry,
    stars.geometry,
    ranges.geometry,
    terrain.geometry,
    trail.geometry,
    pine,
    camp.geometry,
    glow.geometry,
  ];
  const materials: Material[] = [
    sky.material as Material,
    starMaterial,
    rangeMaterial,
    terrainMaterial,
    trailMaterial,
    treeMaterial,
    campMaterial,
    glowMaterial,
  ];
  return {
    atmosphere,
    sky,
    stars,
    ranges,
    terrain,
    trail,
    trees,
    camp,
    glow,
    hemisphere,
    sun,
    fill,
    /** Everything that goes into the three.js scene. */
    objects: [
      sky,
      stars,
      ranges,
      terrain,
      trail,
      trees,
      camp,
      glow,
      hemisphere,
      sun,
      fill,
    ],
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      trees.dispose();
    },
  };
}
