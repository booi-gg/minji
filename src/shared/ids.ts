const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// ES reserved words plus the strict-mode and literal names that can't name a function.
const RESERVED_WORDS = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "arguments",
  "eval",
]);

/** True when `name` can be used as a function name and safely interpolated into harness code. */
export const isValidIdentifier = (name: string): boolean =>
  IDENTIFIER.test(name) && !RESERVED_WORDS.has(name);

export const newId = (): string => crypto.randomUUID();
