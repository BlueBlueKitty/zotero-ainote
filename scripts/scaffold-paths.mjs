import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const repoRoot = path.resolve(__dirname, "..");

const legacyDevRoot = path.join(repoRoot, ".scaffold");
const zoteroAppDataRoot = path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "Zotero",
  "Zotero",
);

export function resolveDefaultZoteroProfileDir() {
  const profilesIniPath = path.join(zoteroAppDataRoot, "profiles.ini");
  if (!fs.existsSync(profilesIniPath)) {
    return undefined;
  }

  const content = fs.readFileSync(profilesIniPath, "utf8");
  const sections = content.split(/\r?\n(?=\[)/);

  for (const section of sections) {
    if (!/\bDefault=1\b/.test(section)) {
      continue;
    }

    const isRelativeMatch = section.match(/^\s*IsRelative=(.+)$/m);
    const pathMatch = section.match(/^\s*Path=(.+)$/m);
    if (!pathMatch) {
      continue;
    }

    const relative = (isRelativeMatch?.[1] ?? "1").trim() === "1";
    const profilePath = pathMatch[1].trim();
    return relative
      ? path.join(zoteroAppDataRoot, profilePath)
      : path.normalize(profilePath);
  }

  return undefined;
}

export function getScaffoldLayout(command) {
  switch (command) {
    case "serve":
      return {
        distDir: path.join(repoRoot, ".scaffold", "dev", "build"),
        profileDir: resolveDefaultZoteroProfileDir(),
        killMarkers: [
          path.join(legacyDevRoot, "profile"),
          path.join(legacyDevRoot, "data"),
          path.join(repoRoot, ".scaffold", "dev"),
        ],
      };
    case "test":
      return {
        distDir: path.join(repoRoot, ".scaffold", "test", "build"),
        profileDir: path.join(repoRoot, ".scaffold", "test", "profile"),
        dataDir: path.join(repoRoot, ".scaffold", "test", "data"),
        killMarkers: [path.join(repoRoot, ".scaffold", "test")],
      };
    case "build":
    case "release":
      return {
        distDir: path.join(repoRoot, ".scaffold", "build"),
        killMarkers: [
          path.join(repoRoot, ".scaffold", "build"),
          path.join(repoRoot, ".scaffold", "dev"),
          path.join(legacyDevRoot, "profile"),
          path.join(legacyDevRoot, "data"),
        ],
      };
    default:
      throw new Error(`Unsupported scaffold command: ${command}`);
  }
}
