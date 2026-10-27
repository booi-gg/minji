// Counts monotone lattice paths through an m x n grid, modulo 1e9+7.
function uniquePaths(m: number, n: number): number {
  const MOD = 1_000_000_007;
  const row = new Array<number>(n).fill(1);
  for (let r = 1; r < m; r++) {
    for (let c = 1; c < n; c++) {
      row[c] = (row[c] + row[c - 1]) % MOD;
    }
  }
  return row[n - 1];
}
