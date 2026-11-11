if (args.slot !== undefined) await game.setHotbar(args.slot);
if (args.yaw !== undefined) await game.look({ yaw: args.yaw, pitch: args.pitch ?? 0 });
await game.sleep(250);
const out = await game.java(`
  var r = mc.gameMode.useItem(mc.player, net.minecraft.world.InteractionHand.MAIN_HAND);
  "" + r + " hand=" + mc.player.getMainHandItem().getItem();`);
await game.sleep(args.after ?? 900);
return out;
