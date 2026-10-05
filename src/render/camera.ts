import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';
import type { Rect } from '../data/maps.ts';
import { surfaceHeight, type Terrain } from '../sim/terrain.ts';

const MIN_DIST = 6;
const MAX_DIST = 150;
const MIN_PITCH = MathUtils.degToRad(7);
const MAX_PITCH = MathUtils.degToRad(86);
const DRAG_THRESHOLD = 5;

export interface PointerHandlers {
  /** Left button pressed (not yet known whether it becomes a drag). */
  onLeftDown?(x: number, y: number): void;
  onLeftMove?(x: number, y: number): void;
  onLeftUp?(x: number, y: number): void;
  /** Right click without dragging. */
  onRightClick?(x: number, y: number): void;
  onHover?(x: number, y: number): void;
}

/**
 * Free camera: WASD/arrows pan, drag to orbit, wheel to zoom.
 * Right/middle drag always orbits; left drag orbits unless a placement tool claims it.
 * Everything is clamped to sensible limits around the map.
 */
export class CameraController {
  readonly target = new Vector3();
  yaw = Math.PI * 0.5;
  pitch = MathUtils.degToRad(38);
  distance = 70;

  private goalTarget = new Vector3();
  private goalYaw = this.yaw;
  private goalPitch = this.pitch;
  private goalDistance = this.distance;

  private keys = new Set<string>();
  private dragButton = -1;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastX = 0;
  private lastY = 0;
  private dragging = false;
  /** When true, left drag is forwarded to handlers instead of orbiting. */
  leftClaimed = false;
  handlers: PointerHandlers = {};
  enabled = true;

  private bounds: Rect = { minX: -60, maxX: 60, minZ: -40, maxZ: 40 };
  private terrain: Terrain | null = null;
  private readonly camera: PerspectiveCamera;
  private readonly el: HTMLElement;
  private readonly tmp = new Vector3();

  constructor(camera: PerspectiveCamera, el: HTMLElement) {
    this.camera = camera;
    this.el = el;
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
  }

  setTerrain(t: Terrain, bounds: Rect): void {
    this.terrain = t;
    this.bounds = bounds;
  }

  /** Jump (or glide, if smooth) to a view. */
  setView(x: number, z: number, yaw: number, pitch: number, distance: number, smooth = false): void {
    this.goalTarget.set(x, this.groundAt(x, z), z);
    this.goalYaw = yaw;
    this.goalPitch = pitch;
    this.goalDistance = distance;
    if (!smooth) {
      this.target.copy(this.goalTarget);
      this.yaw = yaw;
      this.pitch = pitch;
      this.distance = distance;
    }
  }

  /** Nudge the camera toward a point, e.g. for the final-kill push-in. */
  pushTo(x: number, z: number, distance: number): void {
    this.goalTarget.set(x, this.groundAt(x, z), z);
    this.goalDistance = MathUtils.clamp(distance, MIN_DIST, MAX_DIST);
  }

  private groundAt(x: number, z: number): number {
    if (!this.terrain) return 0;
    return Math.max(surfaceHeight(this.terrain, x, z), this.terrain.minHeight);
  }

  private isTyping(): boolean {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.isTyping()) return;
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    this.el.setPointerCapture?.(e.pointerId);
    this.dragButton = e.button;
    this.dragStartX = this.lastX = e.clientX;
    this.dragStartY = this.lastY = e.clientY;
    this.dragging = false;
    if (e.button === 0 && this.leftClaimed) this.handlers.onLeftDown?.(e.clientX, e.clientY);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (this.dragButton < 0) {
      if (e.target === this.el) this.handlers.onHover?.(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (!this.dragging) {
      const tx = e.clientX - this.dragStartX;
      const ty = e.clientY - this.dragStartY;
      if (tx * tx + ty * ty > DRAG_THRESHOLD * DRAG_THRESHOLD) this.dragging = true;
    }
    if (this.dragButton === 0 && this.leftClaimed) {
      this.handlers.onLeftMove?.(e.clientX, e.clientY);
      return;
    }
    if (this.dragging) {
      this.goalYaw -= dx * 0.0055;
      this.goalPitch = MathUtils.clamp(this.goalPitch + dy * 0.0045, MIN_PITCH, MAX_PITCH);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.dragButton < 0) return;
    const button = this.dragButton;
    this.dragButton = -1;
    if (button === 0 && this.leftClaimed) this.handlers.onLeftUp?.(e.clientX, e.clientY);
    if (button === 2 && !this.dragging) this.handlers.onRightClick?.(e.clientX, e.clientY);
    this.dragging = false;
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    this.goalDistance = MathUtils.clamp(this.goalDistance * Math.exp(delta * 0.0011), MIN_DIST, MAX_DIST);
  };

  update(dt: number): void {
    // Keyboard panning, relative to where the camera looks, faster when zoomed out.
    let mx = 0;
    let mz = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    }
    if (mx !== 0 || mz !== 0) {
      const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2.2 : 1;
      const speed = (12 + this.goalDistance * 0.65) * fast * dt;
      const len = Math.hypot(mx, mz);
      const sy = Math.sin(this.yaw);
      const cy = Math.cos(this.yaw);
      // Forward (mz = -1) points from the camera toward the target.
      this.goalTarget.x += ((mx * cy + mz * sy) / len) * speed;
      this.goalTarget.z += ((-mx * sy + mz * cy) / len) * speed;
    }
    const b = this.bounds;
    const m = 12;
    this.goalTarget.x = MathUtils.clamp(this.goalTarget.x, b.minX - m, b.maxX + m);
    this.goalTarget.z = MathUtils.clamp(this.goalTarget.z, b.minZ - m, b.maxZ + m);
    this.goalTarget.y = this.groundAt(this.goalTarget.x, this.goalTarget.z);

    const k = 1 - Math.exp(-dt * 10);
    this.target.lerp(this.goalTarget, k);
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.pitch += (this.goalPitch - this.pitch) * k;
    this.distance += (this.goalDistance - this.distance) * k;

    const cp = Math.cos(this.pitch);
    const pos = this.tmp.set(
      this.target.x + Math.sin(this.yaw) * cp * this.distance,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * cp * this.distance,
    );
    // Never dip under the terrain.
    const floor = this.groundAt(pos.x, pos.z) + 1.5;
    if (pos.y < floor) pos.y = floor;
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target.x, this.target.y + 1, this.target.z);
  }
}
