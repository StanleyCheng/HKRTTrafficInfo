// Opt-in static export build for GitHub Pages. Dynamic route handlers under
// app/api are incompatible with `next build` when output: 'export', so they
// are moved aside for the duration of the build and always restored.
// Copy+delete is used instead of rename because OneDrive on Windows denies
// directory renames (EPERM).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "app", "api");
const backupDir = path.join(root, "node_modules", ".cache", `api-static-backup-${process.pid}`);
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

let apiMovedAside = false;
let manifest = new Map();
function filesUnder(directory, relative = "") {
  return fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`API backup refuses symlink: ${name}`);
    return entry.isDirectory() ? filesUnder(directory, name) : [name];
  });
}
function digest(filename) { return createHash("sha256").update(fs.readFileSync(filename)).digest("hex"); }
function assertWorkspacePath(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(root + path.sep)) throw new Error(`Refusing filesystem operation outside workspace: ${resolved}`);
}
function assertStaticTypeScope() {
  // Next's standard production config stays strict and includes route tests.
  // Static export omits API routes, so route tests and dev-only generated
  // validators must not re-import the handlers while they are moved aside.
  const filename = path.join(root, "tsconfig.static.json");
  const read = ts.readConfigFile(filename, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const config = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, filename);
  if (config.errors.length) throw new Error(config.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  const files = config.fileNames.map((name) => path.relative(root, name).replaceAll("\\", "/"));
  if (!config.options.strict) throw new Error("Static export must retain strict TypeScript checks");
  if (files.some((name) => /^(tests|app\/api|\.next\/dev)\//.test(name))) throw new Error("Static type scope includes omitted routes, route tests, or dev validators");
  for (const required of ["app/page.tsx", "lib/approaches.ts"]) {
    if (!files.includes(required)) throw new Error(`Static type scope omits application source: ${required}`);
  }
  console.log("[build-static] strict application TypeScript scope verified");
}
function restoreApi() {
  if (!apiMovedAside) return;
  fs.cpSync(backupDir, apiDir, { recursive: true });
  for (const [name, hash] of manifest) {
    if (digest(path.join(apiDir, name)) !== hash) throw new Error(`API restore verification failed: ${name}; backup kept at ${backupDir}`);
  }
  apiMovedAside = false;
  assertWorkspacePath(backupDir);
  fs.rmSync(backupDir, { recursive: true, force: true });
  console.log(`[build-static] restored and verified ${manifest.size} API files`);
}

process.on("exit", restoreApi);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    restoreApi();
    process.exit(130);
  });
}

try {
  assertStaticTypeScope();
  if (fs.existsSync(apiDir)) {
    if (fs.existsSync(backupDir)) throw new Error(`Backup already exists: ${backupDir}`);
    manifest = new Map(filesUnder(apiDir).map((name) => [name, digest(path.join(apiDir, name))]));
    fs.cpSync(apiDir, backupDir, { recursive: true });
    apiMovedAside = true;
    assertWorkspacePath(apiDir);
    fs.rmSync(apiDir, { recursive: true });
    console.log("[build-static] moved app/api aside; running next build (STATIC_EXPORT=1)");
  } else {
    console.log("[build-static] no app/api directory; running next build (STATIC_EXPORT=1)");
  }

  const result = process.argv.includes("--check-routes") ? { status: 0 } : spawnSync(process.execPath, [nextBin, "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, STATIC_EXPORT: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  restoreApi();
}

if (process.exitCode) throw new Error(`[build-static] next build failed with exit code ${process.exitCode}`);
console.log(process.argv.includes("--check-routes") ? "[build-static] API move/restore check passed" : `[build-static] static export written to ${path.join(root, "out")}`);
