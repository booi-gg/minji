import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const outputDirectory = join(process.cwd(), "dist/client");
const templatePath = join(process.cwd(), "public/sw.js");

const filesIn = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "_headers" || entry.name === "sw.js") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await filesIn(path)));
    else if (entry.isFile() && !entry.name.endsWith(".map")) paths.push(path);
  }
  return paths;
};

const files = (await filesIn(outputDirectory)).sort();
if (
  !files.some((path) => path.endsWith(`${sep}index.html`)) ||
  !files.some((path) => path.endsWith(`${sep}runner.html`))
)
  throw new Error("The client build is missing its app or runner shell.");

const paths = files.map((file) => {
  const path = `/${relative(outputDirectory, file).split(sep).join("/")}`;
  if (path === "/index.html") return "/";
  if (path === "/runner.html") return "/runner";
  return path;
});
const digest = createHash("sha256");
const template = await readFile(templatePath, "utf8");
digest.update(template);
digest.update(JSON.stringify(paths));
for (const file of files) {
  digest.update(relative(outputDirectory, file));
  digest.update(await readFile(file));
}
const version = digest.digest("hex").slice(0, 16);
const source = template
  .replace("__MINJI_VERSION__", version)
  .replace("__MINJI_PRECACHE__", JSON.stringify(paths));
await writeFile(join(outputDirectory, "sw.js"), source);
process.stdout.write(`Generated offline cache for ${paths.length} assets (${version}).\n`);
