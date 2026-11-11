const VOWEL = /[аеиоуыэюя]/;
const PERFECTIVE = /(?:ив|ивши|ившись|ыв|ывши|ывшись|(?<=[ая])(?:в|вши|вшись))$/;
const REFLEXIVE = /(?:ся|сь)$/;
const ADJECTIVE = /(?:ее|ие|ые|ое|ими|ыми|ей|ий|ый|ой|ем|им|ым|ом|его|ого|ему|ому|их|ых|ую|юю|ая|яя|ою|ею)$/;
const PARTICIPLE = /(?:ивш|ывш|ующ|(?<=[ая])(?:ем|нн|вш|ющ|щ))$/;
const VERB = /(?:ила|ыла|ена|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ен|ило|ыло|ено|ят|ует|уют|ит|ыт|ены|ить|ыть|ишь|ую|ю|(?<=[ая])(?:ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ют|ны|ть|ешь|нно))$/;
const NOUN = /(?:а|ев|ов|ие|ье|е|иями|ями|ами|еи|ии|и|ией|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я)$/;
const SUPERLATIVE = /(?:ейш|ейше)$/;
const DERIVATIONAL = /ость?$/;

function region(word) {
  const m = word.match(VOWEL);
  return m ? m.index + 1 : word.length;
}

function russian(word) {
  const at = region(word);
  const head = word.slice(0, at);
  let rv = word.slice(at);
  if (PERFECTIVE.test(rv)) {
    rv = rv.replace(PERFECTIVE, "");
  } else {
    rv = rv.replace(REFLEXIVE, "");
    if (ADJECTIVE.test(rv)) {
      rv = rv.replace(ADJECTIVE, "").replace(PARTICIPLE, "");
    } else if (VERB.test(rv)) {
      rv = rv.replace(VERB, "");
    } else {
      rv = rv.replace(NOUN, "");
    }
  }
  rv = rv.replace(/и$/, "").replace(DERIVATIONAL, "").replace(SUPERLATIVE, "").replace(/нн$/, "н").replace(/ь$/, "");
  return head + rv;
}

function english(word) {
  if (word.length < 4) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function stem(word) {
  if (/[а-я]/.test(word)) return word.length < 4 ? word : russian(word);
  return english(word);
}

const WORD = /[\p{L}\p{N}_]+/gu;

export function tokens(text, { parts = true } = {}) {
  const out = [];
  for (const m of String(text).toLowerCase().replaceAll("ё", "е").matchAll(WORD)) {
    const word = m[0];
    if (word.includes("_")) {
      if (parts) for (const piece of word.split("_")) if (piece.length > 1) out.push(stem(piece));
      continue;
    }
    if (word.length > 1) out.push(stem(word));
  }
  return out;
}

export const indexText = (text) => tokens(text).join(" ");

export function matchQuery(text, extra = []) {
  const unique = [...new Set([...tokens(text), ...extra])].filter((t) => t.length > 1).slice(0, 24);
  if (!unique.length) return null;
  return unique.map((t) => `"${t.replaceAll('"', "")}"${t.length >= 4 ? "*" : ""}`).join(" OR ");
}
