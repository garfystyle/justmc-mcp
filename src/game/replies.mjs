export const REPLY = {
  playMode: /(?<!не )запущен в режиме игры|(?<!не )запущено в режимі гри|started in play mode/i,
  buildMode: /запущен в режиме строительства|запущено в режимі будівництва|started in build mode/i,
  slowDown: /Подождите|Зачекайте|Please wait/i,
  notPlaying: /не запущен в режиме игры|не запущено в режимі гри|not running in play mode|Unknown or incomplete/i,
  noVariables: /Переменные отсутствуют|Змінні відсутні|No variables found/i,
  oldUploadCommand: /module loadUrl/i,
};

const ALERT_PREFIX = /^\s*(?:❌|☠|⚠|✕)/;
const FAILURE_HEADER = /^[\s┌│┃└|✕❌☠]*(?:КРИТИЧЕСКАЯ ОШИБКА|ОШИБКА)(?:\s|$)/;
const WARNING_HEADER = /^[\s┌│┃└|⚠]*ПРЕДУПРЕЖДЕНИЕ(?:\s|$)/;
const LINE_STOPPED = /остановило строку кода|Строка кода остановлена|зупинила рядок коду|stopped a line of code|Code line was stopped/i;
const LINE_WARNED = /вызвало предупреждение|викликала попередження|caused a warning/i;
const CODE_STOPPED = /Выполнение кода (?:было )?остановлено|Виконання коду було зупинено|Code execution was stopped|КРИТИЧЕСКАЯ ОШИБКА/i;
const BAD_CALL = /Функция с такими параметрами|Функцію з такими параметрами|Function with these parameters|Ожидал аргумент|Очікував аргумент|Expected argument/i;

export const isServerAlert = (line) => ALERT_PREFIX.test(line) || FAILURE_HEADER.test(line) || WARNING_HEADER.test(line)
  || LINE_STOPPED.test(line) || LINE_WARNED.test(line) || CODE_STOPPED.test(line) || BAD_CALL.test(line);

export const isServerFailure = (line) => /^\s*(?:❌|☠)/.test(line) || FAILURE_HEADER.test(line) || LINE_STOPPED.test(line)
  || CODE_STOPPED.test(line) || BAD_CALL.test(line);

export const isWorldStop = (line) => /^\s*☠/.test(line) || CODE_STOPPED.test(line);

const BOX_HEADER = /^\s*┌/;
const BOX_LINE = /^\s*[┌│├└]/;
const LIMITS_BODY = /blockChangesCount/;

export const isLimitsReport = (text) => LIMITS_BODY.test(text ?? "");

const FRAMED_ALERT = /^\s*┌\s*\n\s*│\s*(?:❌|☠|⚠|✕)/;

export const isVariableList = (text) => BOX_HEADER.test(text ?? "") && !isLimitsReport(text) && !FRAMED_ALERT.test(text ?? "");

export const isServiceReport = (text) => BOX_LINE.test(text ?? "") && !FRAMED_ALERT.test(text ?? "");

export const listedTotal = (text) => Number(text.match(/\((\d+)\)/)?.[1] ?? NaN);

const LOCATION_VALUE = /^Location\{.*?x=(-?[\d.]+),y=(-?[\d.]+),z=(-?[\d.]+),pitch=(-?[\d.]+),yaw=(-?[\d.]+)\}$/;
const shortNumber = (text) => String(Math.round(Number(text) * 1000) / 1000);

export function readableValue(value) {
  const location = String(value).match(LOCATION_VALUE);
  if (!location) return value;
  const [x, y, z, pitch, yaw] = location.slice(1).map(shortNumber);
  return `loc(${x}, ${y}, ${z}, ${yaw}, ${pitch})`;
}

export function serverStats(hudSnapshot) {
  const footer = hudSnapshot?.tabFooter ?? "";
  const read = (pattern) => {
    const found = footer.match(pattern)?.[1];
    return found ? Number(found) : undefined;
  };
  return {
    tps: read(/TPS:\s*([\d.]+)/),
    ping: read(/(?:Пинг|Пінг|Ping):\s*(\d+)/),
    online: read(/(?:Онлайн|Online):\s*(\d+)/),
  };
}
