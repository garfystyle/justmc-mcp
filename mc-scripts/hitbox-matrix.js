const variants = args.variants ?? ["plain", "potion", "flag", "silent", "drops", "scale"];
const watch = await game.Watch.start({ local: true });
const out = {};
for (const variant of variants) {
  await game.say("@t d " + variant);
  await game.sleep(1700);
  const name = "dummy_" + variant;
  const hit = await game.java(`
    var result = "not found";
    for (var e : mc.level.entitiesForRendering()) {
      var label = e.getCustomName() == null ? "" : e.getCustomName().getString();
      if (label.equals("${name}")) {
        mc.gameMode.attack(mc.player, e);
        mc.player.swing(net.minecraft.world.InteractionHand.MAIN_HAND);
        result = "attacked d=" + mc.player.distanceTo(e);
      }
    }
    result;`);
  await game.sleep(700);
  await watch.poll();
  const got = watch.all.filter((e) => e.type === "chat" && String(e.text ?? "").includes("name=" + name)).length;
  out[variant] = { hit, damageEvents: got };
}
return out;
