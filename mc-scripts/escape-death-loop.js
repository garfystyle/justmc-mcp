for (let i = 0; i < 12; i++) {
  await game.java(`mc.player.respawn(); 1;`);
  await game.sleep(120);
  await game.say("/dev");
  await game.sleep(1700);
  const s = await game.state();
  log(`try ${i}: mode=${s.mode} hp=${s.health}`);
  if (s.mode === "dev") return "dev";
}
return "нет";
