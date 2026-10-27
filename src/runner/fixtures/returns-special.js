function special(kind) {
  switch (kind) {
    case "undefined": return undefined;
    case "nan": return NaN;
    case "negative-zero": return -0;
    case "infinity": return [Infinity, -Infinity];
    case "holes": return [1, , 3];
    case "nested-undefined": return { a: undefined, b: [undefined] };
    case "dollar-key": return { $minji: "NaN" };
    case "map": return new Map([[1, 2]]);
    case "nested-set": return { items: [1, new Set()] };
    case "cycle": { const a = [1]; a.push(a); return a; }
    case "bigint": return 10n;
    case "class": return new (class Point { constructor() { this.x = 1; } })();
    case "proto-key": return JSON.parse('{"__proto__": 1}');
    default: return kind;
  }
}
