export type DeviceClass = "phone" | "tablet" | "desktop";

/** Shorter screen sides, in CSS pixels, below which a touch device is a phone or a tablet. */
const PHONE_BELOW = 600;
const TABLET_BELOW = 1024;

/**
 * The one place the device class is decided.
 *
 * A device whose primary pointer is coarse (a finger) is a phone or a tablet,
 * told apart by the shorter side of its screen, which does not change when it
 * is turned. Anything else, including a laptop with a touch screen whose
 * primary pointer is a mouse, is a desktop. The class is only ever one of the
 * three words, never a user agent or a screen size.
 */
export function deviceClass(): DeviceClass {
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  if (!coarse) return "desktop";
  const shorterSide = Math.min(window.screen.width, window.screen.height);
  if (shorterSide < PHONE_BELOW) return "phone";
  if (shorterSide < TABLET_BELOW) return "tablet";
  return "desktop";
}
