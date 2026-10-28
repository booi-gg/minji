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

  function ListNode(val, next) {
    this.val = val === undefined ? 0 : val;
    this.next = next === undefined ? null : next;
  }
  function TreeNode(val, left, right) {
    this.val = val === undefined ? 0 : val;
    this.left = left === undefined ? null : left;
    this.right = right === undefined ? null : right;
  }
  globalThis.ListNode = ListNode;
  globalThis.TreeNode = TreeNode;

  var MAX_NODES = 100000;

  var userListNode = ListNode;
  var userTreeNode = TreeNode;

  function fromList(values) {
    if (!isArray(values)) throw new TypeError("Linked-list input must be a JSON array");
    if (values.length > MAX_NODES) throw new RangeError("Linked list exceeds node limit");
    var head = null;
    for (var i = values.length - 1; i >= 0; i -= 1) {
      var next = head;
      head = new userListNode(values[i], next);
      head.val = values[i];
      head.next = next;
    }
    return head;
  }

  function fromTree(values) {
    if (!isArray(values)) throw new TypeError("Binary-tree input must be a JSON array");
    if (values.length > MAX_NODES) throw new RangeError("Binary tree exceeds node limit");
    if (values.length === 0) return null;
    if (values[0] === null)
      throw new TypeError("Binary-tree root cannot be null in a nonempty array");
    var root = new userTreeNode(values[0]);
    root.val = values[0];
    var queue = [root];
    var cursor = 0;
    var index = 1;
    while (cursor < queue.length && index < values.length) {
      var parent = queue[cursor++];
      if (values[index] !== null) {
        parent.left = new userTreeNode(values[index]);
        parent.left.val = values[index];
        queue.push(parent.left);
      }
      index += 1;
      if (index < values.length && values[index] !== null) {
        parent.right = new userTreeNode(values[index]);
        parent.right.val = values[index];
        queue.push(parent.right);
      }
      index += 1;
    }
    if (index !== values.length) throw new TypeError("Binary-tree input has unreachable nodes");
    return root;
  }

  function toList(head) {
    var values = [];
    var seen = new Set();
    while (head !== null) {
      if (typeof head !== "object" || seen.has(head))
        throw new TypeError("Invalid or cyclic linked list");
      seen.add(head);
      if (values.length >= MAX_NODES) throw new RangeError("Linked list exceeds node limit");
      values.push(head.val);
      head = head.next;
    }
    return values;
  }

  function toTree(root) {
    if (root === null) return [];
    var values = [];
    var queue = [root];
    var seen = new Set();
    for (var cursor = 0; cursor < queue.length; cursor += 1) {
      var node = queue[cursor];
      if (node === null) {
        values.push(null);
        continue;
      }
      if (typeof node !== "object" || seen.has(node))
        throw new TypeError("Invalid or cyclic binary tree");
      seen.add(node);
      if (seen.size > MAX_NODES) throw new RangeError("Binary tree exceeds node limit");
      values.push(node.val);
      queue.push(node.left === undefined ? null : node.left);
      queue.push(node.right === undefined ? null : node.right);
    }
    while (values.length > 0 && values[values.length - 1] === null) values.pop();
    return values;
  }

  function adaptInput(value, adapter) {
    if (adapter === "linked-list") return fromList(value);
    if (adapter === "binary-tree") return fromTree(value);
    return value;
  }

  function adaptOutput(value, adapter) {
    if (adapter === "linked-list") return toList(value);
    if (adapter === "binary-tree") return toTree(value);
    return value;
  }

  function runClass(ClassType, sequence) {
    if (!isArray(sequence) || !isArray(sequence[0]) || !isArray(sequence[1]))
      throw new TypeError("Class test needs [method names, argument arrays]");
    var methods = sequence[0];
    var inputs = sequence[1];
    if (methods.length === 0 || methods.length !== inputs.length)
      throw new TypeError("Class test methods and arguments must have equal lengths");
    if (!isArray(inputs[0])) throw new TypeError("Constructor arguments must be an array");
    var instance = new ClassType(...inputs[0]);
    var output = [null];
    for (var i = 1; i < methods.length; i += 1) {
      var name = methods[i];
      if (
        typeof name !== "string" ||
        name === "constructor" ||
        name === "__proto__" ||
        name === "prototype" ||
        !IDENTIFIER.test(name)
      )
        throw new TypeError("Invalid method at step " + i);
      if (!isArray(inputs[i])) throw new TypeError("Arguments for step " + i + " must be an array");
      var method = instance[name];
      if (typeof method !== "function")
        throw new TypeError("Method " + name + " is missing at step " + i);
      var result = method.apply(instance, inputs[i]);
      output.push(result === undefined ? null : result);
    }
    return output;
  }

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
      var loaded = load(exportsObject, { exports: exportsObject }, requireShim);
      fn = loaded.callable;
      userListNode = loaded.listNode || ListNode;
      userTreeNode = loaded.treeNode || TreeNode;
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
      if (config.kind === "class") {
        returned = runClass(fn, args);
      } else {
        for (var i = 0; i < args.length; i += 1)
          args[i] = adaptInput(args[i], config.inputAdapters && config.inputAdapters[i]);
        returned = fn.apply(undefined, args);
      }
    } catch (error) {
      return finish({ kind: "threw", error: errorInfo(error), durationMs: now() - start });
    }
    var durationMs = now() - start;

    var target =
      config.kind !== "class" && config.captureIndex >= 0 ? args[config.captureIndex] : returned;
    try {
      if (config.kind !== "class") target = adaptOutput(target, config.outputAdapter);
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
