const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "..", "tts-gateway", "dist");
const dest = path.join(__dirname, "..", "dist", "gateway");

const copyRecursive = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const fromPath = path.join(from, entry.name);
    const toPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(fromPath, toPath);
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".js.map")) {
      fs.copyFileSync(fromPath, toPath);
    }
  }
};

if (!fs.existsSync(src)) {
  console.error(`Gateway dist missing at ${src}. Run npm run build --prefix packages/tts-gateway first.`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
copyRecursive(src, dest);
console.log(`Copied gateway helper to ${dest}`);
