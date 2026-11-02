import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Shape,
  Vector3,
} from 'three';
import { HANDLING } from '../config/handling.ts';
import { merge, tint } from '../render/geom.ts';
import type { CarState } from './physics.ts';

/** Default paint: the game's highlighter yellow. */
export const DEFAULT_PAINT = 0xf2b705;

/**
 * Side profile (z forward, y up) extruded across the car's width. Local axes:
 * +Z forward, +X to the car's left, +Y up.
 */
function profile(points: [number, number][], width: number): ExtrudeGeometry {
  const shape = new Shape();
  points.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)));
  shape.closePath();
  const g = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  // Shape x -> local z (forward); extrusion z -> local x (across), centred.
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2, 0, 0);
  return g;
}

function paintGeometry() {
  const body = profile(
    [
      [-2.05, 0.28],
      [2.0, 0.28],
      [2.12, 0.42],
      [2.05, 0.62],
      [1.0, 0.78],
      [0.75, 0.8],
      [-1.55, 0.86],
      [-2.05, 0.82],
      [-2.12, 0.5],
    ],
    1.86,
  );
  const roof = new BoxGeometry(1.5, 0.08, 1.0).translate(0, 1.25, -0.45);
  return merge([body, roof]);
}

function trimGeometry() {
  const cabin = tint(
    profile(
      [
        [0.8, 0.78],
        [0.15, 1.22],
        [-1.05, 1.25],
        [-1.6, 0.84],
      ],
      1.56,
    ),
    0x1d2633,
  );
  const parts = [cabin];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: number) =>
    parts.push(tint(new BoxGeometry(w, h, d).translate(x, y, z), hex));
  box(1.7, 0.18, 0.1, 0, 0.38, 2.1, 0x24262b); // front bumper
  box(1.8, 0.16, 0.1, 0, 0.36, -2.12, 0x24262b); // rear bumper
  for (const sx of [-1, 1]) {
    box(0.38, 0.09, 0.06, sx * 0.6, 0.52, 2.08, 0xfff6d0); // headlight
    box(0.42, 0.1, 0.06, sx * 0.6, 0.66, -2.11, 0xd8202a); // tail light
    box(0.06, 0.13, 2.6, sx * 0.94, 0.33, 0, 0x24262b); // side skirt
    box(0.06, 0.24, 0.12, sx * 0.6, 0.96, -1.85, 0x1b1b1b); // spoiler strut
  }
  box(1.8, 0.06, 0.38, 0, 1.1, -1.88, 0x1b1b1b); // spoiler wing
  return merge(parts);
}

function wheelGeometry() {
  const r = HANDLING.wheelRadius;
  return merge([
    tint(new CylinderGeometry(r, r, 0.28, 12).rotateZ(Math.PI / 2), 0x1a1a1c),
    tint(new CylinderGeometry(r * 0.55, r * 0.55, 0.3, 8).rotateZ(Math.PI / 2), 0xb8bcc4),
  ]);
}

function shadowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new CanvasTexture(c);
}

/** Wheel hubs in local space: front-left, front-right, rear-left, rear-right. */
const WHEELS: [number, number, number][] = [
  [0.86, HANDLING.wheelRadius, 1.3],
  [-0.86, HANDLING.wheelRadius, 1.3],
  [0.86, HANDLING.wheelRadius, -1.32],
  [-0.86, HANDLING.wheelRadius, -1.32],
];

/** The player's car: paint body, dark trim, four instanced wheels and a blob shadow (4 draw calls). */
export class CarModel {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly paint: MeshLambertMaterial;
  private readonly wheels: InstancedMesh;
  private roll = 0;
  private pitch = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly qs = new Quaternion();
  private readonly v = new Vector3();
  private readonly one = new Vector3(1, 1, 1);
  private readonly axisX = new Vector3(1, 0, 0);
  private readonly axisY = new Vector3(0, 1, 0);

  constructor(paint = DEFAULT_PAINT) {
    this.paint = new MeshLambertMaterial({ color: paint, flatShading: true });
    const trimMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.body.add(new Mesh(paintGeometry(), this.paint), new Mesh(trimGeometry(), trimMat));
    this.wheels = new InstancedMesh(wheelGeometry(), trimMat, 4);
    this.wheels.frustumCulled = false;
    const shadow = new Mesh(
      new PlaneGeometry(2.4, 4.8).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.6 }),
    );
    shadow.position.y = 0.04;
    shadow.renderOrder = 1;
    this.root.add(shadow, this.body, this.wheels);
  }

  setPaint(hex: number): void {
    this.paint.color.setHex(hex);
  }

  /** Places the model from an (interpolated) physics state. */
  update(st: CarState, dt: number): void {
    this.root.position.set(st.x, 0, st.z);
    // Local +Z must point along the heading (cos h, sin h) in world (x, z).
    this.root.rotation.set(0, Math.PI / 2 - st.heading, 0);

    // Body leans out of corners and pitches under braking/acceleration (visual only).
    const k = 1 - Math.exp(-8 * dt);
    const targetRoll = Math.max(-0.06, Math.min(0.06, -st.latAccel * 0.003));
    const targetPitch = Math.max(-0.05, Math.min(0.05, -st.longAccel * 0.0025));
    this.roll += (targetRoll - this.roll) * k;
    this.pitch += (targetPitch - this.pitch) * k;
    this.body.rotation.set(this.pitch, 0, this.roll);

    WHEELS.forEach(([x, y, z], i) => {
      const steer = i < 2 ? -st.steer : 0; // + steer = right = towards local -X
      this.q.setFromAxisAngle(this.axisY, steer).multiply(this.qs.setFromAxisAngle(this.axisX, st.spin));
      this.m.compose(this.v.set(x, y, z), this.q, this.one);
      this.wheels.setMatrixAt(i, this.m);
    });
    this.wheels.instanceMatrix.needsUpdate = true;
  }
}
