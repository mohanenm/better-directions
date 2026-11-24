/**
 * Final check on every route before anyone sees it. Re-runs the safety rules straight from the
 * tags (not the load-time audit), checks the route is connected, and checks the detour cap.
 */
import type { Graph } from "../graph/graph";
import { footDirections, nodeExclusion, wayExclusion } from "../safety/rules";
import type { Route } from "./astar";

export class RouteSafetyError extends Error {}

export function assertRouteSafe(g: Graph, route: Route, capSeconds?: number): void {
  const ctxBits = g.meta.flags.node_ctx;
  const checkNode = (n: number): void => {
    const ctx = g.s.node_ctx[n]!;
    const reason = nodeExclusion(g.meta.node_tagsets[g.s.node_tagset[n]!]!, {
      on_railway: (ctx & ctxBits.on_railway) !== 0,
      on_fast_road: (ctx & ctxBits.on_fast_road) !== 0,
      on_linear_barrier: (ctx & ctxBits.on_linear_barrier) !== 0,
    });
    if (reason) throw new RouteSafetyError(`route passes excluded node ${n}: ${reason}`);
  };
  route.nodes.forEach(checkNode);
  route.dirEdges.forEach((d, i) => {
    const e = d >>> 1;
    const forward = (d & 1) === 0;
    const tags = g.edgeTags(e);
    const reason = wayExclusion(tags);
    if (reason) throw new RouteSafetyError(`route uses excluded way on edge ${e}: ${reason}`);
    const [fwd, bwd] = footDirections(tags);
    if (forward ? !fwd : !bwd) throw new RouteSafetyError(`route walks edge ${e} the wrong way`);
    if (!(g.allowedDirs[e]! & (forward ? 1 : 2))) throw new RouteSafetyError(`edge ${e} disabled by audit`);
    if (g.tail(d) !== route.nodes[i] || g.head(d) !== route.nodes[i + 1]) {
      throw new RouteSafetyError(`route is not connected at step ${i}`);
    }
  });
  if (capSeconds !== undefined && route.timeS > capSeconds + 1e-6) {
    throw new RouteSafetyError(`route takes ${route.timeS}s, over the detour cap of ${capSeconds}s`);
  }
}
