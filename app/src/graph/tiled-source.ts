/**
 * Loads a tiled area's tiles as requests need them, and joins what's loaded into a graph the
 * planners can use. Which tiles a request needs depends only on the request (see
 * router/region.ts), so the routes are the same as planning on the whole graph would give.
 *
 * The worker fetches tiles over HTTP; tests read them from memory. `ensure` adds tiles and
 * `current` rebuilds the graph (and its indexes) when the loaded set has changed.
 */
import { FeatureIndex } from "../modes/features";
import { NORMAL, Router } from "../router/astar";
import { haversineM } from "../router/geometry";
import { circleRegion, DRAWING_MARGIN_M, REACH_SPEED_MS, REGION_MARGIN_M, restSeconds, tripRegion, type Region } from "../router/region";
import { NodeIndex, SNAP_RADIUS_M } from "../router/snap";
import { detourCapSeconds, DETOUR } from "../safety/limits";
import { Graph, type LonLat } from "./graph";
import { assemble, decodeTile, tileCentre, tileId, tileOf, TILE_FORMAT, TILE_VERSION, type Tile, type TiledBase } from "./tiles";

export interface Loaded {
  g: Graph;
  fi: FeatureIndex;
  index: NodeIndex;
  router: Router;
}

/**
 * The margin for a region worked out from tapped points rather than the nodes they snap to, so
 * snapping and the region load in one go. Each point snaps at most SNAP_RADIUS_M away, which
 * changes a trip region's sum of distances by at most twice that per leg.
 */
const snapMargin = (points: number) => REGION_MARGIN_M + SNAP_RADIUS_M * (points - 1);

export class TileSource {
  private readonly tiles = new Map<string, Tile>();
  private built: Loaded | null = null;

  constructor(
    readonly base: TiledBase,
    /** Fetches a tile; `fresh` asks to bypass any cache (a retry after a bad copy). */
    private readonly fetchTile: (id: string, fresh?: boolean) => Promise<ArrayBuffer>,
  ) {
    if (base.format !== TILE_FORMAT || base.version !== TILE_VERSION) throw new Error("The map data is from another version. Reload the page.");
  }

  private get allLoaded(): boolean {
    return this.tiles.size >= this.base.tiles.length;
  }

  /** Load any of these tiles not loaded yet. */
  async ensure(ids: Iterable<string>): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => !this.tiles.has(id));
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
      // Join in a fixed order, so the same set always gives the same graph.
      const ids = [...this.tiles.keys()].sort();
      const g = new Graph(assemble(this.base, ids.map((id) => this.tiles.get(id)!)));
      const features = this.base.features;
      let fi: FeatureIndex | null = null;
      // The feature index is only built when a planner needs it, not while checking normal routes.
      this.built = {
        g,
        get fi() {
          return (fi ??= new FeatureIndex(g, features));
        },
        index: new NodeIndex(g),
        router: new Router(g),
      };
    }
    return this.built;
  }

  /** Tiles that may hold a point within `marginM` of the region (tested at each tile's centre, with half its diagonal as slack). */
  private tilesWhere(region: Region, marginM: number): string[] {
    const grid = this.base.grid;
    const box = region.bbox(marginM);
    const [c0, r0] = tileOf(grid, box[0], box[1]);
    const [c1, r1] = tileOf(grid, box[2], box[3]);
    const exists = new Set(this.base.tiles);
    const out: string[] = [];
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const id = tileId(c, r);
        if (!exists.has(id)) continue;
        const centre = tileCentre(grid, c, r);
        const half = haversineM([centre[0] - grid.dLon / 2, centre[1] - grid.dLat / 2], [centre[0] + grid.dLon / 2, centre[1] + grid.dLat / 2]) / 2;
        if (region.contains(centre, half + marginM)) out.push(id);
      }
    }
    return out;
  }

  /** Tiles around the points, for snapping them to the nearest path. */
  private tilesAround(points: LonLat[]): string[] {
    return points.flatMap((p) => this.tilesWhere(circleRegion(p, SNAP_RADIUS_M), 0));
  }

  // --- Getting ready for a request ------------------------------------------------------------

  /**
   * Load everything a trip through these points can reach. The detour cap depends on the normal
   * route's time, which may run past the hour: then load out to that time's reach and look again,
   * until the normal routes fit what's loaded.
   */
  async prepareTrip(points: LonLat[], long: boolean): Promise<Loaded> {
    let cap = long ? DETOUR.longMaxSeconds : DETOUR.maxSeconds;
    for (;;) {
      await this.ensure([...this.tilesAround(points), ...this.tilesWhere(tripRegion(points, cap), snapMargin(points.length))]);
      const loaded = this.current();
      // With the whole area loaded there's nothing more to fetch.
      if (this.allLoaded) return loaded;
      const nodes = points.map((p) => loaded.index.nearest(p));
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
        // Not found on what's loaded: the normal route reaches further than this cap (or the
        // region is empty: the stops alone are further apart than the cap). Reach further; once
        // everything is loaded, a missing route is the planner's to report.
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

  /**
   * Load everything a walk through these points with a fixed cap can reach: a crawl to its end,
   * or a loop (start and end the same point).
   */
  async prepareFixedTrip(points: LonLat[], capSeconds: number): Promise<Loaded> {
    await this.ensure([...this.tilesAround(points), ...this.tilesWhere(tripRegion(points, capSeconds), snapMargin(points.length))]);
    return this.current();
  }

  /** Load everything a shape or spelled word from `start` can reach: anywhere within the cap's reach. */
  async prepareDrawing(start: LonLat, capSeconds: number): Promise<Loaded> {
    await this.ensure(this.tilesWhere(circleRegion(start, capSeconds * REACH_SPEED_MS), DRAWING_MARGIN_M));
    return this.current();
  }
}
