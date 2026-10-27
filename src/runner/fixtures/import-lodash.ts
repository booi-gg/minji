import { chunk } from "lodash";

export function solve(items: number[]): number[][] {
  return chunk(items, 2);
}
