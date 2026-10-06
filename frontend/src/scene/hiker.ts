import {
  AnimationMixer,
  Box3,
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type BufferGeometry,
  type Material,
  type PerspectiveCamera,
  type Scene,
} from "three";

import { createGlowMaterial } from "./materials";
import { lerp } from "./noise";
import type { SceneColors } from "./palette";
import type { ClimbScene } from "./registry";

/**
 * The Hiker: the figure who stands for Ali on the trail. It reads the scene's interface
 * (`trailT`, the trail, `heightAt`, the Summit) and nothing else of the scene. It puts the
 * model on the trail, turns it to face its way, plays the walk only as fast as the ground
 * goes by, and lets it come to rest. `update` says whether it needs another frame, so a
 * Hiker at rest draws nothing.
 */

/** The Hiker's height in scene units, hood to boots. A pine is about 5; a tent about 3. */
export const HIKER_HEIGHT = 3.4;
/** Below this ground speed (scene units a second) the Hiker is standing, not walking. */
const MOVING_SPEED = 0.2;
/** The walk plays at most this many cycles a second, so a hard fling does not strobe. */
const MAX_CYCLES_PER_SECOND = 4;
/** How quickly the walk fades in and out, and how quickly the Hiker turns, per second. */
const BLEND_RATE = 14;
const TURN_RATE = 7;
/** From here the Hiker is at High Camp, where the Climb ends. */
const AT_HIGH_CAMP = 0.9995;
/** A frame after a long pause counts as one ordinary frame. */
const LONGEST_FRAME = 0.25;

export const WALK = "Walking_A";
export const IDLE = "Idle";

/** The heading (radians about the vertical, 0 facing +z) that looks along a direction on the ground. */
export function headingOf(x: number, z: number): number {
  return Math.atan2(x, z);
}

/** The shortest turn from one heading to another, in (-pi, pi]. */
export function turnBetween(from: number, to: number): number {
  const turn = (to - from) % (2 * Math.PI);
  if (turn > Math.PI) return turn - 2 * Math.PI;
  if (turn <= -Math.PI) return turn + 2 * Math.PI;
  return turn;
}

/**
 * The walk cycle's relation to the ground: `travel[i]` is how far the body has to have gone, in
 * scene units, for the foot on the ground to have moved back as far as the animation moves it
 * by sample `i` of the cycle. It is made from the animation itself, so a foot on the ground
 * stays where it is however unevenly the animation moves it, and it ends at the stride: the
 * ground one whole cycle covers.
 */
export interface Gait {
  /** Ground covered by one cycle, in scene units. */
  stride: number;
  /** Cumulative ground at each of `samples + 1` evenly spaced points of the cycle. */
  travel: number[];
}

/** How far through the walk cycle (0 to 1) the body is, after it has gone `ground` along the trail. */
export function phaseAt(gait: Gait, ground: number): number {
  const { stride, travel } = gait;
  if (stride <= 0 || travel.length < 2) return 0;
  const samples = travel.length - 1;
  const cycles = Math.floor(ground / stride);
  const along = ground - cycles * stride;
  let low = 0;
  let high = samples;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (travel[mid] <= along) low = mid;
    else high = mid;
  }
  const span = travel[high] - travel[low];
  const fraction = span > 0 ? (along - travel[low]) / span : 0;
  return Math.min(1 - 1e-9, (low + fraction) / samples);
}

/** The lantern's strength: lit while stars show, gone as the sun comes. `stars` is the light's 0 to 1. */
export function lanternAmount(stars: number): number {
  return Math.min(1, Math.max(0, stars * 1.8));
}

/** A bone by name, whether or not the loader stripped the dot from `hand.l`. */
function findByName(root: Object3D, name: string): Object3D | undefined {
  const plain = name.replace(/[^A-Za-z0-9]/g, "");
  let found: Object3D | undefined;
  root.traverse((object) => {
    if (!found && object.name.replace(/[^A-Za-z0-9]/g, "") === plain)
      found = object;
  });
  return found;
}

/**
 * Measure the walk against the ground (see `Gait`): at each step through the cycle, how far
 * back the foot that is lower moves. Walking is driven by this, so the planted foot is held
 * still on the ground; the other foot is in the air and may do as it likes.
 */
