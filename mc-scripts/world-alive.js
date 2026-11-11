const tries = args.tries || 4;
const snap = `var p = mc.player.blockPosition(); int cx = p.getX() >> 4; int cz = p.getZ() >> 4; int have = 0; for (int dx = -6; dx <= 6; dx++) { for (int dz = -6; dz <= 6; dz++) { if (mc.level.getChunkSource().getChunk(cx + dx, cz + dz, net.minecraft.world.level.chunk.status.ChunkStatus.FULL, false) != null) have++; } } var hud = mc.gui.hud.getChat(); var f = net.minecraft.client.gui.components.ChatComponent.class.getDeclaredField("allMessages"); f.setAccessible(true); var all = f.get(hud); String last = ""; for (int i = 0; i < 12 && i < all.size(); i++) { var s = all.get(i).content().getString().trim(); if (!s.startsWith("[!]") && !s.startsWith("⏵")) { last = s; break; } } have + "/169 last=" + last.substring(0, Math.min(70, last.length()));`;
for (let i = 0; i < tries; i++) {
  await game.say("/world limit profile");
  await game.sleep(5000);
  log(String(await game.java(snap)));
}
return "ok";
