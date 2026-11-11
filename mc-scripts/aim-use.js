await game.setHotbar(args.slot);
await game.look({ x: args.x, y: args.y, z: args.z });
await game.sleep(300);
await game.click("attack");
await game.sleep(args.after ?? 1800);
const s = await game.state();
return { x: s.x, y: s.y, z: s.z, health: s.health };
