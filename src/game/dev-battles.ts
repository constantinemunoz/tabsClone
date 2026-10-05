import { formation, parseArmy, stressSetup } from '../data/army-gen.ts';
import { getMap } from '../data/maps.ts';
import type { BattleSetup } from '../sim/sim.ts';

/**
 * Developer battle setups from URL parameters, used before the placement UI exists and for
 * the stress test:
 *   ?stress=150                  N vs N mixed armies
 *   ?blue=scrapper*30,biglump*1&red=pikeling*20
 *   &map=meadow|plateaus|island  &seed=123
 */
export function devSetupFromUrl(search: string): BattleSetup | null {
  const p = new URLSearchParams(search);
  const mapId = getMap(p.get('map') ?? 'meadow').id;
  const seed = parseInt(p.get('seed') ?? '', 10) || 4242;
  const stress = parseInt(p.get('stress') ?? '', 10);
  if (stress > 0) return stressSetup(Math.min(stress, 1000), mapId, seed);
  const blue = p.get('blue');
  const red = p.get('red');
  if (blue || red) {
    const map = getMap(mapId);
    return {
      mapId,
      seed,
      units: [
        ...formation(parseArmy(blue ?? ''), 0, map.zones.blue),
        ...formation(parseArmy(red ?? ''), 1, map.zones.red),
      ],
    };
  }
  return null;
}
