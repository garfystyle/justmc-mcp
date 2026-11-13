import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_FILE, AGENT_HOME, AGENT_JAR, LINK_FILE } from "../paths.mjs";

const BRIDGE = process.env.MCEXEC_BRIDGE || "http://127.0.0.1:16385";
const PING_MS = 4000;
const CALL_MS = 12000;
const LOAD_MS = 30000;
const NO_GAME = "игра не отвечает: запусти Minecraft с XeroCode 1.8.2 или новее и пройди главное меню";

export class GameError extends Error {}

async function bridgeExec(code, timeoutMs = 8000) {
  let response;
  try {
    response = await fetch(`${BRIDGE}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, onClientThread: true, timeoutMs }),
      signal: AbortSignal.timeout(timeoutMs + 10000),
    });
  } catch (e) {
    throw new GameError(`${NO_GAME} (${e.cause?.message ?? e.message})`);
  }
  const r = JSON.parse(await response.text());
  if (!r.ok) throw new GameError(`мост mcexec: ${String(r.error ?? "").split(/\r?\n/).slice(0, 6).join("\n")}`);
  return r.result;
}

export async function bridgePing() {
  try {
    const response = await fetch(`${BRIDGE}/ping`, { signal: AbortSignal.timeout(PING_MS) });
    return JSON.parse(await response.text());
  } catch (e) {
    return { ok: false, error: e.cause?.message ?? e.message };
  }
}

let session = null;

async function raw(s, method, path, body, timeoutMs) {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${s.port}${path}`, {
      method,
      headers: { "X-Agent-Token": s.token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new GameError(`агент не отвечает: ${e.cause?.message ?? e.message}`);
  }
  return JSON.parse(await response.text());
}

const jarHash = () => createHash("sha1").update(readFileSync(AGENT_JAR)).digest("hex").slice(0, 12);

function readSaved() {
  if (!existsSync(AGENT_FILE)) return null;
  try {
    return JSON.parse(readFileSync(AGENT_FILE, "utf8"));
  } catch {
    return null;
  }
}

function sweepOldJars(keep) {
  for (const name of readdirSync(AGENT_HOME)) {
    if (name.startsWith("agent-") && name.endsWith(".jar") && name !== keep) rmSync(join(AGENT_HOME, name), { force: true });
  }
}

async function viaXeroCode(jar, work, token) {
  if (!existsSync(LINK_FILE)) return null;
  let link;
  try {
    link = JSON.parse(readFileSync(LINK_FILE, "utf8"));
  } catch {
    return null;
  }
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${link.port}/agent`, {
      method: "POST",
      headers: { "X-Xero-Token": link.token, "Content-Type": "application/json" },
      body: JSON.stringify({ jar, work, token }),
      signal: AbortSignal.timeout(LOAD_MS),
    });
  } catch {
    return null;
  }
  if (response.status === 404) return null;
  const r = JSON.parse(await response.text());
  if (!r.ok) throw new GameError(`XeroCode: ${r.error ?? response.status}`);
  return r;
}

async function viaBridge(jar, work, token) {
  return JSON.parse(await bridgeExec(`
java.net.URL[] __u = new java.net.URL[]{ new java.io.File("${jar}").toURI().toURL() };
java.net.URLClassLoader __cl = new java.net.URLClassLoader(__u, com.mcexec.McExec.class.getClassLoader());
Class __c = __cl.loadClass("justmc.agent.Agent");
__c.getMethod("start", new Class[]{String.class, String.class}).invoke(null, new Object[]{"${work}", "${token}"});
`, 15000));
}

async function inject(hash) {
  if (!existsSync(AGENT_JAR)) throw new GameError(`нет ${AGENT_JAR}: собери агента (npm run agent)`);
  mkdirSync(AGENT_HOME, { recursive: true });
  const jarName = `agent-${hash}-${Date.now()}.jar`;
  const jar = join(AGENT_HOME, jarName);
  copyFileSync(AGENT_JAR, jar);
  const token = randomBytes(24).toString("hex");
  const path = jar.replaceAll("\\", "/");
  const work = join(AGENT_HOME, "work").replaceAll("\\", "/");
  const { port, version } = (await viaXeroCode(path, work, token)) ?? (await viaBridge(path, work, token));
  const saved = { port, token, version, hash };
  writeFileSync(AGENT_FILE, JSON.stringify(saved));
  try {
    sweepOldJars(jarName);
  } catch {
    return saved;
  }
  return saved;
}

export async function connect({ fresh = false } = {}) {
  const hash = jarHash();
  if (session && !fresh) {
    const alive = await raw(session, "GET", "/ping", undefined, PING_MS).catch(() => null);
    if (alive?.ok) return session;
    session = null;
  }
  const saved = readSaved();
  if (saved) {
    const alive = await raw(saved, "GET", "/ping", undefined, PING_MS).catch(() => null);
    if (alive?.ok && saved.hash === hash && !fresh) {
      session = saved;
      return session;
    }
    if (alive?.ok) await raw(saved, "POST", "/stop", {}, PING_MS).catch(() => {});
  }
  session = await inject(hash);
  return session;
}

export async function call(method, path, body, timeoutMs = CALL_MS) {
  const s = await connect();
  const r = await raw(s, method, path, body, timeoutMs);
  if (!r.ok) throw new GameError(String(r.error ?? "ошибка агента").split(/\r?\n/).slice(0, 8).join("\n"));
  return r.result;
}

export const connected = () => session !== null;

export const get = (path, timeoutMs) => call("GET", path, undefined, timeoutMs);
export const post = (path, body = {}, timeoutMs) => call("POST", path, body, timeoutMs);
export const ping = () => get("/ping", PING_MS);
export const firstLines = (text, count = 8) => String(text ?? "").split(/\r?\n/).slice(0, count).join("\n");
