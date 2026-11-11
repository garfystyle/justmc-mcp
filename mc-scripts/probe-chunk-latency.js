const radius = args.radius || 6;
const target = args.target || "-190 160";
const probe = `
var pl = mc.player;
int cx = pl.blockPosition().getX() >> 4;
int cz = pl.blockPosition().getZ() >> 4;
int have = 0;
for (int dx = -${radius}; dx <= ${radius}; dx++) {
  for (int dz = -${radius}; dz <= ${radius}; dz++) {
    var c = mc.level.getChunkSource().getChunk(cx + dx, cz + dz, net.minecraft.world.level.chunk.status.ChunkStatus.FULL, false);
    if (c != null) { have++; }
  }
}
pl.blockPosition().getX() + " " + have;
`;
const start = Date.now();
game.say("@c go " + target);
const samples = [];
for (let i = 0; i < 80; i++) {
  const r = await game.java(probe);
  samples.push((Date.now() - start) + "ms " + JSON.stringify(r));
  await game.sleep(40);
}
log(samples.join("\n"));
return samples.length;
