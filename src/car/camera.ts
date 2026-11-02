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

  toggle(): void {
    this.mode = this.mode === 'chase' ? 'bonnet' : 'chase';
    updateSettings({ camera: this.mode });
  }

  /** Jumps straight behind the car (after a reset or on entering the race). */
  snap(st: CarState): void {
    this.yaw = st.heading;
    this.fov = CAMERA.chase.fov;
  }

  update(cam: PerspectiveCamera, st: CarState, dt: number): void {
    const fx = Math.cos(st.heading);
    const fz = Math.sin(st.heading);
    const speed = Math.abs(st.speed);
    let fov: number;

    if (this.mode === 'bonnet') {
      const b = CAMERA.bonnet;
      cam.position.set(st.x + fx * b.forward, b.height, st.z + fz * b.forward);
      cam.lookAt(st.x + fx * 30, 0.9, st.z + fz * 30);
      this.yaw = st.heading;
      fov = b.fov;
    } else {
      const c = CAMERA.chase;
      this.yaw += angleDelta(this.yaw, st.heading) * (1 - Math.exp(-c.yawFollow * dt));
      const yx = Math.cos(this.yaw);
      const yz = Math.sin(this.yaw);
      const dist = c.distance + speed * c.distancePerSpeed;
      // A little rumble when wheels are on the grass.
      this.shakeTime += dt;
      const shake = st.grass > 0 ? Math.sin(this.shakeTime * 47) * 0.04 * st.grass * Math.min(1, speed / 15) : 0;
      cam.position.set(st.x - yx * dist, c.height + shake, st.z - yz * dist);
      cam.lookAt(st.x + yx * c.lookAhead, c.lookHeight, st.z + yz * c.lookAhead);
      fov = Math.min(c.fovMax, c.fov + speed * c.fovPerSpeed);
    }
    this.fov += (fov - this.fov) * (1 - Math.exp(-4 * dt));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
