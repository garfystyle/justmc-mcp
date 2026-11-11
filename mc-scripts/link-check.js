const snap = `var p = mc.player.blockPosition(); int cx = p.getX() >> 4; int cz = p.getZ() >> 4; int have = 0; int total = 0; int r = mc.options.getEffectiveRenderDistance(); for (int dx = -r; dx <= r; dx++) { for (int dz = -r; dz <= r; dz++) { total++; if (mc.level.getChunkSource().getChunk(cx + dx, cz + dz, net.minecraft.world.level.chunk.status.ChunkStatus.FULL, false) != null) have++; } } mc.level.getGameTime() + " chunks " + have + "/" + total + " r=" + r + " pos=" + p.getX() + "," + p.getY() + "," + p.getZ() + " loaded=" + mc.level.getChunkSource().getLoadedChunksCount();`;
const a = await game.java(snap);
await game.sleep(4000);
const b = await game.java(snap);
log(String(a));
log(String(b));
return "ok";
