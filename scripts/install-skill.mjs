import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GUIDE, ROOT } from "../src/paths.mjs";

const SOURCE = join(ROOT, "skill");
const TARGET = process.argv[2] ?? join(homedir(), ".claude", "skills", "justmc");

if (!existsSync(join(SOURCE, "SKILL.md"))) {
  console.error(`нет ${join(SOURCE, "SKILL.md")}`);
  process.exit(1);
}
rmSync(TARGET, { recursive: true, force: true });
mkdirSync(join(TARGET, "references"), { recursive: true });
cpSync(join(SOURCE, "SKILL.md"), join(TARGET, "SKILL.md"));
const topics = readdirSync(GUIDE).filter((f) => f.endsWith(".md"));
const withContents = (text) => {
  const headings = [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => `- ${m[1].trim()}`);
  const firstLineEnd = text.indexOf("\n") + 1;
  return `${text.slice(0, firstLineEnd)}\nСодержание:\n${headings.join("\n")}\n${text.slice(firstLineEnd)}`;
};
for (const f of topics) writeFileSync(join(TARGET, "references", f), withContents(readFileSync(join(GUIDE, f), "utf8")));
console.log(`скилл установлен: ${TARGET}, тем ${topics.length}`);
