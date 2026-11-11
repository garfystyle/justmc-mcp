const scene = game.scene({type: "item_display"});
log(Object.keys(scene).join(","));
const java = game.java("return mc.level.getClass().getName();");
log(String(java));
return JSON.stringify(scene).slice(0, 800);