/**
 * Loads an area's tiles as requests need them, and joins what's loaded into a graph the
 * planners can use. Which tiles a request needs depends only on the request (see
 * router/region.ts), so the routes are the same as planning on the whole graph would give.
 *
 * The worker fetches tiles over HTTP; tests read them from memory. Either way `ensure` adds
 * tiles and `current` rebuilds the graph (and its indexes) when the loaded set has changed.
 */
import { FeatureIndex } from "../modes/features";
import { NORMAL, Router } from "../router/astar";
import { haversineM } from "../router/geometry";
import { boxAround, loopRegion, REACH_SPEED_MS, REGION_MARGIN_M, restSeconds, tripRegion } from "../router/region";
import { NodeIndex } from "../router/snap";
import { detourCapSeconds, DETOUR } from "../safety/limits";
import { Graph, type LonLat } from "./graph";
import { assemble, decodeTile, tileCentre, tileId, tileOf, WHOLE_FILE, type BaseFile, type Tile } from "./tiles";

export interface Loaded {
  g: Graph;
  fi: FeatureIndex;
  index: NodeIndex;
  router: Router;
}

/** Snapping looks this far for a path (the worker's limit). */
export const SNAP_RADIUS_M = 300;

/**
 * The margin for a region worked out from tapped points rather than the nodes they snap to, so
 * snapping and the region load in one go. Each point snaps at most SNAP_RADIUS_M away, which
 * changes a trip region's sum of distances by at most twice that per leg.
 */
const snapMargin = (points: number) => REGION_MARGIN_M + SNAP_RADIUS_M * Math.max(1, points - 1);

export class TileSource {
  private readonly tiles = new Map<string, Tile>();
  /** An untiled area's whole graph, once loaded. */
  private whole: Graph | null = null;
  private built: Loaded | null = null;

  constructor(
    readonly base: BaseFile,
    /** Fetches a tile; `fresh` asks to bypass any cache (a retry after a bad copy). */
    private readonly fetchTile: (id: string, fresh?: boolean) => Promise<ArrayBuffer>,
  ) {}

  /** An area that isn't cut up loads its whole graph at the start (see TILED_FROM_BYTES). */
  async preloadIfWhole(): Promise<void> {
    if (this.base.whole) await this.ensure([]);
  }

  /** Tiles loaded so far. */
  get loadedCount(): number {
    return this.tiles.size;
  }

  /** Load any of these tiles not loaded yet (tiles that don't exist are empty and skipped). */
  async ensure(ids: Iterable<string>): Promise<void> {
    if (this.base.whole) {
      // Not cut up: the whole graph, decoded as built, is everything any request needs.
      if (!this.whole) {
        this.whole = Graph.fromBuffer(await this.fetchTile(WHOLE_FILE));
        this.built = null;
      }
      return;
    }
    const missing = [...new Set(ids)].filter((id) => id in this.base.tiles && !this.tiles.has(id));
    if (!missing.length) return;
    const tiles = await Promise.all(missing.map((id) => this.load(id)));
    missing.forEach((id, i) => this.tiles.set(id, tiles[i]!));
    this.built = null;
  }

  /** Fetch and decode a tile; a copy that won't decode is fetched once more, bypassing caches. */
  private async load(id: string): Promise<Tile> {
    try {
      return decodeTile(await this.fetchTile(id));
    } catch {
      return decodeTile(await this.fetchTile(id, true));
    }
  }

  /** The graph joined from the loaded tiles, with its indexes, rebuilt only when tiles were added. */
  current(): Loaded {
    if (!this.built) {
      let g: Graph;
      if (this.whole) g = this.whole;
      else {
        // Join in a fixed order, so the same set always gives the same graph.
        const ids = [...this.tiles.keys()].sort();
        g = new Graph(assemble(this.base, ids.map((id) => this.tiles.get(id)!)));
      }
      // The whole graph works out its own features; a tiled one maps the exported lists.
      this.built = { g, fi: new FeatureIndex(g, this.whole ? undefined : (this.base.features ?? undefined)), index: new NodeIndex(g), router: new Router(g) };
    }
    return this.built;
  }

  // --- Which tiles a request needs ------------------------------------------------------------

