import { existsSync, readFileSync } from "node:fs";
import { LINK_FILE } from "../paths.mjs";
import { GameError } from "./agent.mjs";

const SEND = 150_000;

async function ask(method, path, body, timeoutMs) {
  if (!existsSync(LINK_FILE)) throw new GameError("игра с XeroCode не запущена: нет ~/.xerocode/link.json");
  const { port, token } = JSON.parse(readFileSync(LINK_FILE, "utf8"));
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "X-Xero-Token": token, "Content-Type": "application/json" },
      body: body ?? undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new GameError(`XeroCode не отвечает на порту ${port}: ${e.cause?.message ?? e.message}`);
  }
  const answer = JSON.parse(await response.text());
  if (!response.ok || answer.ok === false) throw new GameError(answer.error ?? `XeroCode ответил ${response.status}`);
  return answer;
}

export const status = () => ask("GET", "/status", null, 8000);
export const upload = (module, replace) => ask("POST", `/upload?mode=${replace ? "replace" : "add"}`, module, SEND);
export const connect = (entry) => ask("POST", "/connect", JSON.stringify(entry), SEND);
export const log = (since) => ask("GET", `/log?since=${since}`, null, 8000);
