/// <reference types="node" />
import { createHash } from "node:crypto";

// Node-only helpers for keeping public/runner.html's CSP hash in sync with its inline script.

const INLINE_SCRIPT = /<script>([\s\S]*?)<\/script>/;
const SCRIPT_HASH = /'sha256-([^']*)'/;

export const inlineScriptOf = (html: string): string => {
  const match = INLINE_SCRIPT.exec(html);
  if (match?.[1] === undefined) throw new Error("runner.html has no inline <script>");
  return match[1];
};

export const hashOf = (script: string): string =>
  createHash("sha256").update(script, "utf8").digest("base64");

export const declaredHashOf = (html: string): string | undefined => SCRIPT_HASH.exec(html)?.[1];

export const withUpdatedHash = (html: string): string =>
  html.replace(SCRIPT_HASH, `'sha256-${hashOf(inlineScriptOf(html))}'`);
