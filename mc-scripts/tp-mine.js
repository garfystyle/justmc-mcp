await game.sleep(1700);
await game.say("@t tp " + args.tp);
await game.sleep(900);
const pos = `new net.minecraft.core.BlockPos(${args.x}, ${args.y}, ${args.z})`;
const dir = `net.minecraft.core.Direction.${String(args.face ?? "up").toUpperCase()}`;
await game.java(`mc.gameMode.startDestroyBlock(${pos}, ${dir}); 1;`);
const end = Date.now() + (args.ms ?? 2500);
let ticks = 0;
while (Date.now() < end) {
  await game.java(`mc.gameMode.continueDestroyBlock(${pos}, ${dir}); mc.player.swing(net.minecraft.world.InteractionHand.MAIN_HAND); 1;`);
  ticks += 1;
  await game.sleep(45);
}
await game.java(`mc.gameMode.stopDestroyBlock(); 1;`);
await game.sleep(500);
const block = await game.java(`mc.level.getBlockState(${pos}).getBlock().toString();`);
return { ticks, block };
