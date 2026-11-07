import type { PerspectiveCamera } from 'three';
import { CAMERA } from '../config/handling.ts';
import { settings, updateSettings } from '../core/settings.ts';
import { angleDelta, type CarState } from './physics.ts';

export type CameraMode = 'chase' | 'bonnet';

/**
 * Chase camera that swings round behind the car with a little lag, plus a
 * rigid bonnet camera. Smoothing is exponential in real time, so it looks the
 * same at any frame rate (it's visual only and never feeds back into physics).
 */
export class CameraRig {
  mode: CameraMode = settings().camera;
  private yaw = 0;
  private fov: number = CAMERA.chase.fov;
  private shakeTime = 0;
  /** Extra lift that keeps the chase camera above rising ground behind the car. */
  private lift = 0;
  /** Barrier-hit shake, decaying (m). */
  private knock = 0;
  /** Ground height lookup for camera clearance (terrain, which follows the road). */
  groundAt: (x: number, z: number) => number = () => 0;

  /** A jolt of camera shake (barrier hits); `strength` 0..1. */
  bump(strength: number): void {
    this.knock = Math.max(this.knock, 0.25 * Math.min(1, strength));
  }

  toggle(): void {
    this.mode = this.mode === 'chase' ? 'bonnet' : 'chase';
    updateSettings({ camera: this.mode });
  }

  /** Jumps straight behind the car (after a reset or on entering the race). */
  snap(st: CarState): void {
    this.yaw = st.heading;
    this.fov = CAMERA.chase.fov;
    this.lift = 0;
    this.knock = 0;
  }

  update(cam: PerspectiveCamera, st: CarState, dt: number): void {
    const fx = Math.cos(st.heading);
    const fz = Math.sin(st.heading);
    const speed = Math.abs(st.speed);
    let fov: number;

    this.shakeTime += dt;
    const kick = this.knock > 0.002 ? Math.sin(this.shakeTime * 61) * this.knock : 0;
    this.knock *= Math.exp(-9 * dt);
    // Look a little up or down the slope the car is on.
    const tilt = Math.tan(st.pitch);

    if (this.mode === 'bonnet') {
      const b = CAMERA.bonnet;
      cam.position.set(st.x + fx * b.forward, st.y + b.height + kick * 0.3, st.z + fz * b.forward);
      // Lean with the road's banking: up tilts away from the side that is raised.
      const r = st.roll;
      cam.up.set(-Math.sin(r) * fz, Math.cos(r), Math.sin(r) * fx);
      cam.lookAt(st.x + fx * 30, st.y + 0.9 + tilt * 30, st.z + fz * 30);
      this.yaw = st.heading;
      fov = b.fov;
    } else {
      const c = CAMERA.chase;
      this.yaw += angleDelta(this.yaw, st.heading) * (1 - Math.exp(-c.yawFollow * dt));
      const yx = Math.cos(this.yaw);
      const yz = Math.sin(this.yaw);
      const dist = c.distance + speed * c.distancePerSpeed;
      // A little rumble when wheels are on the grass.
      const shake = st.grass > 0 ? Math.sin(this.shakeTime * 47) * 0.04 * st.grass * Math.min(1, speed / 15) : 0;
      const px = st.x - yx * dist;
      const pz = st.z - yz * dist;
      const base = st.y + c.height;
      // Don't dip into a hill behind the car (going downhill, the road behind is higher).
      const need = Math.max(0, this.groundAt(px, pz) + 1.6 - base);
      this.lift += (need - this.lift) * (1 - Math.exp(-(need > this.lift ? 14 : 3) * dt));
      cam.up.set(0, 1, 0);
      cam.position.set(px, base + this.lift + shake + kick, pz);
      cam.lookAt(st.x + yx * c.lookAhead, st.y + c.lookHeight + tilt * c.lookAhead * 0.6, st.z + yz * c.lookAhead);
      fov = Math.min(c.fovMax, c.fov + speed * c.fovPerSpeed);
    }
    this.fov += (fov - this.fov) * (1 - Math.exp(-4 * dt));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
