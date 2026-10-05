import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, type Scene } from 'three';
import { TEAM_COLORS } from '../config.ts';
import type { MapDef, Rect } from '../data/maps.ts';
import { surfaceHeight, type Terrain } from '../sim/terrain.ts';

const LIFT = 0.12;

function fillGeometry(t: Terrain, r: Rect, cell: number): BufferGeometry {
  const nx = Math.ceil((r.maxX - r.minX) / cell);
  const nz = Math.ceil((r.maxZ - r.minZ) / cell);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = Math.min(r.maxX, r.minX + i * cell);
      const z = Math.min(r.maxZ, r.minZ + j * cell);
      pos.push(x, surfaceHeight(t, x, z) + LIFT, z);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

/** A band along the rectangle's edge that follows the ground. */
function borderGeometry(t: Terrain, r: Rect, width: number): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const edge = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len / 1.5));
    const base = pos.length / 3;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const x = x0 + (x1 - x0) * f;
      const z = z0 + (z1 - z0) * f;
      pos.push(x, surfaceHeight(t, x, z) + LIFT + 0.02, z);
      const ix = x + nx * width;
      const iz = z + nz * width;
      pos.push(ix, surfaceHeight(t, ix, iz) + LIFT + 0.02, iz);
    }
    for (let s = 0; s < steps; s++) {
      const a = base + s * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  };
  edge(r.minX, r.minZ, r.maxX, r.minZ, 0, 1);
  edge(r.maxX, r.minZ, r.maxX, r.maxZ, -1, 0);
  edge(r.maxX, r.maxZ, r.minX, r.maxZ, 0, -1);
  edge(r.minX, r.maxZ, r.minX, r.minZ, 1, 0);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

/** The two deployment zones drawn on the ground during placement. */
export class ZoneOverlay {
  private meshes: Mesh[] = [];
  private fills: MeshBasicMaterial[] = [];
  private borders: MeshBasicMaterial[] = [];
  private readonly scene: Scene;
  visible = false;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  build(def: MapDef, t: Terrain): void {
    this.dispose();
    const zones = [def.zones.blue, def.zones.red];
    const colors = [TEAM_COLORS.blue, TEAM_COLORS.red];
    for (let k = 0; k < 2; k++) {
      const fill = new MeshBasicMaterial({ color: new Color(colors[k]), transparent: true, opacity: 0.14, depthWrite: false, side: DoubleSide, fog: true });
      const border = new MeshBasicMaterial({ color: new Color(colors[k]), transparent: true, opacity: 0.75, depthWrite: false, side: DoubleSide, fog: true });
      fill.polygonOffset = border.polygonOffset = true;
      fill.polygonOffsetFactor = border.polygonOffsetFactor = -3;
      fill.polygonOffsetUnits = border.polygonOffsetUnits = -3;
      const a = new Mesh(fillGeometry(t, zones[k], 2), fill);
      const b = new Mesh(borderGeometry(t, zones[k], 0.45), border);
      a.renderOrder = b.renderOrder = 2;
      for (const m of [a, b]) {
        m.matrixAutoUpdate = false;
        m.visible = this.visible;
        this.scene.add(m);
        this.meshes.push(m);
      }
      this.fills.push(fill);
      this.borders.push(border);
    }
  }

  setVisible(v: boolean): void {
    this.visible = v;
    for (const m of this.meshes) m.visible = v;
  }

  /** Highlight the side currently being placed. */
  setActive(team: number): void {
    for (let k = 0; k < this.fills.length; k++) {
      this.fills[k].opacity = k === team ? 0.2 : 0.08;
      this.borders[k].opacity = k === team ? 0.85 : 0.35;
    }
  }

  dispose(): void {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    for (const m of [...this.fills, ...this.borders]) m.dispose();
    this.meshes = [];
    this.fills = [];
    this.borders = [];
  }
}
