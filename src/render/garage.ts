import { AmbientLight, DirectionalLight, Mesh, PerspectiveCamera, Scene, Texture, WebGLRenderer } from 'three';
import { CarModel } from '../car/model.ts';

/** A lightweight studio view of the actual race car, with no remote assets. */
export class Garage {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(34, 1, 0.1, 50);
  private readonly car: CarModel;
  private w = 0;
  private h = 0;

  constructor(paint: number) {
    this.renderer = new WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.car = new CarModel(paint);
    this.scene.add(this.car.root, new AmbientLight(0xc8d4ff, 2));
    const key = new DirectionalLight(0xffffff, 3);
    key.position.set(2, 5, 4);
    const rim = new DirectionalLight(0xff4b72, 2);
    rim.position.set(-4, 2, -3);
    this.scene.add(key, rim);
    this.camera.position.set(4.7, 2.6, 5.8);
    this.camera.lookAt(0, 0.5, 0);
    this.renderer.domElement.setAttribute('aria-label', 'Your team’s race car');
    this.renderer.domElement.setAttribute('role', 'img');
  }

  attach(target: HTMLElement, paint: number): void {
    this.car.setPaint(paint);
    target.append(this.renderer.domElement);
  }

  frame(): void {
    const parent = this.renderer.domElement.parentElement;
    if (!parent?.isConnected) return;
    const { width, height } = parent.getBoundingClientRect();
    if (!width || !height) return;
    if (width !== this.w || height !== this.h) {
      this.w = width; this.h = height;
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    const textures = new Set<import('three').Texture>();
    const materials = new Set<import('three').Material>();
    this.scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      obj.geometry.dispose();
      for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        materials.add(mat);
        for (const value of Object.values(mat)) if (value instanceof Texture) textures.add(value);
      }
    });
    textures.forEach((t) => t.dispose());
    materials.forEach((m) => m.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
