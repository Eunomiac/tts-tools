/**
 * Bundle the extension, the MCP server and the gateway helper into single files under dist/,
 * and collect the license text of every package that ends up inside them.
 * Run from packages/tts-editor (after the sibling packages are built): node scripts/bundle.js
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");

const entries = [
  { in: path.join(root, "src", "extension.ts"), out: path.join(dist, "extension.js") },
  { in: path.join(root, "src", "mcp", "server.ts"), out: path.join(dist, "mcp", "server.js") },
  { in: path.join(root, "..", "tts-gateway", "src", "cli.ts"), out: path.join(dist, "tts-gateway-helper", "cli.js") },
];

const licenseFilePattern = /^(licen[cs]e|copying)(\..*)?$/i;

const findPackageDir = (file) => {
  let dir = path.dirname(file);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return undefined;
};

const describePackage = (dir) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const licenseFile = fs.readdirSync(dir).find((name) => licenseFilePattern.test(name));
  const text = licenseFile
    ? fs.readFileSync(path.join(dir, licenseFile), "utf8").trim()
    : `License: ${pkg.license ?? "unknown"} (no license file in the package)`;
  return { name: pkg.name, version: pkg.version, license: pkg.license, text };
};

const writeThirdPartyLicenses = (inputs) => {
  const packages = new Map();
  for (const input of inputs) {
    const file = path.resolve(root, input);
    const dir = findPackageDir(file);
    if (!dir || dir === root) {
      continue;
    }
    const info = describePackage(dir);
    if (info.name && !packages.has(info.name)) {
      packages.set(info.name, info);
    }
  }

  const sections = [...packages.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((info) => `${info.name}@${info.version} (${info.license})\n${"-".repeat(72)}\n${info.text}\n`);
  const header =
    "Third-party software bundled into this extension's dist/ files.\n" +
    "Each package is listed with its license text.\n\n";
  fs.writeFileSync(path.join(dist, "THIRD-PARTY-LICENSES.txt"), header + sections.join("\n"));
  return packages.size;
};

/** Files that bundled libraries read from their own folder at run time, which becomes dist/. */
const runtimeAssets = [{ from: path.join(root, "node_modules", "luabundle", "bundle", "runtime.lua"), to: "runtime.lua" }];

const copyRuntimeAssets = () => {
  for (const asset of runtimeAssets) {
    fs.copyFileSync(asset.from, path.join(dist, asset.to));
  }
};

/** Fail when a bundle reads a `__dirname`-relative file that is not in dist/. */
const checkDirnameReads = (outFile) => {
  const code = fs.readFileSync(outFile, "utf8");
  for (const match of code.matchAll(/__dirname\s*,\s*["'`]([^"'`]+)["'`]/g)) {
    const target = path.resolve(path.dirname(outFile), match[1]);
    if (!fs.existsSync(target)) {
      throw new Error(`${path.relative(root, outFile)} reads ${match[1]} next to itself, but ${path.relative(root, target)} does not exist.`);
    }
  }
};

const main = async () => {
  fs.rmSync(dist, { recursive: true, force: true });

  const inputs = new Set();
  for (const entry of entries) {
    const result = await esbuild.build({
      absWorkingDir: root,
      entryPoints: [entry.in],
      outfile: entry.out,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node20",
      external: ["vscode"],
      minify: true,
      legalComments: "none",
      metafile: true,
      logLevel: "warning",
    });
    for (const input of Object.keys(result.metafile.inputs)) {
      inputs.add(input);
    }
    const size = fs.statSync(entry.out).size;
    console.log(`${path.relative(root, entry.out)}  ${(size / 1024).toFixed(0)} KB`);
  }

  copyRuntimeAssets();
  for (const entry of entries) {
    checkDirnameReads(entry.out);
  }

  const count = writeThirdPartyLicenses(inputs);
  console.log(`dist/THIRD-PARTY-LICENSES.txt  ${count} packages`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
