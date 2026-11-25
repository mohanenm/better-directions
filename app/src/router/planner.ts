/**
 * Plans the normal route and the "better" route for a mode, enforcing the detour cap.
 *
 * 1. Normal route: fastest walk.
 * 2. Better route: cheapest under the mode's cost model, pruned at the cap.
 * 3. If it's still over the cap, blend walking time back into the cost (cost + λ·time) with
 *    growing λ until it fits; failing that, the better route is the normal route.
 * Both routes go through assertRouteSafe before they're returned.
 */
import { detourCapSeconds } from "../safety/limits";
import { NORMAL, type CostModel, type Route, type Router } from "./astar";
import { assertRouteSafe } from "./verify";

export interface Plan {
  normal: Route;
  better: Route;
  capSeconds: number;
  /** 0 if the mode's own route fit the cap; otherwise the λ that made it fit. */
  blend: number;
  /** True if no fun route fit the cap and the better route is the normal one. */
  fellBackToNormal: boolean;
}

const BLENDS = [1, 4, 16, 64];

export function blended(model: CostModel, lambda: number): CostModel {
  return {
    id: `${model.id}+time×${lambda}`,
    turnAware: model.turnAware,
    minCostPerSecond: model.minCostPerSecond + lambda,
    edgeCost: (g, d, t, prev) => model.edgeCost(g, d, t, prev) + lambda * t,
  };
}

/**
 * `capSeconds` may only tighten the cap (a leg of a longer trip gets its share of the trip's cap);
 * it can never loosen it below the normal route's time or above the detour cap.
 */
export function plan(router: Router, start: number, goal: number, model: CostModel, capSeconds?: number): Plan | null {
  const g = router.g;
  const normal = router.route(start, goal, NORMAL);
  if (!normal) return null;
  assertRouteSafe(g, normal);
  const natural = detourCapSeconds(normal.timeS);
  capSeconds = capSeconds === undefined ? natural : Math.max(normal.timeS, Math.min(natural, capSeconds));

  const attempts: [number, CostModel][] = [[0, model], ...BLENDS.map((l): [number, CostModel] => [l, blended(model, l)])];
  for (const [lambda, m] of attempts) {
    const better = router.route(start, goal, m, { maxTimeS: capSeconds });
    if (better && better.timeS <= capSeconds) {
      assertRouteSafe(g, better, capSeconds);
      return { normal, better, capSeconds, blend: lambda, fellBackToNormal: false };
    }
  }
  return { normal, better: normal, capSeconds, blend: Infinity, fellBackToNormal: true };
}
