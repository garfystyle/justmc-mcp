import * as player from "./player.mjs";
import { REPLY } from "./replies.mjs";

const MODE_WAIT = 25000;
const COMMAND_TRIES = 4;
const REBUILD_PAUSE = 1500;
const RESPAWN_PAUSE = 1200;

async function playerCondition() {
  const s = await player.state().catch(() => null);
  if (!s?.inWorld) return "игрока нет в мире";
  const dead = s.health <= 0 || s.screen === "DeathScreen";
  return `${dead ? "игрок мёртв, " : ""}режим ${s.mode}, здоровье ${s.health}, окно ${s.screen ?? "нет"}`;
}

export async function switchMode(wanted) {
  const s = await player.state();
  if (!s?.inWorld) throw new Error("игрока нет в мире");
  if (s.mode === wanted) return;
  if (await player.respawn().catch(() => false)) await player.sleep(RESPAWN_PAUSE);
  await player.send(wanted === "play" ? "/play" : "/dev");
  const end = Date.now() + MODE_WAIT;
  while (Date.now() < end) {
    await player.sleep(300);
    const now = await player.state().catch(() => null);
    if (now?.inWorld && now.mode === wanted) return;
  }
  throw new Error(`режим ${wanted} не включился за ${MODE_WAIT / 1000} с: ${await playerCondition()}`);
}

export const toDev = () => switchMode("dev");

const inWorldMode = async (test) => {
  const s = await player.state().catch(() => null);
  return Boolean(s?.inWorld && s.mode === "play" && test(s));
};
const isCreative = (s) => /creative/i.test(s.gamemode ?? "");
export const inBuildMode = () => inWorldMode(isCreative);
const inPlayMode = () => inWorldMode((s) => !isCreative(s));

async function command(text, answer, reached) {
  const watch = await player.Watch.start({ local: false });
  for (let attempt = 0; attempt < COMMAND_TRIES; attempt++) {
    await player.send(text);
    const end = Date.now() + MODE_WAIT;
    let refused = false;
    while (Date.now() < end && !refused) {
      await player.sleep(250);
      const fresh = await watch.poll().catch(() => []);
      if (fresh.some((line) => answer.test(line))) return;
      if (await reached()) return;
      refused = fresh.some((line) => REPLY.slowDown.test(line));
    }
    if (!refused) break;
  }
  throw new Error(`на ${text} сервер не ответил как ждали: ${await playerCondition()}`);
}

export async function restartWorld() {
  await command("/build", REPLY.buildMode, inBuildMode);
  await player.sleep(REBUILD_PAUSE);
  await command("/play", REPLY.playMode, inPlayMode);
  await switchMode("play");
}
