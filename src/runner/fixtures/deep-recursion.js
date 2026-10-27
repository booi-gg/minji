function depth(n) {
  return n === 0 ? 0 : 1 + depth(n - 1);
}
