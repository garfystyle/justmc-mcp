const seconds = args.seconds || 80;
const speed = args.speed || 0.0325;
const yaw = args.yaw === undefined ? -90 : args.yaw;
const base = 29;
await game.java(`mc.player.getAbilities().flying = true; mc.player.getAbilities().setFlyingSpeed(${speed}f); mc.player.onUpdateAbilities(); 1;`);
await game.look({ yaw, pitch: 0 });
const rows = [];
const start = Date.now();
let lastX = null, lastZ = null, travelled = 0, hot = 0, jumps = 0, voidUnder = 0, samples = 0, lean = 99;
const ang = (yaw + 90) * Math.PI / 180;
const dirX = Math.round(Math.cos(ang) * 16), dirZ = Math.round(Math.sin(ang) * 16);
const probe = `var p = mc.player.blockPosition(); int have = 0; for (int i = 1; i <= 6; i++) { if (mc.level.getHeight(net.minecraft.world.level.levelgen.Heightmap.Types.MOTION_BLOCKING, p.getX() + i * ${dirX}, p.getZ() + i * ${dirZ}) > ${base + 2}) have++; } int under = mc.level.getHeight(net.minecraft.world.level.levelgen.Heightmap.Types.MOTION_BLOCKING, p.getX(), p.getZ()); have + " " + under;`;
while (Date.now() - start < seconds * 1000) {
  await game.hold(["forward"], 500);
  const s = await game.state();
  const jumped = lastX !== null && (Math.abs(s.x - lastX) > 60 || Math.abs(s.z - lastZ) > 60);
  if (lastX !== null && !jumped) travelled += Math.hypot(s.x - lastX, s.z - lastZ);
  if (jumped) { jumps++; hot = 4; }
  lastX = s.x; lastZ = s.z;
  const info = String(await game.java(probe)).split(" ");
  const ahead = Number(info[0]);
  const under = Number(info[1]);
  samples++;
  if (under <= base + 2) voidUnder++;
  lean = Math.min(lean, ahead);
  const t = ((Date.now() - start) / 1000).toFixed(1);
  if (hot > 0 || rows.length === 0 || Math.round(t * 2) % 20 === 0) {
    rows.push(`${t}s x=${s.x.toFixed(0)} z=${s.z.toFixed(0)} ahead=${ahead}/6 ground=${under} path=${travelled.toFixed(0)}`);
  }
  if (hot > 0) hot--;
}
await game.java(`mc.player.getAbilities().setFlyingSpeed(0.05f); 1;`);
log(rows.join("\n"));
return { jumps, travelled: Math.round(travelled), worstAhead: lean, voidUnder, samples };
