import type { ClimbState } from "./climb";

/** The number of Stages. The scene's trail has the same five, in the same order. */
export const STAGE_COUNT = 5;

/**
 * The journey is one number, `u`: 0 on the opening screen, 1 to 5 at the five Stages and 6
 * at the Summit. This is the page's side of it (no 3D in here), shared by the scene's camera
 * and the still tier's pictures.
 */

/** Spacing for the Stages when the page has not measured them yet. */
const EVEN = Array.from(
  { length: STAGE_COUNT },
  (_, i) => i / (STAGE_COUNT - 1),
);

/**
 * Where the Visitor is on the journey, from the Climb's position. The opening screen is 0 to
 * 1 (`lead`), the Stages 1 to 5 by where each really sits on the page, and the Summit's
 * stretch 5 to 6 (`tail`). Continuous at the joins, so scrolling back reverses it exactly.
 */
export function journeyAt(
  climb: Pick<ClimbState, "progress" | "lead" | "tail" | "stages">,
): number {
  const { progress } = climb;
  if (progress <= 0) return climb.lead;
  if (progress >= 1) return STAGE_COUNT + climb.tail;
  const marks = marksOf(climb.stages);
  for (let i = 0; i < marks.length - 1; i++) {
    if (progress <= marks[i + 1]) {
      const span = marks[i + 1] - marks[i];
      return 1 + i + (span > 0 ? (progress - marks[i]) / span : 0);
    }
  }
  return STAGE_COUNT;
}

/** The Stages' progress values, falling back to even spacing before the page is measured. */
export function marksOf(stages: ClimbState["stages"]): number[] {
  return stages.length === STAGE_COUNT ? stages.map((s) => s.position) : EVEN;
}

/** The progress value for a point on the journey: the inverse of `journeyAt` across the Stages. */
export function progressAt(u: number, stages: ClimbState["stages"]): number {
  if (u <= 1) return 0;
  if (u >= STAGE_COUNT) return 1;
  const marks = marksOf(stages);
  const i = Math.min(marks.length - 2, Math.floor(u - 1));
  return lerp(marks[i], marks[i + 1], u - 1 - i);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