  /**
   * Tiles that may hold a point within `marginM` of the region: a tile whose centre fails the
   * test by more than its half-diagonal (twice, for the two distances) can't.
   */
  private tilesWhere(bbox: [number, number, number, number], test: (centre: LonLat, slackM: number) => boolean): string[] {
    const grid = this.base.grid;
    const [c0, r0] = tileOf(grid, bbox[0], bbox[1]);
    const [c1, r1] = tileOf(grid, bbox[2], bbox[3]);
    const out: string[] = [];
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const id = tileId(c, r);
        if (!(id in this.base.tiles)) continue;
        const centre = tileCentre(grid, c, r);
        const half = haversineM([centre[0] - grid.dLon / 2, centre[1] - grid.dLat / 2], [centre[0] + grid.dLon / 2, centre[1] + grid.dLat / 2]) / 2;
        if (test(centre, half)) out.push(id);
      }
    }
    return out;
  }

  /** Tiles around a point, for snapping it to the nearest path within SNAP_RADIUS_M. */
  tilesAround(p: LonLat, radiusM = SNAP_RADIUS_M): string[] {
    return this.tilesWhere(boxAround([p], radiusM), (c, half) => haversineM(p, c) - half <= radiusM);
  }

  /** Tiles for a trip through `points` in order, capped at `capSeconds`, plus the margin. */
  tilesForTrip(points: LonLat[], capSeconds: number, marginM = REGION_MARGIN_M): string[] {
    const reach = capSeconds * REACH_SPEED_MS;
    const n = points.length;
    const prefix = [0];
    for (let i = 1; i < n; i++) prefix.push(prefix[i - 1]! + haversineM(points[i - 1]!, points[i]!));
    const total = prefix[n - 1]!;
    const region = tripRegion(points, capSeconds);
    return this.tilesWhere(region.bbox(marginM), (c, half) => {
      for (let i = 0; i < n - 1; i++) {
        const sum = prefix[i]! + haversineM(points[i]!, c) + haversineM(c, points[i + 1]!) + (total - prefix[i + 1]!);
        if (sum - 2 * half <= reach + 2 * marginM) return true;
      }
      return false;
    });
  }

  /** Tiles for a walk from `start` within `capSeconds`, back to the start or ending anywhere. */
  tilesForLoop(start: LonLat, capSeconds: number, closed: boolean, marginM = REGION_MARGIN_M): string[] {
    const radius = (capSeconds * REACH_SPEED_MS) / (closed ? 2 : 1);
    return this.tilesWhere(loopRegion(start, capSeconds, closed).bbox(marginM), (c, half) => haversineM(start, c) - half <= radius + marginM);
  }

  // --- Getting ready for a request ------------------------------------------------------------

  /** Load what snapping these points needs, and snap them; null for a point with no path near. */
  async snap(points: LonLat[]): Promise<(number | null)[]> {
    await this.ensure(points.flatMap((p) => this.tilesAround(p)));
    const { index } = this.current();
    return points.map((p) => index.nearest(p, SNAP_RADIUS_M));
  }

  /**
   * Load everything a trip through these (already snappable) points can reach. The detour cap
   * depends on the normal route's time, which may run past the hour: then load out to that
   * time's reach and look again, until the normal routes fit what's loaded.
   */
  async prepareTrip(points: LonLat[], long: boolean): Promise<Loaded> {
    let cap = long ? DETOUR.longMaxSeconds : DETOUR.maxSeconds;
    const margin = snapMargin(points.length);
    for (;;) {
      await this.ensure([...points.flatMap((p) => this.tilesAround(p)), ...this.tilesForTrip(points, cap, margin)]);
      const loaded = this.current();
      // With the whole area loaded there's nothing more to fetch, so skip checking the normal routes.
      if (this.base.whole || this.tiles.size >= Object.keys(this.base.tiles).length) return loaded;
      const nodes = points.map((p) => loaded.index.nearest(p, SNAP_RADIUS_M));
      if (nodes.includes(null)) return loaded; // the planner reports it
      let total = 0;
      let missing = false;
      for (let i = 0; i < nodes.length - 1 && !missing; i++) {
        if (nodes[i] === nodes[i + 1]) continue;
        const leg = loaded.router.route(nodes[i]!, nodes[i + 1]!, NORMAL);
        if (leg) total += leg.timeS;
        else missing = true;
      }
      if (missing) {
        // Not found on what's loaded: the normal route is longer than this cap reaches (or the
        // region is empty: the stops alone are further apart than the cap). Reach further, and
        // only once the whole area is loaded is it truly unreachable (the planner reports it).
        if (this.tiles.size >= Object.keys(this.base.tiles).length) return loaded;
        cap = Math.max(cap * 1.5, restSeconds(points, 0) * 1.5);
        continue;
      }
      // Each normal leg only searched points its own time could reach, which lie inside the trip
      // region for the total; so once that total fits what's loaded, the normal routes are right.
      const needed = detourCapSeconds(total, long);
      if (needed <= cap) return loaded;
      cap = needed;
    }
  }

  /** Load everything a trip through these points with a fixed cap can reach (a crawl to its end). */
  async prepareFixedTrip(points: LonLat[], capSeconds: number): Promise<Loaded> {
    await this.ensure([...points.flatMap((p) => this.tilesAround(p)), ...this.tilesForTrip(points, capSeconds, snapMargin(points.length))]);
    return this.current();
  }

  /**
   * Load everything a walk from `start` within `capSeconds` can reach. Shapes and spelled words
   * start from a path near the template's first point rather than the snapped start, so they ask
   * for a wider margin.
   */
  async prepareLoop(start: LonLat, capSeconds: number, closed: boolean, marginM = REGION_MARGIN_M): Promise<Loaded> {
    await this.ensure([...this.tilesAround(start), ...this.tilesForLoop(start, capSeconds, closed, marginM + SNAP_RADIUS_M)]);
    return this.current();
  }
}
