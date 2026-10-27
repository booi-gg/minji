// Harness evaluated inside the sandbox Worker before the user's code. It must stay
// self-contained: no imports and no host APIs. See specs/runner.md.
//
// It defines globalThis.__minjiRun(load, argsJson, config), which returns a JSON string
// describing one test. `load` is the user's code compiled as a function
// `(exports, module, require)` that returns the function to call.
(function () {
  "use strict";

  var TAG = "$minji";
  var MAX_DEPTH = 1000;
  var MAX_STACK_CHARS = 4000;
  var INSPECT_DEPTH = 4;
  var INSPECT_ITEMS = 100;
  var IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

  // Captured up front so user code that reassigns them can't break the harness.
  var stringify = JSON.stringify;
  var parse = JSON.parse;
  var isArray = Array.isArray;
  var keysOf = Object.keys;
  var getPrototypeOf = Object.getPrototypeOf;
  var objectProto = Object.prototype;
  var hasOwn = Object.hasOwn;
  // oxlint-disable-next-line typescript/unbound-method -- always invoked with .call()
  var objectToString = objectProto.toString;
  var create = Object.create;

  var state = {
    console: [],
    consoleChars: 0,
    consoleBudget: 0,
    consoleTruncated: false,
  };

  function now() {
    if (typeof performance !== "undefined") return performance.now();
    return Date.now();
  }

  function typeName(value) {
    try {
      var tag = objectToString.call(value).slice(8, -1);
      if (tag !== "Object") return tag;
      var ctor = value.constructor;
      return ctor && typeof ctor.name === "string" && ctor.name ? ctor.name : "Object";
    } catch {
      return "Object";
    }
  }

  function keySegment(key) {
    return IDENTIFIER.test(key) ? "." + key : "[" + stringify(key) + "]";
  }

  function pathOf(segments) {
    var path = "";
    for (var i = 0; i < segments.length; i += 1) {
      var segment = segments[i];
      path += typeof segment === "number" ? "[" + segment + "]" : keySegment(segment);
    }
    return path;
  }

  // ---- Console --------------------------------------------------------------------

  function inspect(value, depth, ancestors) {
    switch (typeof value) {
      case "string":
        return depth === 0 ? value : stringify(value);
      case "number":
        return value === 0 && 1 / value < 0 ? "-0" : String(value);
      case "bigint":
        return String(value) + "n";
      case "boolean":
      case "undefined":
      case "symbol":
        return String(value);
      case "function":
        return "[Function " + (value.name || "anonymous") + "]";
      default:
        break;
    }
    if (value === null) return "null";
    if (ancestors.indexOf(value) !== -1) return "[Circular]";
    var type = typeName(value);
    if (isArray(value)) {
      if (depth >= INSPECT_DEPTH) return "[Array]";
      ancestors.push(value);
      var items = [];
      var shown = Math.min(value.length, INSPECT_ITEMS);
      for (var i = 0; i < shown; i += 1)
        items[items.length] = inspect(value[i], depth + 1, ancestors);
      if (value.length > shown) items[items.length] = "… " + (value.length - shown) + " more";
      ancestors.pop();
      return "[" + items.join(", ") + "]";
    }
    if (type === "Error" || value instanceof Error) {
      return String(value.name) + ": " + String(value.message);
    }
    var proto = getPrototypeOf(value);
    if (proto !== objectProto && proto !== null) return "[" + type + "]";
    if (depth >= INSPECT_DEPTH) return "[Object]";
    ancestors.push(value);
    var keys = keysOf(value);
    var parts = [];
    var shownKeys = Math.min(keys.length, INSPECT_ITEMS);
    for (var k = 0; k < shownKeys; k += 1) {
      var key = keys[k];
      var label = IDENTIFIER.test(key) ? key : stringify(key);
      parts[parts.length] = label + ": " + inspect(value[key], depth + 1, ancestors);
    }
    if (keys.length > shownKeys) parts[parts.length] = "… " + (keys.length - shownKeys) + " more";
    ancestors.pop();
    return "{" + parts.join(", ") + "}";
  }

  function formatArgs(args) {
    var parts = [];
    for (var i = 0; i < args.length; i += 1) {
      try {
        parts[parts.length] = inspect(args[i], 0, []);
      } catch {
        parts[parts.length] = "[Unprintable]";
      }
    }
    return parts.join(" ");
  }

  function record(level, args) {
    if (state.consoleTruncated) return;
    var text = formatArgs(args);
    // Budget is counted in UTF-16 code units plus one per line, close enough to bytes for ASCII.
    var cost = text.length + 1;
    if (state.consoleChars + cost > state.consoleBudget) {
      var room = state.consoleBudget - state.consoleChars - 1;
      if (room > 0)
        state.console[state.console.length] = { level: level, text: text.slice(0, room) };
      state.consoleChars = state.consoleBudget;
      state.consoleTruncated = true;
      return;
    }
    state.consoleChars += cost;
    state.console[state.console.length] = { level: level, text: text };
  }

  function makeLogger(level) {
    return function () {
      record(level, arguments);
    };
  }

  globalThis.console = {
    log: makeLogger("log"),
    info: makeLogger("info"),
    warn: makeLogger("warn"),
    error: makeLogger("error"),
    debug: makeLogger("debug"),
  };

  // ---- Encoding -------------------------------------------------------------------

  function EncodeFailure(kind, path, type) {
    this.kind = kind;
    this.path = path;
    this.type = type;
  }

  function tag(name) {
    var tagged = {};
    tagged[TAG] = name;
    return tagged;
  }

  function encode(root, maxSize) {
    var size = 0;
    var ancestors = [];
    var segments = [];

    function fail(kind, type) {
      throw new EncodeFailure(kind, pathOf(segments), type);
    }

    function walk(value, depth) {
      if (size > maxSize) fail("output-too-large", "");
      switch (typeof value) {
        case "string":
          size += value.length + 3;
          return value;
        case "boolean":
          size += 6;
          return value;
        case "number":
          if (value !== value) return tag("NaN");
          if (value === Infinity) return tag("Infinity");
          if (value === -Infinity) return tag("-Infinity");
          if (value === 0 && 1 / value < 0) return tag("-0");
          size += ("" + value).length + 1;
          return value;
        case "undefined":
          size += 20;
          return tag("undefined");
        case "bigint":
          return fail("non-serializable", "BigInt");
        case "symbol":
          return fail("non-serializable", "Symbol");
        case "function":
          return fail("non-serializable", "Function");
        default:
          break;
      }
      if (value === null) {
        size += 5;
        return null;
      }
      if (depth > MAX_DEPTH)
        fail("non-serializable", "nesting deeper than " + MAX_DEPTH + " levels");
      if (ancestors.indexOf(value) !== -1) fail("non-serializable", "circular reference");
      ancestors[ancestors.length] = value;
      var out;
      if (isArray(value)) {
        out = [];
        size += 2;
        for (var i = 0; i < value.length; i += 1) {
          segments[segments.length] = i;
          out[i] = i in value ? walk(value[i], depth + 1) : walk(undefined, depth + 1);
          segments.length -= 1;
        }
      } else {
        var proto = getPrototypeOf(value);
        if (proto !== objectProto && proto !== null) fail("non-serializable", typeName(value));
        out = create(null);
        size += 2;
        var keys = keysOf(value);
        for (var k = 0; k < keys.length; k += 1) {
          var key = keys[k];
          segments[segments.length] = key;
          size += key.length + 4;
          out[key] = walk(value[key], depth + 1);
          segments.length -= 1;
        }
        if (hasOwn(value, TAG)) {
          var wrapped = tag("object");
          wrapped.value = out;
          out = wrapped;
        }
      }
      ancestors.length -= 1;
      return out;
    }

    var encoded = walk(root, 0);
    if (size > maxSize) fail("output-too-large", "");
    return encoded;
  }

  // ---- Running --------------------------------------------------------------------

  function errorInfo(error) {
    if (error !== null && typeof error === "object" && "message" in error) {
      var info = { name: String(error.name || "Error"), message: String(error.message) };
      if (typeof error.stack === "string") info.stack = error.stack.slice(0, MAX_STACK_CHARS);
      return info;
    }
    return { name: "Thrown value", message: formatArgs([error]) };
  }

  function requireShim(specifier) {
    var error = new Error("Imports aren't supported: " + specifier);
    error.name = "MinjiImportsUnsupported";
    error.specifier = String(specifier);
    throw error;
  }

  function finish(output) {
    output.console = state.console;
    output.consoleTruncated = state.consoleTruncated;
    if (output.durationMs === undefined) output.durationMs = 0;
    return stringify(output);
  }

  globalThis.__minjiRun = function (load, argsJson, config) {
    state.console = [];
    state.consoleChars = 0;
    state.consoleBudget = config.consoleBudget;
    state.consoleTruncated = false;

    var fn;
    try {
      var exportsObject = {};
      fn = load(exportsObject, { exports: exportsObject }, requireShim);
    } catch (error) {
      if (error && error.name === "MinjiImportsUnsupported") {
        return finish({ kind: "imports-unsupported", specifier: error.specifier });
      }
      return finish({ kind: "threw", phase: "load", error: errorInfo(error) });
    }
    if (typeof fn !== "function") return finish({ kind: "missing-function" });

    var args;
    try {
      args = parse(argsJson);
    } catch (error) {
      return finish({ kind: "threw", phase: "args", error: errorInfo(error) });
    }
    if (!isArray(args)) {
      return finish({
        kind: "threw",
        phase: "args",
        error: { name: "TypeError", message: "Arguments must be a JSON array" },
      });
    }

    var returned;
    var start = now();
    try {
      returned = fn.apply(undefined, args);
    } catch (error) {
      return finish({ kind: "threw", error: errorInfo(error), durationMs: now() - start });
    }
    var durationMs = now() - start;

    var target = config.captureIndex >= 0 ? args[config.captureIndex] : returned;
    try {
      var value = encode(target, config.maxResultSize);
      return finish({ kind: "returned", value: value, durationMs: durationMs });
    } catch (failure) {
      if (failure instanceof EncodeFailure) {
        if (failure.kind === "output-too-large") {
          return finish({ kind: "output-too-large", durationMs: durationMs });
        }
        return finish({
          kind: "non-serializable",
          path: failure.path,
          type: failure.type,
          durationMs: durationMs,
        });
      }
      return finish({ kind: "threw", error: errorInfo(failure), durationMs: durationMs });
    }
  };
})();
