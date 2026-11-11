import { copyFileSync, cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { REFERENCE, VENDOR, XERO_SOURCE } from "../src/paths.mjs";

const bundle = join(XERO_SOURCE, "js", "build", "dist", "xero.js");
if (!existsSync(bundle)) {
  console.error(`нет ${bundle}: собери ядро (./gradlew :js:bundle в ${XERO_SOURCE})`);
  process.exit(1);
}
mkdirSync(VENDOR, { recursive: true });
mkdirSync(REFERENCE, { recursive: true });
copyFileSync(bundle, join(VENDOR, "xero.cjs"));
cpSync(join(XERO_SOURCE, "docs"), REFERENCE, { recursive: true });
copyFileSync(join(XERO_SOURCE, "README.md"), join(REFERENCE, "README.md"));
console.log(`ядро ${(statSync(bundle).size / 1048576).toFixed(1)} МБ и справочник обновлены, теперь npm run learn`);
