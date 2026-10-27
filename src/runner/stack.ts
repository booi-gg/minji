// Turns an engine stack from the sandbox Worker into frames in the user's own code.
// User code is compiled with `new Function`, whose synthesized source puts the body two
// lines down ("function anonymous(exports,module,require\n) {\n"), per the spec's
// CreateDynamicFunction; sucrase keeps the user's line numbers, so subtracting 2 maps back.

const LINES_BEFORE_BODY = 2;

export interface StackFrame {
  /** Function name, or undefined for top-level code. */
  name: string | undefined;
  line?: number;
  column?: number;
}

// V8: "    at helper (eval at self.onmessage (blob:…:350:12), <anonymous>:5:9)"
const V8_FRAME = /^\s*at (?:(\S+) )?\(?eval at .*, <anonymous>:(\d+):(\d+)\)?$/;
// SpiderMonkey: "helper@blob:… line 350 > Function:5:9"
const SPIDERMONKEY_FRAME = /^(.*?)@.* > Function:(\d+):(\d+)$/;
// JavaScriptCore gives no location for Function code: "helper@"
const JSC_FRAME = /^([^@\s]*)@$/;

const TOP_LEVEL_NAMES = new Set(["", "eval", "anonymous"]);

const frameName = (raw: string | undefined): string | undefined =>
  raw === undefined || TOP_LEVEL_NAMES.has(raw) ? undefined : raw;

const located = (name: string | undefined, line: string, column: string): StackFrame => {
  const userLine = Number(line) - LINES_BEFORE_BODY;
  return userLine >= 1
    ? { name: frameName(name), line: userLine, column: Number(column) }
    : { name: frameName(name) };
};

/** Frames in the user's code, innermost first. Harness and engine frames are dropped. */
export const userFrames = (stack: string | undefined): StackFrame[] => {
  if (stack === undefined) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const v8 = V8_FRAME.exec(line);
    if (v8 !== null) {
      frames.push(located(v8[1], v8[2] ?? "0", v8[3] ?? "0"));
      continue;
    }
    const spiderMonkey = SPIDERMONKEY_FRAME.exec(line);
    if (spiderMonkey !== null) {
      frames.push(located(spiderMonkey[1], spiderMonkey[2] ?? "0", spiderMonkey[3] ?? "0"));
      continue;
    }
    const jsc = JSC_FRAME.exec(line);
    if (jsc !== null) frames.push({ name: frameName(jsc[1]) });
  }
  return frames;
};

export const formatFrame = (frame: StackFrame): string => {
  const name = frame.name ?? "(top level)";
  return frame.line === undefined ? `at ${name}` : `at ${name} (line ${frame.line})`;
};
