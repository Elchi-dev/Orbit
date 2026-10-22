import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";
import { AlertCircle, Loader2 } from "lucide-react";
import type { Workspace } from "../../lib/types";
import { ago, money, tokens } from "../../lib/format";
import { atmoFragment, atmoVertex, glowFragment, nebulaFragment, planetFragment, planetVertex, ringFragment, sunFragment, uvVertex } from "./shaders";

const SURFACE_INDEX = { gas: 0, rocky: 1, ice: 2, ocean: 3, lava: 4 } as const;
// look slightly below the sun so the outer orbits clear the launch bar
const TARGET: [number, number, number] = [0, -2.6, 0];
const SPEED_SCALE = { full: 1, calm: 0.25, off: 0 } as const;

function seedOf(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 1000) / 1000;
}

function Nebula() {
  const mat = useRef<THREE.ShaderMaterial>(null);
  useFrame((_, dt) => {
    if (mat.current) mat.current.uniforms.uTime.value += dt;
  });
  return (
    <mesh>
      <sphereGeometry args={[90, 48, 48]} />
      <shaderMaterial ref={mat} side={THREE.BackSide} depthWrite={false} uniforms={{ uTime: { value: 0 } }} vertexShader={planetVertex} fragmentShader={nebulaFragment} />
    </mesh>
  );
}

function Sun({ busy }: { busy: boolean }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const glow = useRef<THREE.ShaderMaterial>(null);
  const corona = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (mat.current) mat.current.uniforms.uTime.value += dt;
    if (glow.current) glow.current.uniforms.uTime.value += dt * (busy ? 3 : 1);
    if (corona.current) {
      const s = 1 + Math.sin(performance.now() / 900) * 0.04;
      corona.current.scale.setScalar(s);
    }
  });
  return (
    <group>
      <mesh>
        <sphereGeometry args={[1.05, 64, 64]} />
        <shaderMaterial ref={mat} uniforms={{ uTime: { value: 0 } }} vertexShader={planetVertex} fragmentShader={sunFragment} />
      </mesh>
      <Billboard>
        <mesh ref={corona}>
          <planeGeometry args={[9, 9]} />
          <shaderMaterial
            ref={glow}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            uniforms={{ uTime: { value: 0 }, uInner: { value: new THREE.Color("#FFE6DA") }, uOuter: { value: new THREE.Color("#8A6BFF") } }}
            vertexShader={uvVertex}
            fragmentShader={glowFragment}
          />
        </mesh>
      </Billboard>
    </group>
  );
}

