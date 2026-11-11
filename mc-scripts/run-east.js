const seconds = args.seconds || 80;
const yaw = args.yaw === undefined ? -90 : args.yaw;
await game.look({ yaw, pitch: 5 });
const rows = [];
const start = Date.now();
let lastX = null;
let lastZ = null;
let hot = 0;
let jumps = 0;
const probe = `var p = mc.player.blockPosition(); int d = -1; for (int i = 1; i < 60; i++) { if (!mc.level.getBlockState(p.below(i)).isAir()) { d = i; break; } } int have = 0; for (int i = 1; i <= 6; i++) { if (mc.level.getHeight(net.minecraft.world.level.levelgen.Heightmap.Types.MOTION_BLOCKING, p.getX() + i * 16, p.getZ()) > 0) have++; } d + " " + have + " " + mc.level.getBlockState(p).getBlock().getDescriptionId().replace("block.minecraft.", "") + " " + mc.level.getBlockState(p.below()).getBlock().getDescriptionId().replace("block.minecraft.", "");`;
while (Date.now() - start < seconds * 1000) {
  await game.hold(["forward", "sprint", "jump"], 400);
  const s = await game.state();
  if (s.health <= 0) { rows.push("умер"); break; }
  const moved = lastX !== null && (Math.abs(s.x - lastX) > 60 || Math.abs(s.z - lastZ) > 60);
  if (moved) { jumps++; hot = 14; }
  lastX = s.x;
  lastZ = s.z;
  const t = ((Date.now() - start) / 1000).toFixed(1);
  if (hot > 0 || rows.length === 0 || Math.round(t) % 6 === 0) {
    const info = await game.java(probe);
    rows.push(`${t}s x=${s.x.toFixed(1)} y=${s.y.toFixed(1)} z=${s.z.toFixed(1)} hp=${s.health} ${info}`);
  }
  if (hot > 0) hot--;
}
await game.say("@s stat");
log(rows.join("\n"));
return { jumps };
