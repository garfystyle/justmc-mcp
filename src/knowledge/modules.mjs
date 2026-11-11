const COLOR = /&#[0-9a-fA-F]{6}|&[0-9a-fk-orA-FK-OR]/g;

const textLines = (name) => String(name ?? "").split("\\n").map((line) => line.replace(COLOR, "").trim());

export function moduleTitle(m) {
  for (const line of textLines(m.displayName)) {
    const plain = line.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
    if (plain) return plain;
  }
  return String(m.name);
}

export function moduleText(m) {
  return textLines(m.displayName).filter(Boolean).join(" · ");
}

function described(handler) {
  const own = handler.description;
  const passed = handler.values?.find((v) => v?.name === "description")?.value;
  const list = own?.values ?? own ?? passed?.values ?? passed;
  return (Array.isArray(list) ? list : [list])
    .map((line) => (typeof line === "string" ? line : line?.text ?? ""))
    .filter(Boolean)
    .join(" ")
    .replace(COLOR, "")
    .trim();
}

export function functionDocs(json) {
  const docs = new Map();
  let world;
  try {
    world = JSON.parse(json);
  } catch {
    return docs;
  }
  for (const handler of world.handlers ?? []) {
    const about = handler?.name ? described(handler) : "";
    if (about) docs.set(handler.name, about);
  }
  return docs;
}