export function measureGait(
  figure: Object3D,
  mixer: AnimationMixer,
  walk: AnimationAction,
  samples = 96,
): Gait {
  const left = findByName(figure, "foot.l");
  const right = findByName(figure, "foot.r");
  const none = { stride: 0, travel: [0, 0] };
  if (!left || !right) return none;
  figure.parent?.updateMatrixWorld(true);
  const duration = walk.getClip().duration;
  const a = new Vector3();
  const b = new Vector3();
  const rows: { y: number[]; z: number[] }[] = [];
  for (let i = 0; i <= samples; i++) {
    walk.time = (i / samples) * duration;
    mixer.update(0);
    figure.updateMatrixWorld(true);
    left.getWorldPosition(a);
    right.getWorldPosition(b);
    rows.push({ y: [a.y, b.y], z: [a.z, b.z] });
  }
  const steps: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const foot = rows[i].y[0] < rows[i].y[1] ? 0 : 1;
    steps.push(Math.max(0, rows[i - 1].z[foot] - rows[i].z[foot]));
  }
  const total = steps.reduce((sum, step) => sum + step, 0);
  if (total <= 0) return none;
  // The cycle never stands still: a floor keeps the table strictly rising, so it can be inverted.
  const floor = (total / steps.length) * 0.05;
  const travel = [0];
  for (const step of steps)
    travel.push(travel[travel.length - 1] + step + floor);
  return { stride: travel[travel.length - 1], travel };
}

export interface HikerOptions {
  scene: ClimbScene;
  model: Group;
  clips: AnimationClip[];
  colors: SceneColors;
}

/** What the Hiker needs to know about the light and the camera each frame. */
export interface HikerFrame {
  seconds: number;
  camera: PerspectiveCamera;
  /** The sky's stars, 0 to 1: the lantern burns while there are stars. */
  stars: number;
}

export class Hiker {
  /** Put this in the three.js scene. It is placed on the trail. */
  readonly object = new Group();
  /** The lantern's glow: also goes in the scene, since it is drawn on its own. */
  readonly glow: Mesh;
  private readonly figure = new Group();
  private readonly mixer: AnimationMixer;
  private readonly walk: AnimationAction;
  private readonly idle: AnimationAction;
  private readonly lantern: Mesh;
  private readonly glowMaterial: ShaderMaterial;
  private readonly lanternMaterial: MeshBasicMaterial;
  private readonly owned: Array<BufferGeometry | Material> = [];
  private readonly scale: number;
  /** The walk against the ground, measured from the model. */
  private readonly gait: Gait;
  /** Ground the Hiker covers in a walk cycle, in scene units. */
  readonly stride: number;
  private distance: number | null = null;
  /** Ground walked so far, in scene units, which the cycle is read from. */
  private travel = 0;
  private blend = 0;
  private heading = 0;
  private started = false;
  private readonly feet: Object3D[];
  private readonly world = new Vector3();
  private readonly lanternBox = new Vector3();

