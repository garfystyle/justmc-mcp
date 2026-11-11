const ARENA_MARGIN = 2;
const EYE_HEIGHT = 1.6;
const STRAFE_MS = 500;
const DODGE_MS = 450;
const EAT_MS = 1700;
const DRAW_BOW_MS = 1050;
const BOW_PAUSE_MS = 900;
const SCAN_RADIUS = 96;
const REPORT_EVERY_MS = 20000;
const LOST_TARGET_SCANS = 45;
const BIG_HIT = 8;
const WON_HEALTH = 30;

const settings = {
  command: args.command ?? "",
  stopCommand: args.stopCommand ?? "",
  target: args.target ?? "husk",
  mark: args.mark ?? "",
  markRadius: Number(args.markRadius ?? 3),
  seconds: Number(args.seconds ?? 300),
  introMs: Number(args.introMs ?? 0),
  centerX: Number(args.centerX ?? 0.5),
  centerZ: Number(args.centerZ ?? 0.5),
  arenaRadius: Number(args.arenaRadius ?? 28),
  keepDistance: Number(args.keepDistance ?? 17),
  aimHeight: Number(args.aimHeight ?? 1),
  bowSlot: Number(args.bowSlot ?? 1),
  foodSlot: Number(args.foodSlot ?? 3),
  eatBelow: Number(args.eatBelow ?? 9),
};

const nearest = async (query) => {
  const { entities } = await game.scene({ ...query, radius: SCAN_RADIUS, limit: 40 });
  return entities;
};

const dangerNear = (player, marks) => {
  let closest = null;
  for (const mark of marks) {
    const distance = Math.hypot(player.x - mark.x, player.z - mark.z);
    if (distance < settings.markRadius + 1.2 && (!closest || distance < closest.distance)) closest = { ...mark, distance };
  }
  return closest;
};

const lookAlong = (player, dx, dz) => game.look({ x: player.x + dx * 10, y: player.y + EYE_HEIGHT, z: player.z + dz * 10 });

const report = { won: false, deaths: 0, dodges: 0, meals: 0, shots: 0, hits: [], lowestHealth: 20 };
const started = Date.now();
const limit = settings.seconds * 1000;

async function dodge(player, danger) {
  const awayX = player.x - danger.x || 0.3;
  const awayZ = player.z - danger.z || 0.3;
  const length = Math.hypot(awayX, awayZ);
  await lookAlong(player, awayX / length, awayZ / length);
  await game.hold(["forward", "sprint"], DODGE_MS);
  report.dodges++;
}

async function eat() {
  await game.setHotbar(settings.foodSlot);
  await game.holdUse(EAT_MS);
  await game.setHotbar(settings.bowSlot);
  report.meals++;
}

async function shoot(target) {
  await game.look({ x: target.x, y: target.y + settings.aimHeight, z: target.z });
  await game.holdUse(DRAW_BOW_MS);
  report.shots++;
}

async function circle(player, target, side) {
  const toPlayerX = player.x - target.x;
  const toPlayerZ = player.z - target.z;
  const distance = Math.max(Math.hypot(toPlayerX, toPlayerZ), 0.5);
  const pull = (settings.keepDistance - distance) / 5;
  let moveX = (-toPlayerZ / distance) * side + (toPlayerX / distance) * pull;
  let moveZ = (toPlayerX / distance) * side + (toPlayerZ / distance) * pull;
  const fromCenter = Math.hypot(player.x - settings.centerX, player.z - settings.centerZ);
  if (fromCenter > settings.arenaRadius - ARENA_MARGIN) {
    moveX -= ((player.x - settings.centerX) / fromCenter) * 1.6;
    moveZ -= ((player.z - settings.centerZ) / fromCenter) * 1.6;
  }
  await lookAlong(player, moveX, moveZ);
  await game.hold(["forward", "sprint", "jump"], STRAFE_MS);
}

await game.setHotbar(settings.bowSlot);
if (settings.command) await game.say(settings.command);
if (settings.introMs) await game.sleep(settings.introMs);

let previous = await game.state();
let seenTarget = false;
let lostScans = 0;
let side = 1;
let nextShotAt = 0;
let nextReportAt = 0;

while (Date.now() - started < limit) {
  const player = await game.state();
  const [target] = await nearest({ type: settings.target });
  const marks = settings.mark ? await nearest({ name: settings.mark }) : [];

  if (player.health < previous.health - 0.4) report.hits.push(Math.round((previous.health - player.health) * 10) / 10);
  if (Math.hypot(player.x - previous.x, player.z - previous.z) > 12 && previous.health < 12) report.deaths++;
  report.lowestHealth = Math.min(report.lowestHealth, player.health);
  previous = player;

  if (!target) {
    lostScans++;
    if (seenTarget && lostScans > LOST_TARGET_SCANS) {
      report.won = report.targetHealth !== undefined && report.targetHealth <= WON_HEALTH;
      report.lostTarget = !report.won;
      break;
    }
    await game.sleep(400);
    continue;
  }
  seenTarget = true;
  lostScans = 0;
  report.targetHealth = target.health;

  if (Date.now() > nextReportAt) {
    nextReportAt = Date.now() + REPORT_EVERY_MS;
    log(`${Math.round((Date.now() - started) / 1000)} с: цель ${Math.round(target.health ?? 0)}, игрок ${player.health.toFixed(1)}, смертей ${report.deaths}`);
  }

  const danger = dangerNear(player, marks);
  const distance = Math.hypot(player.x - target.x, player.z - target.z);
  if (danger) {
    await dodge(player, danger);
  } else if (player.health <= settings.eatBelow && report.meals < 12) {
    await eat();
  } else if (distance > 12 && distance < 24 && Date.now() > nextShotAt) {
    await shoot(target);
    nextShotAt = Date.now() + BOW_PAUSE_MS;
  } else {
    if (Math.random() < 0.05) side = -side;
    await circle(player, target, side);
  }
}

if (!report.won && settings.stopCommand) await game.say(settings.stopCommand);
return {
  ...report,
  seconds: Math.round((Date.now() - started) / 1000),
  hitCount: report.hits.length,
  bigHits: report.hits.filter((hit) => hit >= BIG_HIT).length,
  hardestHit: Math.max(0, ...report.hits),
  hits: undefined,
};
