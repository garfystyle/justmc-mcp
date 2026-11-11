const hits = args.hits ?? 3;
await game.say("@t near");
await game.sleep(350);
const out = [];
for (let i = 0; i < hits; i++) {
  const { entities } = await game.scene({ name: "rift_boss", radius: 40, limit: 1 });
  const target = entities[0];
  if (!target) { out.push("no target"); continue; }
  await game.look({ x: target.x, y: target.y, z: target.z });
  await game.sleep(120);
  await game.click("attack");
  out.push("swing at " + target.x.toFixed(1) + "," + target.z.toFixed(1));
  await game.sleep(600);
}
return out;
