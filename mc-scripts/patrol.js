const points = args.points ?? [];
if (!points.length) throw new Error("нужен args.points");
const rounds = args.rounds ?? 1;
for (let r = 0; r < rounds; r++) {
  for (const [x, y, z] of points) {
    const done = await game.walk({ x, y, z, sprint: Boolean(args.sprint), timeoutMs: 60000 });
    log(done.arrived ? "дошёл" : "не дошёл: " + done.outcome, x, y, z);
    if (!done.arrived) return { stopped: [x, y, z], outcome: done.outcome };
  }
}
return { rounds };