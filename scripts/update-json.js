import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// 从命令行参数获取版本号（GitHub Actions 传入）
const version = process.argv[2];

if (!version) {
  console.error('Error: Version number is required');
  console.error('Usage: node update-json.js <version>');
  process.exit(1);
}

// 读取 package.json 获取配置
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
const addonID = pkg.config.addonID;
const addonRef = pkg.config.addonRef;

console.log(`\n[Update JSON] Updating update.json to version ${version}...`);

// 更新 update.json
const updateJsonPath = join(rootDir, 'update.json');
const updateJson = JSON.parse(readFileSync(updateJsonPath, 'utf-8'));

updateJson.addons[addonID].updates[0] = {
  version: version,
  update_link: `https://github.com/BlueBlueKitty/zotero-ainote/releases/download/v${version}/${addonRef}.xpi`,
  applications: {
    zotero: {
      strict_min_version: "7.0.0"
    }
  }
};

writeFileSync(updateJsonPath, JSON.stringify(updateJson, null, 2) + '\n', 'utf-8');

console.log(`[Update JSON] ✓ update.json updated successfully`);
console.log(`[Update JSON] Version: ${version}`);
console.log(`[Update JSON] Download link: ${updateJson.addons[addonID].updates[0].update_link}`);
