import {
  AdditiveBlending,
  BackSide,
  Color,
  MeshLambertMaterial,
  ShaderMaterial,
  Vector3,
} from "three";

import type { SceneLight } from "./light";

/**
 * The values the lit materials share, so one update per frame reaches the ground, the far
 * ranges and the trees alike.
 */
export interface Atmosphere {
  mistColor: { value: Color };
  mist: { value: number };
  mistLow: { value: number };
  mistHigh: { value: number };
  shadeAmount: { value: number };
  sunView: { value: Vector3 };
  glowColor: { value: Color };
  summitGlow: { value: number };
  snowY: { value: number };
  summitY: { value: number };
}

export function createAtmosphere(summitY: number, snowY: number): Atmosphere {
  return {
    mistColor: { value: new Color() },
    mist: { value: 0 },
    mistLow: { value: 4 },
    mistHigh: { value: 44 },
    shadeAmount: { value: 0.72 },
    sunView: { value: new Vector3(0, 1, 0) },
    glowColor: { value: new Color() },
    summitGlow: { value: 0 },
    snowY: { value: snowY },
    summitY: { value: summitY },
  };
}

/** Copy one moment's light onto the shared values. */
export function applyLightToAtmosphere(
  atmosphere: Atmosphere,
  light: SceneLight,
) {
  // The mist is mixed in after the renderer's colour conversion, so it is given in display colour.
  atmosphere.mistColor.value.copy(light.mist).convertLinearToSRGB();
  atmosphere.mist.value = light.mistAmount;
  atmosphere.glowColor.value.copy(light.glow);
  atmosphere.summitGlow.value = light.summitGlow;
}

interface PatchOptions {
  /** Read the per-vertex `shade` and darken the sun's light where it is 1. */
  shade?: boolean;
  /** Add first light to the highest snow. */
  summit?: boolean;
  /** The geometry carries a `color` attribute. Trees colour themselves per instance. */
  vertexColors?: boolean;
}

/**
 * Lambert lighting, flat shaded, plus the scene's atmosphere: mist that pools in the valleys
 * on top of the distance fog, shade from higher ground, and first light on the Summit.
 */
export function createLitMaterial(
  atmosphere: Atmosphere,
  { shade = false, summit = false, vertexColors = true }: PatchOptions,
): MeshLambertMaterial {
  const material = new MeshLambertMaterial({
    vertexColors,
    flatShading: true,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uMistColor: atmosphere.mistColor,
      uMist: atmosphere.mist,
      uMistLow: atmosphere.mistLow,
      uMistHigh: atmosphere.mistHigh,
      uShadeAmount: atmosphere.shadeAmount,
      uSunView: atmosphere.sunView,
      uGlowColor: atmosphere.glowColor,
      uSummitGlow: atmosphere.summitGlow,
      uSnowY: atmosphere.snowY,
      uSummitY: atmosphere.summitY,
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying float vWorldY;
        ${shade ? "attribute float shade; varying float vShade;" : ""}`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 atmosphereWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          atmosphereWorld = instanceMatrix * atmosphereWorld;
        #endif
        vWorldY = (modelMatrix * atmosphereWorld).y;
        ${shade ? "vShade = shade;" : ""}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying float vWorldY;
        ${shade ? "varying float vShade;" : ""}
        uniform vec3 uMistColor;
        uniform float uMist;
        uniform float uMistLow;
        uniform float uMistHigh;
        uniform float uShadeAmount;
        uniform vec3 uSunView;
        uniform vec3 uGlowColor;
        uniform float uSummitGlow;
        uniform float uSnowY;
        uniform float uSummitY;`,
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        ${shade ? "reflectedLight.directDiffuse *= 1.0 - vShade * uShadeAmount;" : ""}`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        ${
          summit
            ? `float glowBand = smoothstep(uSnowY, uSummitY, vWorldY);
        float facing = 0.35 + 0.65 * max(dot(normal, uSunView), 0.0);
        totalEmissiveRadiance += uGlowColor * uSummitGlow * glowBand * facing;`
            : ""
        }`,
      )
      .replace(
        "#include <fog_fragment>",
        `#ifdef USE_FOG
          float farFog = smoothstep(fogNear, fogFar, vFogDepth);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, farFog);
          float valley = (1.0 - smoothstep(uMistLow, uMistHigh, vWorldY)) * uMist;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uMistColor, valley * (1.0 - 0.5 * farFog));
        #endif`,
      );
  };
  material.customProgramCacheKey = () => `lit-${shade}-${summit}`;
  return material;
}

/** The sky: a dome that follows the camera, from the zenith to the glowing horizon, with the sun in it. */
export function createSkyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uTop: { value: new Color() },
      uHorizon: { value: new Color() },
      uGlow: { value: new Color() },
      uFog: { value: new Color() },
      uSun: { value: new Vector3(0, 0, -1) },
      uGlowStrength: { value: 0 },
      uDisc: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = clip.xyww;
      }`,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uGlow;
      uniform vec3 uFog;
      uniform vec3 uSun;
      uniform float uGlowStrength;
      uniform float uDisc;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        float up = pow(smoothstep(0.0, 0.62, h), 0.65);
        vec3 col = mix(uHorizon, uTop, up);
        col = mix(uFog, col, smoothstep(-0.12, 0.015, h));
        float toSun = max(dot(dir, uSun), 0.0);
        vec2 flatDir = normalize(dir.xz + 0.0001);
        vec2 flatSun = normalize(uSun.xz + 0.0001);
        float alongHorizon = 0.3 + 0.7 * pow(max(dot(flatDir, flatSun), 0.0), 2.0);
        col += uGlow * uGlowStrength * alongHorizon * 0.55 * exp(-max(h, 0.0) * 6.0) * smoothstep(-0.1, 0.02, h);
        col += uGlow * uGlowStrength * (pow(toSun, 5.0) * 0.45 + pow(toSun, 40.0) * 0.8);
        float disc = smoothstep(0.99925, 0.99975, toSun) * uDisc;
        col = mix(col, uGlow * 1.6 + 0.2, disc);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Stars: soft points on the far dome, fading out as the light comes and near the haze. */
export function createStarMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    fog: false,
    uniforms: {
      uColor: { value: new Color() },
      uAmount: { value: 1 },
      uScale: { value: 1 },
    },
    vertexShader: `
      attribute float size;
      attribute float level;
      uniform float uScale;
      varying float vLevel;
      varying float vHeight;
      void main() {
        vLevel = level;
        vHeight = normalize(position).y;
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = clip.xyww;
        gl_PointSize = size * uScale;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uAmount;
      varying float vLevel;
      varying float vHeight;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float falloff = smoothstep(0.5, 0.0, length(c));
        float alpha = falloff * vLevel * uAmount * smoothstep(0.03, 0.3, vHeight);
        gl_FragColor = vec4(uColor * alpha, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** A soft round glow, drawn additively on a quad that always faces the camera: the camp's lantern. */
export function createGlowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    uniforms: { uColor: { value: new Color() }, uAmount: { value: 1 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uAmount;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = pow(max(1.0 - d, 0.0), 2.4) * uAmount;
        gl_FragColor = vec4(uColor * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
