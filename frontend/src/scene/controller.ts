import {
  Color,
  Fog,
  PerspectiveCamera,
  ShaderMaterial,
  Vector3,
  type Scene,
  type WebGLRenderer,
} from "three";

import { getClimb } from "../climb/climb";
import {
  fieldOfView,
  journeyAt,
  poseAt,
  progressAt,
  stepJourney,
  trailTAt,
  type Pose,
} from "./journey";
import { HIKER_HEIGHT, type Hiker } from "./hiker";
import { lightAt } from "./light";
import { applyLightToAtmosphere } from "./materials";
import type { SceneColors } from "./palette";
import type { Parts } from "./parts";
import { registerClimbScene, type ClimbScene } from "./registry";
import { STAGE_KEYS, STAGE_TRAIL_T } from "./trail";
import type { World } from "./world";

/** The page has no side column below this width: the scene is framed for a full-width text block. */
export const NARROW = 1024;

/** A rectangle on the screen, in CSS pixels. */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Options {
  world: World;
  colors: SceneColors;
  parts: Parts;
  /** Called after the first frame has been drawn. */
  onDrawn: () => void;
  /** Debug: where to start, from `?debug&at=`. */
  pinned: number | null;
}

/**
 * Drives the camera, sky, fog and lamps from the Climb's position. It holds the journey
 * number (where the camera has eased to) and the page's number (where it is going); each
 * drawn frame it moves one toward the other and applies the light and the pose that
 * belong to the result. It is plain code with no React in it, called from the render loop.
 */
export class SceneController {
  readonly fog = new Fog(new Color(), 60, 900);
  private current: number;
  private target: number;
  private drawn = false;
  private manual: Pose | null = null;
  private readout: HTMLElement | null = null;
  private stats = { frames: 0, last: 0, fps: 0, since: 0, ms: 0 };
  private listeners = new Set<() => void>();
  private hiker: Hiker | null = null;
  private hikerBusy = false;
  private covered = false;
  private occluder: ((box: ScreenBox) => boolean) | null = null;
  private world: World;
  private parts: Parts;
  private scene: Scene | null = null;
  private pixelRatio = 1;

  constructor(private readonly options: Options) {
    this.world = options.world;
    this.parts = options.parts;
    this.current = options.pinned ?? journeyAt(getClimb());
    this.target = this.current;
  }

  /** Put the scene's objects and fog into a three.js scene. Returns the function that takes them out and frees them. */
  mount(scene: Scene): () => void {
    this.scene = scene;
    scene.add(...this.parts.objects);
    scene.fog = this.fog;
    return () => {
      scene.remove(...this.parts.objects);
      scene.fog = null;
      this.parts.dispose();
      this.scene = null;
    };
  }

  /**
   * Trade the ground and everything built on it for a cheaper one, while running. The camera's
   * place on the journey, the light, the Hiker and what subscribed to the scene are untouched,
   * so nothing in the picture moves: only the mountain's detail changes.
   */
  swap(world: World, parts: Parts) {
    const old = this.parts;
    if (this.scene) {
      this.scene.remove(...old.objects);
      this.scene.add(...parts.objects);
    }
    this.world = world;
    this.parts = parts;
    this.setPixelRatio(this.pixelRatio);
    old.dispose();
  }

  /** Where the camera has eased to along the journey. */
  get journey(): number {
    return this.current;
  }

  /** The Climb moved: ease toward its new position. */
  retarget() {
    if (this.options.pinned === null) this.target = journeyAt(getClimb());
  }

  /** Whether a further frame is needed: the camera still easing, or the Hiker still moving. */
  get settling(): boolean {
    return this.current !== this.target || this.hikerBusy;
  }

  /** Put the Hiker in the scene (it arrives after the first draw). Returns the function that takes it out. */
  attachHiker(hiker: Hiker, scene: Scene): () => void {
    this.hiker = hiker;
    this.hikerBusy = true;
    const unmount = hiker.mount(scene);
    return () => {
      unmount();
      if (this.hiker === hiker) this.hiker = null;
      this.hikerBusy = false;
      hiker.dispose();
    };
  }

  /** The Hiker, once it has loaded (debug readout and tests). */
  get walker(): Hiker | null {
    return this.hiker;
  }

  setReadout(element: HTMLElement | null) {
    this.readout = element;
  }

