const ticks = args.ticks || 40;
const where = await game.java(`var h = mc.hitResult.getBlockPos(); h.getX() + "," + h.getY() + "," + h.getZ();`);
const [x, y, z] = String(where).split(",").map(Number);
const pos = `new net.minecraft.core.BlockPos(${x}, ${y}, ${z})`;
const up = `net.minecraft.core.Direction.UP`;
log("target " + where + " " + JSON.stringify(await game.java(`mc.level.getBlockState(${pos}).toString();`)));
await game.java(`mc.gameMode.startDestroyBlock(${pos}, ${up}); 1;`);
for (let i = 0; i < ticks; i++) {
  await game.java(`mc.gameMode.continueDestroyBlock(${pos}, ${up}); mc.player.swing(net.minecraft.world.InteractionHand.MAIN_HAND); 1;`);
  await game.sleep(45);
}
await game.sleep(1200);
log("after: " + JSON.stringify(await game.java(`mc.level.getBlockState(${pos}).toString();`)));
log("inv: " + JSON.stringify(await game.inventory()).slice(0, 300));
return "done";