/** A slowly turning disc of dust in the orbital plane plus an asteroid belt. */
function Dust({ speed, belt }: { speed: number; belt: number }) {
  const disc = useRef<THREE.Points>(null);
  const ring = useRef<THREE.Points>(null);
  const [discGeo, beltGeo] = useMemo(() => {
    const palette = ["#F2EFFF", "#B8A6FF", "#FFB199", "#6E86E8"].map((c) => new THREE.Color(c));
    const make = (n: number, rMin: number, rMax: number, thick: number) => {
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const r = rMin + Math.pow(Math.random(), 0.7) * (rMax - rMin);
        const a = Math.random() * Math.PI * 2;
        pos.set([Math.cos(a) * r, (Math.random() - 0.5) * thick, Math.sin(a) * r], i * 3);
        const c = palette[Math.floor(Math.random() * palette.length)];
        const k = 0.35 + Math.random() * 0.65;
        col.set([c.r * k, c.g * k, c.b * k], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      return g;
    };
    return [make(5000, 1.6, 26, 0.6), make(1800, belt - 0.35, belt + 0.35, 0.18)];
  }, [belt]);
  useFrame((_, dt) => {
    if (disc.current) disc.current.rotation.y += dt * 0.006 * speed;
    if (ring.current) ring.current.rotation.y -= dt * 0.02 * speed;
  });
  return (
    <>
      <points ref={disc} geometry={discGeo}>
        <pointsMaterial size={0.05} vertexColors transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
      </points>
      <points ref={ring} geometry={beltGeo}>
        <pointsMaterial size={0.07} vertexColors transparent opacity={0.8} depthWrite={false} sizeAttenuation />
      </points>
    </>
  );
}

function OrbitLine({ r, active }: { r: number; active: boolean }) {
  return (
    <mesh rotation-x={-Math.PI / 2}>
      <ringGeometry args={[r - 0.012, r + 0.012, 256]} />
      <meshBasicMaterial color={active ? "#B8A6FF" : "#8C7FD6"} transparent opacity={active ? 0.45 : 0.16} depthWrite={false} />
    </mesh>
  );
}

function Rings({ size, color }: { size: number; color: string }) {
  const inner = size * 1.4;
  const outer = size * 2.05;
  return (
    <mesh rotation-x={-Math.PI / 2 + 0.55} rotation-y={0.25}>
      <ringGeometry args={[inner, outer, 128]} />
      <shaderMaterial
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
        uniforms={{ uColor: { value: new THREE.Color(color) }, uInner: { value: inner }, uOuter: { value: outer } }}
        vertexShader={`uniform float uInner; uniform float uOuter; varying vec2 vUv; void main(){ vUv = vec2((length(position.xy)-uInner)/(uOuter-uInner), 0.0); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`}
        fragmentShader={ringFragment}
      />
    </mesh>
  );
}

/** Sparks shed by a planet whose agent is working. */
function Sparks({ size }: { size: number }) {
  const ref = useRef<THREE.Points>(null);
  const n = 70;
  const { geo, seeds } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const seeds = Array.from({ length: n }, () => ({ t: Math.random(), a: Math.random() * Math.PI * 2, y: (Math.random() - 0.5) * 2, s: 0.4 + Math.random() }));
    return { geo: g, seeds };
  }, []);
  useFrame((_, dt) => {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    seeds.forEach((p, i) => {
      p.t += dt * 0.55 * p.s;
      if (p.t > 1) {
        p.t = 0;
        p.a = Math.random() * Math.PI * 2;
      }
      const r = size * (1.05 + p.t * 2.2);
      pos.setXYZ(i, Math.cos(p.a + p.t * 1.5) * r, p.y * size * (0.4 + p.t), Math.sin(p.a + p.t * 1.5) * r);
    });
    pos.needsUpdate = true;
    if (ref.current) (ref.current.material as THREE.PointsMaterial).opacity = 0.9;
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial size={0.06} color="#C9BBFF" transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function Pulse({ size }: { size: number }) {
  const a = useRef<THREE.Mesh>(null);
  const b = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const t = performance.now() / 1000;
    [a, b].forEach((m, i) => {
      if (!m.current) return;
      const k = ((t * 0.6 + i * 0.5) % 1);
      m.current.scale.setScalar(1 + k * 1.8);
      (m.current.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.8;
    });
  });
  return (
    <Billboard>
      {[a, b].map((r, i) => (
        <mesh key={i} ref={r}>
          <ringGeometry args={[size * 1.2, size * 1.28, 64]} />
          <meshBasicMaterial color="#FFB199" transparent depthWrite={false} />
        </mesh>
      ))}
    </Billboard>
  );
}

interface PlanetProps {
  ws: Workspace;
  radius: number;
  speed: number;
  phase: number;
  size: number;
  motion: number;
  hovered: boolean;
  setHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  positions: Map<string, { v: THREE.Vector3; size: number }>;
}

function Planet({ ws, radius, speed, phase, size, motion, hovered, setHover, onSelect, positions }: PlanetProps) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const mat = useRef<THREE.ShaderMaterial>(null);
  const atmo = useRef<THREE.ShaderMaterial>(null);
  const angle = useRef(phase);
  const hoverV = useRef(0);
  const color = useMemo(() => new THREE.Color(ws.style?.color ?? "#B8A6FF"), [ws.style?.color]);
  const surface = SURFACE_INDEX[ws.style?.surface ?? "gas"] ?? 0;
  const seed = useMemo(() => seedOf(ws.id) * 10, [ws.id]);
  const busy = ws.running;

  useEffect(() => {
    if (group.current) positions.set(ws.id, { v: group.current.position, size });
    return () => {
      positions.delete(ws.id);
    };
  }, [ws.id, size]);

  useFrame((_, dt) => {
    angle.current += dt * speed * motion * (busy ? 2.6 : 1);
    if (group.current) group.current.position.set(Math.cos(angle.current) * radius, 0, Math.sin(angle.current) * radius);
    hoverV.current += ((hovered ? 1 : 0) - hoverV.current) * Math.min(1, dt * 8);
    if (body.current) body.current.scale.setScalar(1 + hoverV.current * 0.28);
    if (mat.current) {
      mat.current.uniforms.uTime.value += dt * (busy ? 3 : 1) * Math.max(motion, 0.15);
      mat.current.uniforms.uHover.value = hoverV.current;
    }
    if (atmo.current) atmo.current.uniforms.uHover.value = hoverV.current;
  });

  const glowColor = ws.pending ? new THREE.Color("#FFB199") : busy ? new THREE.Color("#C9BBFF") : color.clone().lerp(new THREE.Color("#E6DEFF"), 0.4);

  return (
    <group ref={group}>
      <group
        ref={body}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(ws.id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(null);
          document.body.style.cursor = "";
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(ws.id);
        }}
      >
        <mesh>
          <sphereGeometry args={[size, 64, 64]} />
          <shaderMaterial
            ref={mat}
            uniforms={{ uColor: { value: color }, uTime: { value: seed * 10 }, uSurface: { value: surface }, uSeed: { value: seed }, uHover: { value: 0 } }}
            vertexShader={planetVertex}
            fragmentShader={planetFragment}
          />
        </mesh>
        <mesh scale={1.22}>
          <sphereGeometry args={[size, 48, 48]} />
          <shaderMaterial
            ref={atmo}
            transparent
            depthWrite={false}
            side={THREE.BackSide}
            blending={THREE.AdditiveBlending}
            uniforms={{ uColor: { value: glowColor }, uPower: { value: 2.2 }, uHover: { value: 0 } }}
            vertexShader={atmoVertex}
            fragmentShader={atmoFragment}
          />
        </mesh>
        {ws.style?.rings && <Rings size={size} color={ws.style.color} />}
      </group>
      {busy && <Sparks size={size} />}
      {ws.pending > 0 && <Pulse size={size} />}
    </group>
  );
}

