"use client";

import * as React from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { MeshTransmissionMaterial, Environment, Lightformer } from "@react-three/drei";

/* -------------------------------------------------------------------------- */
/*  Headline texture                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Canvas `ctx.font` does not understand CSS custom properties, so any `var(--x)`
 * in the stack has to be resolved against the document first - otherwise the
 * assignment is rejected and text silently falls back to 10px.
 */
function resolveFontStack(stack: string): string {
  if (typeof window === "undefined") return stack;
  const root = getComputedStyle(document.documentElement);
  return stack.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_m, name: string) => {
    const v = root.getPropertyValue(name).trim();
    return v || "sans-serif";
  });
}

/**
 * Draws the wordmark to a canvas so it can live *inside* the 3D scene. Using
 * the page's own fonts keeps the component free of external assets.
 */
function drawHeadline(text: string, color: string, fontFamily: string): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;

  const W = 2048;
  const H = 640;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, W, H);

  // Fit the wordmark to the canvas width rather than guessing a size.
  const stack = resolveFontStack(fontFamily);
  let size = 460;
  do {
    ctx.font = `600 ${size}px ${stack}`;
    size -= 8;
  } while (ctx.measureText(text).width > W * 0.92 && size > 40);

  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2);

  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/**
 * Built synchronously so the mesh mounts with its map already attached -
 * attaching a map to an already-mounted material is a well-known three.js trap.
 * Redrawn once webfonts land so the real face is baked in.
 */
function useHeadlineTexture(text: string, color: string, fontFamily: string) {
  const [texture, setTexture] = React.useState(() => drawHeadline(text, color, fontFamily));

  React.useEffect(() => {
    let cancelled = false;
    const rebake = () => {
      if (!cancelled) setTexture(drawHeadline(text, color, fontFamily));
    };
    // Re-bake once webfonts land, otherwise the fallback face is baked in.
    if (document.fonts?.ready) {
      document.fonts.ready.then(rebake).catch(rebake);
    } else {
      rebake();
    }
    return () => {
      cancelled = true;
    };
  }, [text, color, fontFamily]);

  React.useEffect(() => () => texture?.dispose(), [texture]);

  return texture;
}

/* -------------------------------------------------------------------------- */
/*  Adaptive quality                                                          */
/* -------------------------------------------------------------------------- */

type Quality = "low" | "medium" | "high";

interface QualitySpec {
  samples: number;
  resolution: number;
  motes: number;
  backside: boolean;
  maxDpr: number;
}

const QUALITY: Record<Quality, QualitySpec> = {
  // Transmission re-renders the scene into a buffer every frame, so samples and
  // buffer resolution are the two knobs that actually cost money. samples:2 /
  // res:128 left visible colour speckle on the facets; 3/192 is still far
  // cheaper than the desktop tier but reads clean.
  low: { samples: 3, resolution: 192, motes: 30, backside: false, maxDpr: 1.25 },
  medium: { samples: 4, resolution: 256, motes: 55, backside: true, maxDpr: 1.5 },
  high: { samples: 6, resolution: 512, motes: 90, backside: true, maxDpr: 1.75 },
};