  /** Debug: hold a pose typed into the console, to try a composition without a reload. */
  setManualPose(values: number[] | null) {
    this.manual = values
      ? {
          position: new Vector3(values[0], values[1], values[2]),
          target: new Vector3(values[3], values[4], values[5]),
          fov: values[6],
          shift: { x: values[7] ?? 0, y: values[8] ?? 0 },
        }
      : null;
  }

  /** Give the scene a way to ask whether page content is over a screen box (the page's job, not the scene's). */
  setOccluder(occluder: ((box: ScreenBox) => boolean) | null) {
    this.occluder = occluder;
  }

  /** Where the Hiker is on the screen, as a box a little wider than its body. */
  private hikerBox(
    camera: PerspectiveCamera,
    size: { width: number; height: number },
  ): ScreenBox {
    const hiker = this.hiker!;
    const toScreen = (v: Vector3) => {
      const p = v.clone().project(camera);
      return {
        x: ((p.x + 1) / 2) * size.width,
        y: ((1 - p.y) / 2) * size.height,
      };
    };
    const feet = hiker.position.clone();
    const foot = toScreen(feet);
    const top = toScreen(feet.clone().setY(feet.y + HIKER_HEIGHT));
    const height = foot.y - top.y;
    return {
      left: foot.x - height * 0.3,
      right: foot.x + height * 0.3,
      top: top.y,
      bottom: foot.y,
    };
  }

  /** Debug: where the Hiker is on the screen and what it is doing, for measuring from the console. */
  probe(camera: PerspectiveCamera, size: { width: number; height: number }) {
    const hiker = this.hiker;
    if (!hiker) return null;
    const world = this.world;
    const project = (v: Vector3) => {
      const p = v.clone().project(camera);
      return {
        x: ((p.x + 1) / 2) * size.width,
        y: ((1 - p.y) / 2) * size.height,
      };
    };
    const feet = hiker.position.clone();
    const head = feet.clone().setY(feet.y + HIKER_HEIGHT);
    const foot = project(feet);
    const top = project(head);
    const lowest = hiker.lowestPoint();
    return {
      world: [feet.x, feet.y, feet.z],
      screen: { x: foot.x, footY: foot.y, topY: top.y, height: foot.y - top.y },
      facing: hiker.facing,
      walking: hiker.walking,
      cycles: hiker.walkCycles,
      stride: hiker.stride,
      ankles: hiker.anklePositions(),
      slip: [hiker.slipRatio(), hiker.slipRatio(true)],
      gap: lowest - world.terrain.heightAt(feet.x, feet.z),
      journey: this.current,
      visibility: hiker.visibility,
    };
  }

  /** The scene's interface for later work, offered while the scene is mounted. */
  publish(): () => void {
    const world = this.world;
    const trail = world.trail;
    const stages = STAGE_KEYS.map((key) => ({
      key,
      trailT: STAGE_TRAIL_T[key],
      position: trail.pointAt(STAGE_TRAIL_T[key]),
    }));
    const progress = () => progressAt(this.current, getClimb().stages);
    const scene: ClimbScene = {
      seed: world.seed,
      trail,
      stages,
      heightAt: (x, z) => this.world.terrain.heightAt(x, z),
      summit: new Vector3(
        world.landform.summit.x,
        world.landform.summit.y,
        world.landform.summit.z,
      ),
      progress,
      trailT: () => trailTAt(progress(), getClimb().stages),
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
    };
    const withdraw = registerClimbScene(scene);
    return () => {
      this.listeners.clear();
      withdraw();
    };
  }

  /** Tell the scene's subscribers that the rendered progress changed. */
  private announce() {
    for (const listener of [...this.listeners]) listener();
  }

  /** Pixel-size dependent parts of the materials. */
  setPixelRatio(ratio: number) {
    this.pixelRatio = ratio;
    (this.parts.stars.material as ShaderMaterial).uniforms.uScale.value = ratio;
  }

