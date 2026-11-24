import { describe, expect, it } from "vitest";
import { decodeGraph, GraphFormatError } from "../src/graph/format";
import { decodeFixture, fixtureBuffer } from "./helpers";

describe("graph format", () => {
  it("decodes a pipeline-built graph", () => {
    const { meta, s } = decodeFixture("minitown.bin");
    expect(meta.format).toBe("better-directions-graph");
    expect(s.edge_from.length).toBe(meta.counts.edges);
    expect(s.node_lat.length).toBe(meta.counts.nodes);
    expect(s.edge_geom_offset.length).toBe(meta.counts.edges + 1);
  });

  it("rejects files that aren't graphs", () => {
    expect(() => decodeGraph(new TextEncoder().encode("PK\x03\x04 not a graph").buffer)).toThrow(GraphFormatError);
  });

  it("rejects truncated files", () => {
    const buf = fixtureBuffer("minitown.bin");
    expect(() => decodeGraph(buf.slice(0, buf.byteLength - 8))).toThrow(GraphFormatError);
  });

  it("rejects unknown versions", () => {
    const buf = fixtureBuffer("minitown.bin");
    new DataView(buf).setUint32(4, 99, true);
    expect(() => decodeGraph(buf)).toThrow(/version/);
  });
});
