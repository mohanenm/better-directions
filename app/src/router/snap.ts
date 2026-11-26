/** Nearest-node lookup on a uniform grid, for turning a tap or a place into a graph node. */
import type { Graph, LonLat } from "../graph/graph";
import { haversineM } from "./geometry";

const CELL_DEG = 0.002; // ~150-220 m

export class NodeIndex {
  private readonly cells = new Map<string, number[]>();

  constructor(private readonly g: Graph) {
    for (let n = 0; n < g.nodeCount; n++) {
      if (g.outStart[n + 1]! === g.outStart[n]!) continue; // nothing walkable leaves this node
      if (!g.nodeOwned(n)) continue; // tiled: the far end of an edge leaving the loaded part
      const [lon, lat] = g.nodeLonLat(n);
      const key = this.key(Math.floor(lon / CELL_DEG), Math.floor(lat / CELL_DEG));
      const list = this.cells.get(key);
      if (list) list.push(n);
      else this.cells.set(key, [n]);
    }
  }

  /** Nearest usable node within maxDistanceM, or null. Ties go to the lower node id. */
  nearest(point: LonLat, maxDistanceM = 300): number | null {
    const cx = Math.floor(point[0] / CELL_DEG);
    const cy = Math.floor(point[1] / CELL_DEG);
    let best = -1;
    let bestD = Infinity;
    // Cells are narrower east to west further from the equator (125 m in Copenhagen), so reach
    // far enough at this latitude to cover the whole radius.
    const cellM = CELL_DEG * 111_320 * Math.cos((point[1] * Math.PI) / 180);
    const reach = Math.ceil(maxDistanceM / cellM);
    for (let r = 0; r <= reach; r++) {
      for (let i = cx - r; i <= cx + r; i++) {
        for (let j = cy - r; j <= cy + r; j++) {
          if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue;
          for (const n of this.cells.get(this.key(i, j)) ?? []) {
            const d = haversineM(point, this.g.nodeLonLat(n));
            if (d < bestD || (d === bestD && n < best)) {
              bestD = d;
              best = n;
            }
          }
        }
      }
    }
    return best >= 0 && bestD <= maxDistanceM ? best : null;
  }

  private key(i: number, j: number): string {
    return `${i},${j}`;
  }
}
