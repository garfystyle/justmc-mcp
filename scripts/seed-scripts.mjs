import { save } from "../src/game/scripts.mjs";

const JS = String.raw;

const library = [
  {
    name: "patrol",
    kind: "js",
    description: "Обойти точки по кругу: args.points [[x,y,z],…], args.rounds, args.sprint",
    code: JS`const points = args.points ?? [];
if (!points.length) throw new Error("нужен args.points");
const rounds = args.rounds ?? 1;
for (let r = 0; r < rounds; r++) {
  for (const [x, y, z] of points) {
    const done = await game.walk({ x, y, z, sprint: Boolean(args.sprint), timeoutMs: 60000 });
    log(done.arrived ? "дошёл" : "не дошёл: " + done.outcome, x, y, z);
    if (!done.arrived) return { stopped: [x, y, z], outcome: done.outcome };
  }
}
return { rounds };`,
  },
  {
    name: "watch-hud",
    kind: "js",
    description: "Следить за экшенбаром, тайтлами, боссбаром и чатом: args.seconds, args.types",
    code: JS`const types = args.types ?? ["actionbar", "title", "subtitle", "bossbar", "chat"];
const seconds = args.seconds ?? 10;
const watch = await game.Watch.start({ local: true });
const end = Date.now() + seconds * 1000;
while (Date.now() < end) {
  await game.sleep(250);
  await watch.poll();
}
const seen = watch.all.filter((e) => types.includes(e.type)).map((e) => e.type + ": " + (e.text ?? e.op ?? ""));
for (const line of seen.slice(-120)) log(line);
return watch.summary();`,
  },
  {
    name: "turntable",
    kind: "js",
    description: "Снимки модели по кругу с описанием всех визуализаторов рядом: args.x,y,z, args.radius, args.views",
    code: JS`const here = await game.state();
const x = args.x ?? here.x;
const y = args.y ?? here.y + 1;
const z = args.z ?? here.z;
const found = await game.scene({ displays: true, x, y, z, radius: args.scan ?? 12, limit: 200 });
log("визуализаторов:", found.total);
const shots = await game.screenshots({ downscale: 2, orbit: { x, y, z, radius: args.radius ?? 6, height: args.height ?? 2, views: args.views ?? 4 }, timeoutMs: 30000 });
return { displays: found.total, shots: shots.length, entities: found.entities.map((e) => ({ type: e.type, x: e.x, y: e.y, z: e.z, scale: e.display.scale, translation: e.display.translation })) };`,
  },
  {
    name: "held-item",
    kind: "java",
    description: "Все компоненты предмета в руке",
    code: JS`Object s = mc.player.getMainHandItem();
p(s.getItem().toString());
p(s.getHoverName().getString());
Object it = s.getComponents().iterator();
while (it.hasNext()) p(it.next());
"готово";`,
  },
  {
    name: "looking-at",
    kind: "java",
    description: "Что под прицелом: блок со свойствами или сущность",
    code: JS`Object h = mc.hitResult;
if (h == null) return "ничего";
String t = h.getType().toString();
if (t.equals("BLOCK")) {
  Object at = h.getBlockPos();
  Object state = mc.level.getBlockState(at);
  p(at.toString());
  p(state.toString());
  Object be = mc.level.getBlockEntity(at);
  if (be != null) p(be.getClass().getSimpleName());
} else if (t.equals("ENTITY")) {
  Object e = h.getEntity();
  p(e.getType().toString());
  p(e.getName().getString());
  p(e.getUUID().toString());
}
t;`,
  },
];

for (const script of library) console.log(save(script));
