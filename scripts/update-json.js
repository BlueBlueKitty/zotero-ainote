import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");
const logger = globalThis.console;

// 从命令行参数获取版本号（GitHub Actions 传入）
const version = process.argv[2];

if (!version) {
  logger.error("Error: Version number is required");
  logger.error("Usage: node update-json.js <version>");
  process.exit(1);
}

// 读取 package.json 获取配置
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
const addonID = pkg.config.addonID;
const addonRef = pkg.config.addonRef;
const manifest = JSON.parse(
  readFileSync(join(rootDir, "addon", "manifest.json"), "utf-8"),
);
const zoteroVersionRange = manifest.applications?.zotero ?? {};

logger.log(`\n[Update JSON] Updating update.json to version ${version}...`);

// 更新 update.json
const updateJsonPath = join(rootDir, "update.json");
const updateJson = JSON.parse(readFileSync(updateJsonPath, "utf-8"));

updateJson.addons[addonID].updates[0] = {
  version: version,
  update_link: `https://github.com/BlueBlueKitty/zotero-ainote/releases/download/v${version}/${addonRef}.xpi`,
  applications: {
    zotero: {
      ...(zoteroVersionRange.strict_min_version
        ? { strict_min_version: zoteroVersionRange.strict_min_version }
        : {}),
      ...(zoteroVersionRange.strict_max_version
        ? { strict_max_version: zoteroVersionRange.strict_max_version }
        : {}),
    },
  },
};

writeFileSync(
  updateJsonPath,
  JSON.stringify(updateJson, null, 2) + "\n",
  "utf-8",
);

logger.log(`[Update JSON] ✓ update.json updated successfully`);
logger.log(`[Update JSON] Version: ${version}`);
logger.log(
  `[Update JSON] Download link: ${updateJson.addons[addonID].updates[0].update_link}`,
);
