import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GUIDE, ROOT, VENDOR } from "../paths.mjs";

const STARTED = Date.now();
const INSTALLED_SKILL = join(homedir(), ".claude", "skills", "justmc");
const SKILL_SOURCE = join(ROOT, "skill");

function newestFile(dir) {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestFile(path) : statSync(path).mtimeMs);
  }
  return newest;
}

export function staleParts() {
  const notes = [];
  if (Math.max(newestFile(join(ROOT, "src")), newestFile(VENDOR)) > STARTED) {
    notes.push("Код MCP новее запущенного процесса: работает старая версия. Перезапусти Claude Code, /clear процесс не обновляет.");
  }
  if (existsSync(INSTALLED_SKILL) && Math.max(newestFile(GUIDE), newestFile(SKILL_SOURCE)) > newestFile(INSTALLED_SKILL)) {
    notes.push("Скилл justmc старее руководства: npm run skill.");
  }
  return notes;
}
