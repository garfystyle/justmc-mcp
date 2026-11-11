const x = args.x, y = args.y, z = args.z;
const face = String(args.face ?? "up").toUpperCase();
const ms = args.ms ?? 5000;
const pos = `new net.minecraft.core.BlockPos(${x}, ${y}, ${z})`;
const dir = `net.minecraft.core.Direction.${face}`;
await game.java(`mc.gameMode.startDestroyBlock(${pos}, ${dir}); 1;`);
const end = Date.now() + ms;
let ticks = 0;
while (Date.now() < end) {
  await game.java(`
    if (mc.level.getBlockState(${pos}).isAir()) { 0; } else {
      mc.gameMode.continueDestroyBlock(${pos}, ${dir});
      mc.player.swing(net.minecraft.world.InteractionHand.MAIN_HAND);
      1;
    }`);
  ticks += 1;
  await game.sleep(45);
}
await game.java(`mc.gameMode.stopDestroyBlock(); 1;`);
return { ticks };
