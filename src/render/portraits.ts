import {
  Color,
  DirectionalLight,
  HemisphereLight,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  PerspectiveCamera,
  Scene,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { attackStyleIndex, type UnitDef } from '../data/units.ts';
import { getUnitModel } from './model-cache.ts';
import { createLiveMaterial } from './unit-material.ts';

const SIZE = 160;

/**
 * Renders a small portrait of every unit type, in each team's colours, once at start-up.
 * Returns data URLs indexed [team][type] for the unit bar.
 */
export function renderPortraits(renderer: WebGLRenderer, defs: UnitDef[]): string[][] {
  const scene = new Scene();
  scene.add(new HemisphereLight(0xfff6e8, 0x6b5a48, 1.6));
  const sun = new DirectionalLight(0xffffff, 2.6);
  sun.position.set(2, 3, 4);
  scene.add(sun);
  const camera = new PerspectiveCamera(30, 1, 0.1, 50);
  const target = new WebGLRenderTarget(SIZE, SIZE);
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const out: string[][] = [[], []];
  const prevTarget = renderer.getRenderTarget();
  const prevClear = new Color();
  renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  for (let t = 0; t < defs.length; t++) {
    const def = defs[t];
    const model = getUnitModel(def);
    const data = new Float32Array(20);
    const buffer = new InstancedInterleavedBuffer(data, 20, 1);
    const geo = new InstancedBufferGeometry();
    for (const name of ['position', 'color', 'aPart', 'aPivot', 'aTint', 'aSet']) geo.setAttribute(name, model.geometry.getAttribute(name));
    geo.setIndex(model.geometry.index);
    geo.setAttribute('iPosYaw', new InterleavedBufferAttribute(buffer, 4, 0));
    geo.setAttribute('iSpring', new InterleavedBufferAttribute(buffer, 4, 4));
    geo.setAttribute('iSpringV', new InterleavedBufferAttribute(buffer, 4, 8));
    geo.setAttribute('iAnim', new InterleavedBufferAttribute(buffer, 4, 12));
    geo.setAttribute('iState', new InterleavedBufferAttribute(buffer, 4, 16));
    geo.instanceCount = 1;
    const mat = createLiveMaterial(model.layout, {
      scale: 1,
      attackStyle: attackStyleIndex(def.weapon.style),
      sidearmStyle: attackStyleIndex((def.sidearm ?? def.weapon).style),
      floppy: 0,
      horse: model.horse,
    });
    const mesh = new Mesh(geo, mat.material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    // Three-quarter view. People are framed from the knees up so faces and helmets read;
    // a horse is longer than it is tall, so horse and rider get the whole body, wider and lower.
    const h = model.layout.height;
    const lookY = h * (model.horse ? 0.45 : 0.6);
    if (model.horse) camera.position.set(h * 1.4, lookY + h * 0.25, h * 2.13);
    else camera.position.set(h * 0.66, lookY + h * 0.18, h * 1.68);
    camera.lookAt(0, lookY, 0);
    for (let team = 0; team < 2; team++) {
      data.fill(0);
      data[3] = 0.25;
      data[7] = 1;
      data[16] = team;
      buffer.needsUpdate = true;
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
      if (ctx) {
        const img = ctx.createImageData(SIZE, SIZE);
        // Flip vertically: GL rows start at the bottom.
        for (let y = 0; y < SIZE; y++) {
          img.data.set(pixels.subarray((SIZE - 1 - y) * SIZE * 4, (SIZE - y) * SIZE * 4), y * SIZE * 4);
        }
        ctx.putImageData(img, 0, 0);
        out[team][t] = canvas.toDataURL('image/png');
      } else {
        out[team][t] = '';
      }
    }
    scene.remove(mesh);
    geo.dispose();
    mat.material.dispose();
    mat.depth.dispose();
  }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  target.dispose();
  return out;
}
