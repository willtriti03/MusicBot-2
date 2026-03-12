import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const srcRoot = path.join(projectRoot, "src");
const distRoot = path.join(projectRoot, "dist");

function copyTree(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetName = entry.isDirectory()
      ? entry.name
      : entry.name.endsWith(".ts")
        ? `${entry.name.slice(0, -3)}.js`
        : entry.name;
    const targetPath = path.join(targetDir, targetName);

    if (entry.isDirectory()) {
      copyTree(sourcePath, targetPath);
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
  }
}

fs.rmSync(distRoot, { recursive: true, force: true });
copyTree(srcRoot, distRoot);
console.log(`Built ts-bot to ${distRoot}`);
