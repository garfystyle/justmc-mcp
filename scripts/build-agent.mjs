import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, VENDOR } from "../src/paths.mjs";

const JDK = process.env.JDK25 ?? "C:/Program Files/Eclipse Adoptium/jdk-25.0.2.10-hotspot";
const JCODE = process.env.JCODE ?? join(ROOT, "..", "justmc", "jcode");
const SOURCE = join(ROOT, "agent", "src");
const CLASSES = join(ROOT, "agent", "build", "classes");
const GRADLE_CACHE = join(homedir(), ".gradle", "caches", "modules-2", "files-2.1", "org.apache-extras.beanshell", "bsh");
const CP_CACHE = join(ROOT, "agent", "build", "classpath.txt");

const findBsh = () => {
  if (!existsSync(GRADLE_CACHE)) return null;
  const walk = (at) => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, e.name);
      if (e.isDirectory()) {
        const hit = walk(path);
        if (hit) return hit;
      } else if (e.name.endsWith(".jar") && !e.name.endsWith("-sources.jar")) {
        return path;
      }
    }
    return null;
  };
  return walk(GRADLE_CACHE);
};

const bsh = findBsh();

const classpath = () => {
  if (existsSync(CP_CACHE) && !process.argv.includes("--fresh-classpath")) {
    return readFileSync(CP_CACHE, "utf8").split(";").filter((entry) => entry !== bsh).join(";");
  }
  const wrapper = join(JCODE, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  const out = execFileSync(wrapper, ["printCp", "--offline", "-q"], { cwd: JCODE, encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "ignore"] });
  return out.trim().split(/\r?\n/).pop();
};

const sources = readdirSync(join(SOURCE, "justmc", "agent")).filter((f) => f.endsWith(".java")).map((f) => join(SOURCE, "justmc", "agent", f));
rmSync(CLASSES, { recursive: true, force: true });
mkdirSync(CLASSES, { recursive: true });
if (!bsh) {
  console.error("нет bsh-2.0b6.jar в кэше Gradle: собери mc-executor один раз");
  process.exit(1);
}
const cp = `${classpath()};${bsh}`;
writeFileSync(CP_CACHE, cp);
const args = join(tmpdir(), `justmc-agent-${process.pid}.args`);
writeFileSync(args, [`-cp`, `"${cp.replaceAll("\\", "/")}"`, `-proc:none`, `-nowarn`, `-encoding`, `UTF-8`, `-d`, `"${CLASSES.replaceAll("\\", "/")}"`, ...sources.map((s) => `"${s.replaceAll("\\", "/")}"`)].join("\n"));
try {
  execFileSync(join(JDK, "bin", "javac"), [`@${args}`], { stdio: "inherit" });
} finally {
  rmSync(args, { force: true });
}
execFileSync(join(JDK, "bin", "jar"), ["xf", bsh], { cwd: CLASSES, stdio: "inherit" });
for (const name of readdirSync(join(CLASSES, "META-INF"))) {
  if (/^(MANIFEST\.MF|.*\.(SF|RSA|DSA))$/i.test(name)) rmSync(join(CLASSES, "META-INF", name), { force: true });
}
mkdirSync(VENDOR, { recursive: true });
execFileSync(join(JDK, "bin", "jar"), ["--create", "--file", join(VENDOR, "agent.jar"), "-C", CLASSES, "."], { stdio: "inherit" });
console.log(`агент собран: ${join(VENDOR, "agent.jar")}`);
