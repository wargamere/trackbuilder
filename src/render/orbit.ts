import type { Track } from '../track/track.ts';
import type { View3D } from './view3d.ts';

/** The menus' backdrop: the whole track, slowly circled from above. */
export class TrackOrbit {
  private yaw = 0.6;
  private dist = 400;
  private target = { x: 0, y: 0, z: 0 };

  /** Shows `t` in the 3D view and frames all of it. */
  show(v: View3D, t: Track): void {
    v.setTrack(t);
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of t.center.points) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.y);
      z1 = Math.max(z1, p.y);
    }
    const radius = Math.max(60, Math.hypot(x1 - x0, z1 - z0) / 2);
    let hs = 0;
    for (const hgt of t.center.height) hs += hgt;
    this.target = { x: (x0 + x1) / 2, y: hs / t.center.points.length, z: (z0 + z1) / 2 };
    this.dist = radius * 1.25;
    this.applyFog(v);
  }

  /** Fog far enough out for the whole track (call again after the graphics quality resets it). */
  applyFog(v: View3D): void {
    v.setFog(this.dist * 1.1, this.dist * 4 + 600);
  }

  /** Turns a little and renders. */
  frame(v: View3D, dt: number): void {
    this.yaw += dt * 0.07;
    const t = this.target;
    const pitch = 0.55;
    const cam = v.camera;
    cam.position.set(t.x + Math.sin(this.yaw) * Math.cos(pitch) * this.dist, t.y + Math.sin(pitch) * this.dist, t.z + Math.cos(this.yaw) * Math.cos(pitch) * this.dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(t.x, t.y, t.z);
    if (Math.abs(cam.fov - 55) > 0.01) {
      cam.fov = 55;
      cam.updateProjectionMatrix();
    }
    v.render();
  }
}
