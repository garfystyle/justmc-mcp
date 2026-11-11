const here = await game.state();
const x = args.x ?? here.x;
const y = args.y ?? here.y + 1;
const z = args.z ?? here.z;
const found = await game.scene({ displays: true, x, y, z, radius: args.scan ?? 12, limit: 200 });
log("визуализаторов:", found.total);
const shots = await game.screenshots({ downscale: 2, orbit: { x, y, z, radius: args.radius ?? 6, height: args.height ?? 2, views: args.views ?? 4 }, timeoutMs: 30000 });
return { displays: found.total, shots: shots.length, entities: found.entities.map((e) => ({ type: e.type, x: e.x, y: e.y, z: e.z, scale: e.display.scale, translation: e.display.translation })) };