  /** One drawn frame: ease, then place the camera and set the light. */
  frame(
    camera: PerspectiveCamera,
    size: { width: number; height: number },
    gl: WebGLRenderer,
    seconds: number,
  ) {
    const { colors } = this.options;
    const world = this.world;
    const parts = this.parts;
    const before = this.current;
    this.current = stepJourney(this.current, this.target, seconds);
    if (this.current !== before) this.announce();

    const light = lightAt(this.current, colors);
    const pose = this.manual ?? poseAt(this.current, size.width < NARROW);
    const ground = world.terrain.heightAt(pose.position.x, pose.position.z);
    pose.position.y = Math.max(pose.position.y, ground + 2.5);

    camera.position.copy(pose.position);
    camera.aspect = size.width / size.height;
    camera.fov = fieldOfView(pose.fov, camera.aspect);
    camera.lookAt(pose.target);
    // Shift the picture so the mountain's interest falls on the side without text.
    camera.setViewOffset(
      size.width,
      size.height,
      -pose.shift.x * size.width,
      pose.shift.y * size.height,
      size.width,
      size.height,
    );
    camera.updateMatrixWorld();

    // The sky follows the eye, so it is always at infinity.
    parts.sky.position.copy(camera.position);
    parts.stars.position.copy(camera.position);
    const sky = (parts.sky.material as ShaderMaterial).uniforms;
    sky.uTop.value.copy(light.top);
    sky.uHorizon.value.copy(light.horizon);
    sky.uGlow.value.copy(light.glow);
    sky.uFog.value.copy(light.fog);
    sky.uSun.value.copy(light.sunDirection);
    sky.uGlowStrength.value = light.glowStrength;
    sky.uDisc.value = light.discStrength;
    const stars = (parts.stars.material as ShaderMaterial).uniforms;
    stars.uColor.value.copy(colors.star);
    stars.uAmount.value = light.stars;
    parts.stars.visible = light.stars > 0.004;

    // The camp's lantern faces the camera and burns a little brighter as the night goes.
    parts.glow.quaternion.copy(camera.quaternion);
    (parts.glow.material as ShaderMaterial).uniforms.uAmount.value =
      0.35 + 0.35 * Math.min(1, this.current / 5);

    this.fog.color.copy(light.fog);
    applyLightToAtmosphere(parts.atmosphere, light);
    parts.atmosphere.sunView.value
      .copy(light.sunDirection)
      .transformDirection(camera.matrixWorldInverse);

    parts.sun.color.copy(light.keyColor);
    parts.sun.intensity = light.keyIntensity;
    parts.sun.position.copy(light.keyDirection).multiplyScalar(100);
    parts.fill.color.copy(light.fillColor);
    parts.fill.intensity = light.fillIntensity;
    parts.hemisphere.color.copy(light.skyAmbient);
    parts.hemisphere.groundColor.copy(light.groundAmbient);
    parts.hemisphere.intensity = light.ambientIntensity;

    if (this.hiker) {
      this.hikerBusy = this.hiker.update({
        seconds,
        camera,
        stars: light.stars,
        covered: this.covered,
      });
      // Is page content over the Hiker now? If that changed, one more frame to fade.
      if (this.occluder) {
        const covered = this.occluder(this.hikerBox(camera, size));
        if (covered !== this.covered) {
          this.covered = covered;
          this.hikerBusy = true;
        }
      }
    }

    if (!this.drawn) {
      this.drawn = true;
      // After this frame has been painted: the page can now show the scene.
      requestAnimationFrame(() => requestAnimationFrame(this.options.onDrawn));
    }
    if (this.readout) this.report(gl, camera);
  }

  /** The debug readout: frames per second, triangles, draw calls. Plain text, never React state. */
  private report(gl: WebGLRenderer, camera: PerspectiveCamera) {
    const stats = this.stats;
    const now = performance.now();
    if (stats.last) {
      const elapsed = now - stats.last;
      stats.ms = stats.ms ? stats.ms * 0.9 + elapsed * 0.1 : elapsed;
      stats.fps = 1000 / stats.ms;
    }
    stats.last = now;
    stats.frames += 1;
    stats.since += 1;
    if (stats.since < 10 && stats.frames > 2) return;
    stats.since = 0;
    const info = gl.info;
    const p = camera.position;
    if (this.readout) {
      this.readout.textContent = [
        `${stats.fps.toFixed(0)} fps  ${stats.ms.toFixed(1)} ms per frame`,
        `triangles ${info.render.triangles}`,
        `draw calls ${info.render.calls}`,
        `geometries ${info.memory.geometries}  textures ${info.memory.textures}`,
        `frames drawn ${info.render.frame}`,
        `journey ${this.current.toFixed(3)}  pixel ratio ${gl.getPixelRatio().toFixed(2)}`,
        `hiker ${this.hiker ? `${this.hiker.position.x.toFixed(1)} ${this.hiker.position.z.toFixed(1)} walk ${this.hiker.walking.toFixed(2)}` : "none"}`,
        `camera ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} fov ${camera.fov.toFixed(0)}`,
      ].join("\n");
    }
  }
}