  constructor(private readonly options: HikerOptions) {
    const { model, clips, colors } = options;
    const bounds = new Box3().setFromObject(model);
    this.scale = HIKER_HEIGHT / Math.max(0.001, bounds.max.y - bounds.min.y);
    this.figure.add(model);
    this.figure.scale.setScalar(this.scale);
    // Stand the sole of the lowest foot on the origin.
    this.figure.position.y = -bounds.min.y * this.scale;
    this.object.add(this.figure);
    this.object.frustumCulled = false;
    model.traverse((child) => {
      child.frustumCulled = false;
    });

    this.mixer = new AnimationMixer(model);
    const walkClip = clips.find((c) => c.name === WALK);
    const idleClip = clips.find((c) => c.name === IDLE);
    if (!walkClip) throw new Error("The Hiker's model has no walk animation");
    this.walk = this.mixer.clipAction(walkClip);
    this.idle = this.mixer.clipAction(idleClip ?? walkClip);
    for (const action of [this.walk, this.idle]) {
      action.play();
      action.timeScale = 0;
    }
    this.feet = [
      findByName(model, "foot.l"),
      findByName(model, "foot.r"),
    ].filter((bone): bone is Object3D => bone !== undefined);
    // Measured with only the walk showing and the figure already scaled: scene units.
    this.walk.setEffectiveWeight(1);
    this.idle.setEffectiveWeight(0);
    this.gait = measureGait(model, this.mixer, this.walk);
    this.stride = this.gait.stride;
    this.idle.time = 0;
    this.applyPose(0);

    // The lantern: a small lit box in the left hand, and a glow that follows it.
    this.lanternMaterial = new MeshBasicMaterial({
      color: colors["first-light"],
      fog: false,
    });
    const lanternGeometry = new BoxGeometry(0.22, 0.3, 0.22);
    this.lantern = new Mesh(lanternGeometry, this.lanternMaterial);
    this.lantern.position.set(0, -0.28, 0);
    const hand = findByName(model, "handslot.l");
    (hand ?? model).add(this.lantern);
    this.glowMaterial = createGlowMaterial();
    this.glowMaterial.uniforms.uColor.value.copy(colors["first-light"]);
    const glowGeometry = new PlaneGeometry(1, 1);
    this.glow = new Mesh(glowGeometry, this.glowMaterial);
    this.glow.renderOrder = 6;
    this.glow.frustumCulled = false;
    this.owned.push(
      lanternGeometry,
      glowGeometry,
      this.lanternMaterial,
      this.glowMaterial,
    );
  }

  /** Put the Hiker in a three.js scene. Returns the function that takes it out. */
  mount(scene: Scene): () => void {
    scene.add(this.object, this.glow);
    return () => {
      scene.remove(this.object, this.glow);
    };
  }

  /** Where the Hiker stands, in scene space. */
  get position(): Vector3 {
    return this.object.position;
  }

  /** The heading the Hiker faces now, in radians about the vertical (0 faces +z). */
  get facing(): number {
    return this.heading;
  }

  /** How much of the walk is showing, 0 (standing) to 1 (walking). */
  get walking(): number {
    return this.blend;
  }

  /** How far through its walk cycle the Hiker is, as a count of cycles. */
  get walkCycles(): number {
    return this.stride > 0 ? this.travel / this.stride : 0;
  }

  private applyPose(blend: number) {
    this.walk.time =
      phaseAt(this.gait, this.travel) * this.walk.getClip().duration;
    this.walk.setEffectiveWeight(blend);
    this.idle.setEffectiveWeight(1 - blend);
    this.mixer.update(0);
  }

  /**
   * Move to where the page puts the Hiker. Returns true while the Hiker is still moving,
   * turning or settling, which is when another frame is needed.
   */
  update({ seconds, camera, stars }: HikerFrame): boolean {
    const { scene } = this.options;
    const dt = seconds > LONGEST_FRAME || seconds <= 0 ? 1 / 60 : seconds;
    const t = scene.trailT();
    const distance = t * scene.trail.length;
    const step = this.distance === null ? 0 : distance - this.distance;
    // Ground walked is measured in the Hiker's own size, so a larger one takes longer strides.
    this.distance = distance;
    const speed = Math.abs(step) / dt;
    const moving = speed > MOVING_SPEED;

    // Where it stands: on the trail, with its feet on the drawn ground.
    const point = scene.trail.pointAt(t);
    this.object.position.set(
      point.x,
      scene.heightAt(point.x, point.z),
      point.z,
    );

    // Which way it faces: along its travel, and up the trail (or toward the Summit at
    // High Camp) when it has stopped.
    const tangent = scene.trail.tangentAt(t);
    let target: number;
    if (moving) {
      target = headingOf(tangent.x, tangent.z) + (step < 0 ? Math.PI : 0);
    } else if (t >= AT_HIGH_CAMP) {
      target = headingOf(scene.summit.x - point.x, scene.summit.z - point.z);
    } else {
      target = headingOf(tangent.x, tangent.z);
    }
    if (!this.started) this.heading = target;
    const turn = turnBetween(this.heading, target);
    const turning = Math.abs(turn) > 0.002;
    this.heading = turning
      ? this.heading + turn * (1 - Math.exp(-TURN_RATE * dt))
      : target;
    this.figure.rotation.y = this.heading;

    // The walk: only while moving, a cycle for each stride of ground.
    const cap = MAX_CYCLES_PER_SECOND * this.stride * dt;
    if (moving) this.travel += Math.min(cap, Math.abs(step));
    const goal = moving ? 1 : 0;
    const fading = Math.abs(this.blend - goal) > 0.004;
    this.blend = fading
      ? lerp(this.blend, goal, 1 - Math.exp(-BLEND_RATE * dt))
      : goal;
    if (!this.started) this.blend = goal;
    this.applyPose(this.blend);

    // The lantern burns while the stars show.
    const amount = lanternAmount(stars);
    this.lantern.visible = amount > 0.02;
    this.object.updateMatrixWorld(true);
    this.lantern.getWorldPosition(this.lanternBox);
    this.glow.visible = amount > 0.01;
    this.glow.position.copy(this.lanternBox);
    this.glow.quaternion.copy(camera.quaternion);
    this.world.copy(this.lanternBox).sub(camera.position);
    const size = Math.max(4, this.world.length() * 0.14);
    this.glow.scale.setScalar(size);
    this.glowMaterial.uniforms.uAmount.value = amount * 1.6;
    this.lanternMaterial.color.copy(this.options.colors["first-light"]);

    this.started = true;
    return moving || fading || turning;
  }