/** Stable subscription so the tier re-evaluates if the window is resized. */
function subscribeToViewport(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

function detectQuality(): Quality {
  if (typeof window === "undefined") return "medium";
  const cores = navigator.hardwareConcurrency ?? 4;
  const w = window.innerWidth;
  if (w < 768 || cores <= 4) return "low";
  if (w < 1440 || cores <= 8) return "medium";
  return "high";
}

/* -------------------------------------------------------------------------- */
/*  Atmosphere                                                                */
/* -------------------------------------------------------------------------- */

/** Deterministic PRNG - keeps the mote field pure and identical every mount. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Slow drifting motes. Gives the frame depth without a texture. */
function Motes({ count = 90, color }: { count?: number; color: string }) {
  const ref = React.useRef<THREE.Points>(null);

  const { positions, speeds } = React.useMemo(() => {
    const rand = mulberry32(1337);
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rand() - 0.5) * 18;
      pos[i * 3 + 1] = (rand() - 0.5) * 11;
      pos[i * 3 + 2] = (rand() - 0.5) * 6 - 1;
      spd[i] = 0.02 + rand() * 0.05;
    }
    return { positions: pos, speeds: spd };
  }, [count]);

  useFrame((_, delta) => {
    const pts = ref.current;
    if (!pts) return;
    const attr = pts.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const y = (arr[i * 3 + 1] ?? 0) + (speeds[i] ?? 0) * delta;
      arr[i * 3 + 1] = y > 5.5 ? -5.5 : y;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.045}
        color={color}
        transparent
        opacity={0.5}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

/* -------------------------------------------------------------------------- */
/*  Stage                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How far left of centre the wordmark and the stone sit, as a fraction of the
 * canvas width. Expressed on screen rather than in world units because the two
 * live on different z-planes: the same world offset would displace the nearer
 * plane further, and they would drift apart.
 */
const STAGE_OFFSET_X = -0.095;

/** Share of the canvas width the wordmark plane spans. */
const WORDMARK_FILL = 0.84;

/**
 * Vertical lift of the wordmark and the stone, in CSS pixels. Positive is up.
 *
 * Kept in pixels rather than as a fraction of the canvas because a fraction
 * only lands the intended offset at the window size it was tuned against. The
 * conversion below turns it into world units per plane, so it stays 30px at any
 * size or device pixel ratio.
 */
const STAGE_LIFT_PX = 30;

/**
 * World-space distance that covers `px` on screen at a given plane depth.
 * `viewport` measures the frame at z = 0, so a plane nearer the camera needs a
 * proportionally smaller world offset to travel the same screen distance.
 */
function pxToWorld(px: number, viewportHeight: number, sizeHeight: number, depth: number) {
  return px * (viewportHeight / sizeHeight) * depth;
}

/**
 * `drawHeadline` fits the text to 92% of its texture, so the glyphs occupy that
 * share of the plane. The stage lives inside the canvas and WebGL clips at the
 * canvas bounds, so an offset large enough to push the glyphs past the edge
 * would slice the wordmark rather than move it. Clamping keeps the offset legal
 * at every window size instead of only the one it was eyeballed at.
 */
function clampOffset(offset: number, fill: number): number {
  const glyphHalfWidth = (fill * 0.92) / 2;
  const limit = Math.max(0, 0.5 - glyphHalfWidth - 0.015);
  return THREE.MathUtils.clamp(offset, -limit, limit);
}

/**
 * The wordmark, drawn as a plane inside the scene. `fill` is the share of the
 * pane width it should occupy; the depth ratio corrects for the plane sitting
 * off the camera plane, so the same fill reads identically at any z.
 */
function StageHeadline({
  texture,
  z,
  fill,
  opacity = 1,
  renderOrder = 0,
}: {
  texture: THREE.CanvasTexture | null;
  z: number;
  fill: number;
  opacity?: number;
  renderOrder?: number;
}) {
  const { viewport, size } = useThree();
  if (!texture) return null;

  const depth = (7 - z) / 7;
  const width = viewport.width * depth * fill;
  const height = width * (640 / 2048);
  const x = viewport.width * depth * clampOffset(STAGE_OFFSET_X, fill);
  const y = pxToWorld(STAGE_LIFT_PX, viewport.height, size.height, depth);

  return (
    <mesh position={[x, y, z]} renderOrder={renderOrder}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={opacity}
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Centred stone, sized against the smaller axis of the pane it lives in. */
function StageCrystal({
  dispersion,
  tint,
  smoke,
  spec,
  reducedMotion,
}: {
  dispersion: number;
  tint: string;
  smoke: string;
  spec: QualitySpec;
  reducedMotion: boolean;
}) {
  const ref = React.useRef<THREE.Mesh>(null);
  const pointer = React.useRef({ x: 0, y: 0 });
  const { viewport, size } = useThree();

  // Fit against the smaller axis so a narrow pane gets a smaller stone rather
  // than one cropped by its own bounds.
  const fit = Math.min(viewport.width, viewport.height);
  const baseScale = THREE.MathUtils.clamp(fit / 6.2, 0.34, 1.15);

  // Sits on the same screen offset as the wordmark it backs. Depth is 1 at
  // z = 0, so the fraction applies directly.
  const anchorX = viewport.width * clampOffset(STAGE_OFFSET_X, WORDMARK_FILL);
  const anchorY = pxToWorld(STAGE_LIFT_PX, viewport.height, size.height, 1);

  React.useEffect(() => {
    if (reducedMotion) return;
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.current.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reducedMotion]);

  React.useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.position.x = anchorX;
    ref.current.position.y = anchorY;
  }, [anchorX, anchorY]);

  useFrame((state, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;

    // Never linear: the drift keeps facets catching light at odd intervals.
    if (!reducedMotion) {
      mesh.rotation.y = t * 0.11;
      mesh.rotation.x = Math.sin(t * 0.19) * 0.16;
      mesh.rotation.z = Math.cos(t * 0.15) * 0.09;
    }

    // Ease toward the pointer rather than tracking it exactly.
    const tx = anchorX + pointer.current.x * 0.3;
    const ty = anchorY - pointer.current.y * 0.24;
    mesh.position.x += (tx - mesh.position.x) * Math.min(1, delta * 2);
    mesh.position.y += (ty - mesh.position.y) * Math.min(1, delta * 2);
    mesh.scale.setScalar(baseScale);
  });

  // Backside doubles the transmission cost and buys nothing on a narrow pane,
  // so it is tied to the tier rather than always on.
  const backside = spec.backside && size.width > 640;

  return (
    <mesh ref={ref}>
      {/* 20 flat facets, so it reads as cut rather than as a ball. */}
      <icosahedronGeometry args={[1.32, 0]} />
      <MeshTransmissionMaterial
        transmission={1}
        thickness={1.25}
        roughness={0.04}
        ior={2.2}
        chromaticAberration={dispersion}
        anisotropy={0.3}
        distortion={0.18}
        distortionScale={0.32}
        temporalDistortion={0.05}
        backside={backside}
        backsideThickness={0.45}
        samples={spec.samples}
        resolution={spec.resolution}
        color={tint}
        attenuationColor={smoke}
        /* Obsidian, not glass. Absorption is Beer-Lambert, so transmission
           through the body is attenuationColor^(thickness/attenuationDistance)
           in linear space. #1A1A1A over 3.5 leaves ~20%: dark enough to read as
           stone rather than glass, bright enough that the chromatic dispersion
           still survives at the facet edges. Pushing the colour to #050505 or
           the distance below ~2 drops it under 1% and the stone renders as an
           opaque black blob. */
        attenuationDistance={3.5}
      />
    </mesh>
  );
}

function StageScene({
  headline,
  headlineColor,
  displayFont,
  dispersion,
  tint,
  smoke,
  moteColor,
  spec,
  reducedMotion,
}: {
  headline: string;
  headlineColor: string;
  displayFont: string;
  dispersion: number;
  tint: string;
  smoke: string;
  moteColor: string;
  spec: QualitySpec;
  reducedMotion: boolean;
}) {
  const texture = useHeadlineTexture(headline, headlineColor, displayFont);

  return (
    <>
      {/*
        Neutral studio rig built from lightformers, so nothing is fetched. Kept
        deliberately dim: absorption darkens what passes *through* the stone but
        does nothing to what reflects *off* it, so a bright rig reads as polished
        crystal no matter how black the attenuation is. The obsidian look comes
        from low-intensity cards plus a single brighter key that catches an edge.
      */}
      <Environment resolution={256}>
        <Lightformer intensity={2.2} position={[0, 5, 4]} scale={[12, 4, 1]} color="#ffffff" />
        <Lightformer intensity={1.1} position={[-6, 1, 3]} scale={[4, 9, 1]} color="#c9d4e0" />
        <Lightformer intensity={0.9} position={[6, -2, 2]} scale={[5, 6, 1]} color="#e0d8c8" />
        <Lightformer intensity={0.5} position={[0, -4, -3]} scale={[9, 3, 1]} color="#ffffff" />
      </Environment>

      <StageCrystal
        dispersion={dispersion}
        tint={tint}
        smoke={smoke}
        spec={spec}
        reducedMotion={reducedMotion}
      />

      <Motes color={moteColor} count={spec.motes} />

      {/* The wordmark sits in front of the stone: the project name is the
          subject of this frame, the crystal is the material behind it. It is
          added last so nothing sorts above it. */}
      <StageHeadline texture={texture} z={1.6} fill={WORDMARK_FILL} renderOrder={999} />
    </>
  );
}

/**
 * Canvas-only stage: fills its parent, no copy overlay, no scroll rig. Used as
 * a background element beside page copy.
 */
export function PrismStage({
  headline = "CAP TABLE",
  dispersion = 1.2,
  /**
   * Transmission colour. This multiplies everything the stone lets through, so
   * a near-black tint renders an opaque blob rather than glass; the smoke is
   * what carries the dark cast instead.
   */
  tint = "#E8E8EA",
  smoke = "#1A1A1A",
  background = "#000000",
  foreground = "#EDEDED",
  accent = "#3A3A3A",
  displayFont = "var(--font-display), Geist, Inter, sans-serif",
  className,
}: {
  headline?: string;
  dispersion?: number;
  tint?: string;
  smoke?: string;
  background?: string;
  foreground?: string;
  accent?: string;
  displayFont?: string;
  className?: string;
}) {
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  // useSyncExternalStore rather than an effect: the server snapshot keeps
  // hydration deterministic and the tier re-evaluates for free on resize.
  const quality = React.useSyncExternalStore(
    subscribeToViewport,
    detectQuality,
    () => "medium" as Quality,
  );
  const spec = QUALITY[quality];

  // Transmission is the most expensive thing on the landing page and the stage
  // is decorative, so it stops rendering the moment it leaves view.
  const hostRef = React.useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = React.useState(true);

  React.useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? true), {
      rootMargin: "80px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return (
    <div
      ref={hostRef}
      className={["absolute inset-0 overflow-hidden", className].filter(Boolean).join(" ")}
      style={{ background }}
      aria-hidden
    >
      <div
        className="absolute inset-0 transition-opacity duration-700 ease-out"
        style={{ opacity: ready ? 1 : 0 }}
      >
        <Canvas
          frameloop={onScreen ? "always" : "never"}
          dpr={[1, spec.maxDpr]}
          gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
          camera={{ fov: 40, near: 0.1, far: 60, position: [0, 0, 7] }}
          onCreated={({ gl }) => gl.setClearColor(new THREE.Color(background), 1)}
        >
          <StageScene
            headline={headline}
            headlineColor={foreground}
            displayFont={displayFont}
            dispersion={dispersion}
            tint={tint}
            smoke={smoke}
            moteColor={accent}
            spec={spec}
            reducedMotion={reducedMotion}
          />
        </Canvas>
      </div>
    </div>
  );
}

export default PrismStage;
