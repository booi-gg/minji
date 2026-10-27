function leak(set) {
  if (set) globalThis.leaked = 42;
  return typeof globalThis.leaked;
}
