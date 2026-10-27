// Sucrase accepts this, but strict mode rejects duplicate parameter names.
function sum(a, a) {
  return a + a;
}
