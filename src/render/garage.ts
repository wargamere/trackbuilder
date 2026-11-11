import { AmbientLight, CircleGeometry, DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera, RingGeometry, Scene, Texture, WebGLRenderer } from 'three';
import { CarModel } from '../car/model.ts';

/** A lightweight studio view of the actual race car, with no remote assets. */
export class Garage {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(34, 1, 0.1, 50);
  private readonly car: CarModel;
  private w = 0;
  private h = 0;
  private angle = -0.16;
  private dragging = false;
  private lastX = 0;
  private idle = 0;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    const floor = new Mesh(new CircleGeometry(3.5, 64), new MeshStandardMaterial({ color: 0x181b27, roughness: .65, metalness: .3 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.03;
    const ring = new Mesh(new RingGeometry(3.4, 3.43, 64), new MeshStandardMaterial({ color: paint, emissive: paint, emissiveIntensity: .5 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.02;
    this.scene.add(floor, ring);
    this.camera.position.set(5.1, 2.7, 6.7);
    this.camera.lookAt(0, 0.4, 0);
    this.renderer.domElement.setAttribute('aria-label', 'Your team’s race car');
    this.renderer.domElement.setAttribute('role', 'img');
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.title = 'Drag or use left and right arrows to rotate. Double-click to reset.';
    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (this.dragging) { this.angle += (e.clientX - this.lastX) * .012; this.lastX = e.clientX; this.idle = 0; } });
    const release = () => { this.dragging = false; };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
    canvas.addEventListener('dblclick', () => { this.angle = -.16; this.idle = 0; });
    canvas.addEventListener('keydown', (e) => {
      if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
      e.stopPropagation(); e.preventDefault(); this.angle += e.code === 'ArrowLeft' ? -.2 : .2; this.idle = 0;
    });
  }

  attach(target: HTMLElement, paint: number): void {
    this.car.setPaint(paint);
    target.append(this.renderer.domElement);
  }

  frame(dt = 0): void {
    const parent = this.renderer.domElement.parentElement;
    if (!parent?.isConnected) return;
    const { width, height } = parent.getBoundingClientRect();
    if (!width || !height) return;
    this.idle += dt;
    this.car.root.rotation.y = this.angle + (!this.dragging && !this.reducedMotion ? Math.sin(this.idle * .25) * .05 : 0);
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
