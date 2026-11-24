import { readFileSync } from "node:fs";
import { decodeGraph, type DecodedGraph } from "../src/graph/format";
import { Graph } from "../src/graph/graph";

export function fixtureBuffer(name: string): ArrayBuffer {
  const buf = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export function loadFixture(name: string): Graph {
  return Graph.fromBuffer(fixtureBuffer(name));
}

export function decodeFixture(name: string): DecodedGraph {
  return decodeGraph(fixtureBuffer(name));
}

// Same conversion as pipeline/tests/osmfixture.py.
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320;

/** Node at fixture coordinates (metres), or throws. */
export function nodeAt(g: Graph, x: number, y: number): number {
  for (let n = 0; n < g.nodeCount; n++) {
    const [lon, lat] = g.nodeLonLat(n);
    if (Math.abs(lon * M_PER_DEG_LON - x) < 0.5 && Math.abs(lat * M_PER_DEG_LAT - y) < 0.5) return n;
  }
  throw new Error(`no node at ${x},${y}`);
}

export function wayNames(g: Graph, dirEdges: number[]): string[] {
  const names: string[] = [];
  for (const d of dirEdges) {
    const name = g.edgeName(d >>> 1);
    if (names[names.length - 1] !== name) names.push(name);
  }
  return names;
}
