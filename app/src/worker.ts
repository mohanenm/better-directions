/**
 * Planning worker: loads the area's walking graph (whole, or for big areas the tiles each request
 * can reach) and answers requests (see requests.ts). Runs off the main thread so the page never
 * freezes. Everything happens on the device; nothing is sent anywhere.
 */
import { cityData } from "./city";
import { Graph } from "./graph/graph";
import { TileSource, type Loaded } from "./graph/tiled-source";
import { WHOLE_FILE, type BaseFile } from "./graph/tiles";
import { FeatureIndex } from "./modes/features";
import { handle, prepareRequest, SpellError } from "./requests";
import { Router } from "./router/astar";
import { NodeIndex } from "./router/snap";
import type { FromWorker, ToWorker } from "./ui/protocol";

/** An area loaded whole: its graph, ready for any request. */
let whole: Loaded | null = null;
/** A tiled area's tiles, loaded as requests need them (see graph/tiled-source.ts). */
let source: TileSource | null = null;
const post = (msg: FromWorker) => self.postMessage(msg);

async function fetchData(file: string, fresh = false): Promise<Response> {
  const res = await fetch(cityData(`graph/${file}`), fresh ? { cache: "no-store" } : {});
  if (!res.ok) throw new Error(`Couldn't load the map data (${res.status}). Try again.`);
  return res;
}

async function init(): Promise<void> {
  const t0 = performance.now();
  const base = (await (await fetchData("base.json")).json()) as BaseFile;
  let meta;
  if (base.whole) {
    const g = Graph.fromBuffer(await (await fetchData(`${WHOLE_FILE}.bin`)).arrayBuffer());
    whole = { g, fi: new FeatureIndex(g), index: new NodeIndex(g), router: new Router(g) };
    meta = g.meta;
  } else {
    source = new TileSource(base, async (id, fresh) => (await fetchData(`${id}.bin`, fresh)).arrayBuffer());
    meta = base.meta;
  }
  post({
    type: "ready",
    info: {
      city: meta.city.name,
      bbox: meta.city.bbox,
      attribution: meta.attribution,
      terrainAttribution: meta.terrain.attribution ?? "",
      dataAsOf: meta.source.data_as_of ?? "",
      timings: { loadMs: Math.round(performance.now() - t0), tiled: !base.whole },
    },
  });
}

async function prepare(msg: ToWorker): Promise<Loaded> {
  if (whole) return whole;
  if (!source) throw new Error("Still loading the map data.");
  return prepareRequest(source, msg);
}

self.addEventListener("message", (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  // Load what the request needs, then plan on exactly that, with no await in between.
  prepare(msg)
    .then((loaded) => post(handle(loaded, msg)))
    .catch((err: unknown) => {
      const suggestion = err instanceof SpellError ? err.suggestion : undefined;
      post({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err), ...(suggestion ? { suggestion } : {}) });
    });
});

init().catch((err: unknown) => post({ type: "fatal", message: err instanceof Error ? err.message : String(err) }));
