import { type PerspectiveCamera, Vector3 } from 'three';
import { surfaceHeight, type Terrain } from '../sim/terrain.ts';

const origin = new Vector3();
const dir = new Vector3();

/**
 * Where the ray through a screen point (normalised device coordinates) meets the ground.
 * Marches along the ray against the heightmap, then bisects the crossing. Writes into out and
 * returns true on a hit.
 */
export function pickGround(camera: PerspectiveCamera, ndcX: number, ndcY: number, terrain: Terrain, out: Vector3): boolean {
  origin.setFromMatrixPosition(camera.matrixWorld);
  dir.set(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
  const step = 0.75;
  let prevT = 0;
  for (let t = step; t < 600; t += step) {
    const x = origin.x + dir.x * t;
    const y = origin.y + dir.y * t;
    const z = origin.z + dir.z * t;
    if (y <= surfaceHeight(terrain, x, z)) {
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 10; k++) {
        const mid = (lo + hi) / 2;
        const my = origin.y + dir.y * mid;
        if (my <= surfaceHeight(terrain, origin.x + dir.x * mid, origin.z + dir.z * mid)) hi = mid;
        else lo = mid;
      }
      out.set(origin.x + dir.x * hi, origin.y + dir.y * hi, origin.z + dir.z * hi);
      return true;
    }
    prevT = t;
    if (y < terrain.minHeight - 50) break;
  }
  return false;
}
