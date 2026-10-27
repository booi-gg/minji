// Tries to reach things user code must not touch. Each probe reports
// "absent" (no such API), "blocked" (the call threw), or "allowed".
function probe(appOrigin) {
  const result = {};
  const attempt = (name, fn) => {
    try {
      fn();
      result[name] = "allowed";
    } catch (error) {
      result[name] = "blocked";
    }
  };
  if (typeof indexedDB === "undefined") result.indexedDB = "absent";
  else attempt("indexedDB", () => indexedDB.open("minji-probe"));
  if (typeof XMLHttpRequest === "undefined") result.syncXhr = "absent";
  else attempt("syncXhr", () => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", appOrigin + "/index.html", false);
    xhr.send();
    if (xhr.status === 0) throw new Error("no response");
  });
  if (typeof importScripts === "undefined") result.importScripts = "absent";
  else attempt("importScripts", () => importScripts(appOrigin + "/src/shared/limits.ts"));
  result.document = typeof document === "undefined" ? "absent" : "allowed";
  result.localStorage = typeof localStorage === "undefined" ? "absent" : "allowed";
  result.fetch = typeof fetch === "undefined" ? "absent" : "present";
  return result;
}
