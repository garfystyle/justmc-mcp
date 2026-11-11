const types = args.types ?? ["actionbar", "title", "subtitle", "bossbar", "chat"];
const seconds = args.seconds ?? 10;
const watch = await game.Watch.start({ local: true });
const end = Date.now() + seconds * 1000;
while (Date.now() < end) {
  await game.sleep(250);
  await watch.poll();
}
const seen = watch.all.filter((e) => types.includes(e.type)).map((e) => e.type + ": " + (e.text ?? e.op ?? ""));
for (const line of seen.slice(-120)) log(line);
return watch.summary();