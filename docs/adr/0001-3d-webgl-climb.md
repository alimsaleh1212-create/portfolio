---
status: accepted
---

# The Climb is rendered as a 3D WebGL scene

The Climb is a scroll-driven 3D WebGL scene: a procedurally generated, stylised low-poly mountain lit from pre-dawn at the Trailhead to sunrise at High Camp, with a small Hiker model the camera follows. Ali chose this over a layered 2D illustration because the spectacle of a real mountain is the point of the story, accepting that it costs more to build and runs worse on phones.

## Considered Options

- **Illustrated 2D with parallax**: light, sharp on every screen, and the recommended option on performance grounds. Rejected as not striking enough.
- **Photographic backgrounds**: rejected because no hiking footage exists.

## Consequences

- Devices are served one of three tiers: the full scene, a lighter scene (lower resolution, fewer effects), or a still image per Stage with the same text where WebGL is unavailable or reduced motion is requested. The still tier is a requirement, not a nice-to-have.
- All text lives in ordinary page elements over the scene, never inside the canvas, so it stays readable to search engines and screen readers.
- The mountain is generated in code, so there is no terrain asset to license; the Hiker model is the one external 3D asset and must carry a free licence.