/** Moves the DOM labels to sit under their planets every frame. */
function LabelProjector({ positions, layer }: { positions: Map<string, { v: THREE.Vector3; size: number }>; layer: React.RefObject<HTMLDivElement | null> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const root = layer.current;
    if (!root) return;
    for (const el of root.children as unknown as HTMLElement[]) {
      const p = positions.get(el.dataset.id ?? "");
      if (!p) {
        el.style.opacity = "0";
        continue;
      }
      v.copy(p.v);
      v.y -= p.size + 0.42;
      v.project(camera);
      const sx = ((v.x + 1) / 2) * size.width;
      const sy = ((1 - v.y) / 2) * size.height;
      // fade labels that would sit under the launch bar
      const underBar = sy > size.height - 120 && Math.abs(sx - size.width / 2) < 340;
      el.style.opacity = v.z > 1 ? "0" : underBar ? "0.2" : "1";
      el.style.transform = `translate3d(${sx}px, ${sy}px, 0) translate(-50%, 0)`;
      el.style.zIndex = String(Math.round((1 - v.z) * 1000));
    }
  });
  return null;
}

function CameraIntro() {
  const { camera } = useThree();
  const t = useRef(0);
  useFrame((_, dt) => {
    if (t.current >= 1) return;
    t.current = Math.min(1, t.current + dt * 0.45);
    const e = 1 - Math.pow(1 - t.current, 3);
    camera.position.set(0, 28 - e * 15, 36 - e * 17);
    camera.lookAt(TARGET[0], TARGET[1], TARGET[2]);
  });
  return null;
}

export function OrreryScene({ workspaces, onSelect, motion }: { workspaces: Workspace[]; onSelect: (id: string) => void; motion: "full" | "calm" | "off" }) {
  const m = SPEED_SCALE[motion];
  const sorted = [...workspaces].sort((a, b) => b.updated_at - a.updated_at);
  const layout = sorted.map((ws, i) => {
    const radius = 2.9 + i * 1.3 + (i > 2 ? 0.8 : 0); // gap for the asteroid belt after the third orbit
    const size = Math.min(0.85, Math.max(0.3, 0.26 + Math.log10((ws.stats?.tokens ?? 0) + 10) * 0.085));
    // golden-angle steps keep neighbouring orbits from starting next to each other
    return { ws, radius, size, speed: 0.55 / Math.pow(radius, 1.15), phase: i * 2.39996 + seedOf(ws.id) * 0.8 };
  });
  const belt = 2.9 + 2 * 1.3 + 1.05;
  const anyBusy = workspaces.some((w) => w.running);
  const [hover, setHover] = useState<string | null>(null);
  const positions = useMemo(() => new Map<string, { v: THREE.Vector3; size: number }>(), []);
  const layer = useRef<HTMLDivElement>(null);
  return (
    <div className="orrery">
    <Canvas dpr={[1, 2]} camera={{ position: [0, 11, 16], fov: 45, near: 0.1, far: 400 }} gl={{ antialias: true, powerPreference: "high-performance" }}>
      <color attach="background" args={["#0A0A1A"]} />
      <Nebula />
      <Stars radius={70} depth={30} count={4000} factor={3.2} saturation={0.3} fade speed={m * 0.6} />
      <Sun busy={anyBusy} />
      <Dust speed={m} belt={belt} />
      {layout.map((l) => (
        <OrbitLine key={`o-${l.ws.id}`} r={l.radius} active={l.ws.running || l.ws.pending > 0} />
      ))}
      {layout.map((l) => (
        <Planet key={l.ws.id} {...l} motion={m} onSelect={onSelect} hovered={hover === l.ws.id} setHover={setHover} positions={positions} />
      ))}
      <CameraIntro />
      <LabelProjector positions={positions} layer={layer} />
      <OrbitControls target={TARGET} enablePan={false} enableDamping dampingFactor={0.08} minDistance={6} maxDistance={48} maxPolarAngle={Math.PI * 0.47} rotateSpeed={0.5} zoomSpeed={0.7} />
    </Canvas>
      <div className="label-layer" ref={layer}>
        {layout.map(({ ws }) => (
          <button
            key={ws.id}
            data-id={ws.id}
            className={`planet-label ${hover === ws.id ? "hover" : ""}`}
            onMouseEnter={() => setHover(ws.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(ws.id)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect(ws.id)}
            aria-label={`Open ${ws.title}`}
          >
            <span className="pl-title">{ws.title}</span>
            <span className={`pl-state ${ws.pending ? "need" : ws.running ? "busy" : ""}`}>
              {ws.pending ? (
                <>
                  <AlertCircle size={12} /> needs you
                </>
              ) : ws.running ? (
                <>
                  <Loader2 size={12} className="spin" /> working
                </>
              ) : (
                ago(ws.updated_at)
              )}
            </span>
            <span className="pl-more">
              {tokens(ws.stats?.tokens)} tokens, {money(ws.stats?.cost)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
