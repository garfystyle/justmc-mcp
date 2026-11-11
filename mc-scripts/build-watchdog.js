const seconds = args.seconds ?? 480;
const doneRe = new RegExp(args.done ?? "Мир построен");
const errRe = /Критическая ошибка|❌|Ошибка/;
const watch = await game.Watch.start({ local: true });
const end = Date.now() + seconds * 1000;
let index = 0;
let lastBar = "";
let lastLog = 0;
while (Date.now() < end) {
  await game.sleep(250);
  await watch.poll();
  for (; index < watch.all.length; index++) {
    const event = watch.all[index];
    const text = String(event.text ?? "");
    if (event.type === "chat" && errRe.test(text)) {
      await game.say("/build");
      log("СТОП: " + text.replace(/\s+/g, " ").slice(0, 200));
      return { stopped: true, error: text.replace(/\s+/g, " ").slice(0, 200), lastBar };
    }
    if (event.type === "chat" && doneRe.test(text)) {
      log("ГОТОВО: " + text);
      return { done: true, lastBar };
    }
    if (event.type === "bossbar" && text) lastBar = text;
  }
  if (Date.now() - lastLog > 15000) {
    lastLog = Date.now();
    log(lastBar);
  }
}
return { timeout: true, lastBar };