  /**
   * How much the foot on the ground slides, as a fraction of the distance covered (0 is none),
   * as the body goes once round the cycle at a steady pace. With `even` the walk is run at an
   * even rate through its cycle instead of by the gait, to show what that costs. For checking
   * (the debug probe); it leaves the pose as it found it.
   */
  slipRatio(even = false, samples = 400): number {
    const [left, right] = this.feet;
    if (!left || !right || this.stride <= 0) return 0;
    const duration = this.walk.getClip().duration;
    const was = [
      this.walk.getEffectiveWeight(),
      this.idle.getEffectiveWeight(),
      this.walk.time,
    ];
    this.walk.setEffectiveWeight(1);
    this.idle.setEffectiveWeight(0);
    const at = new Vector3();
    const rows: { z: number; foot: number }[] = [];
    for (let i = 0; i <= samples; i++) {
      const ground = (i / samples) * this.stride;
      const phase = even ? i / samples : phaseAt(this.gait, ground);
      this.walk.time = phase * duration;
      this.mixer.update(0);
      this.figure.updateMatrixWorld(true);
      const points = [left, right].map((bone) => {
        bone.getWorldPosition(at);
        return this.figure.worldToLocal(at.clone()).multiplyScalar(this.scale);
      });
      const lower = points[0].y < points[1].y ? 0 : 1;
      rows.push({ z: points[lower].z, foot: lower });
    }
    let slid = 0;
    let travelled = 0;
    for (let i = 1; i < rows.length; i++) {
      const [a, b] = [rows[i - 1], rows[i]];
      if (a.foot !== b.foot) continue;
      const body = this.stride / samples;
      slid += Math.abs(body + (b.z - a.z));
      travelled += body;
    }
    this.walk.setEffectiveWeight(was[0]);
    this.idle.setEffectiveWeight(was[1]);
    this.walk.time = was[2];
    this.mixer.update(0);
    return travelled > 0 ? slid / travelled : 0;
  }

  /** Where the ankles are in scene space (the left, then the right), for checking the feet do not slide. */
  anklePositions(): number[][] {
    this.object.updateMatrixWorld(true);
    return this.feet.map((bone) =>
      bone.getWorldPosition(new Vector3()).toArray(),
    );
  }

  /** The lowest point of the Hiker's body in scene space, for checking the feet are on the ground. */
  lowestPoint(): number {
    this.object.updateMatrixWorld(true);
    const box = new Box3().setFromObject(this.object, true);
    return box.min.y;
  }

  /** Free the model's geometry, materials and textures. */
  dispose() {
    this.mixer.stopAllAction();
    this.object.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value && (value as { isTexture?: boolean }).isTexture)
            (value as { dispose: () => void }).dispose();
        }
        material.dispose();
      }
    });
    this.owned.forEach((item) => item.dispose());
  }
}

/** Unused colour parameter kept out of the public surface. */
export type { Color };
