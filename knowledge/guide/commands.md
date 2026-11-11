# Команды в чате и данные

Цифры — по 486 модулям каталога, `player_chat` есть в 234. Префикс команд — `@` (159 модулей; `#` — 11, `.` — 8). Строк `when player_chat` бывает несколько (92 модуля), срабатывают все. Выход из события — `end_thread()`, он останавливает только свою строку; `return` в `when` не собирается. Короткий выход пишется в строку: `if x { send_message("нет"); end_thread() }`.

## Точная команда и права
```kotlin
when player_chat {
    if chat_message_equals(["@reload", "@rl"], ignore_case: true) {
        cancel_event()
        if not has_privilege(privilege: whitelisted) { send_message("&cНет прав"); end_thread() }
        send_message(["&aГотово", "&7Настройки перечитаны"], merging: separate_lines)
    }
}
```
- `chat_message_equals` (139 модулей) сравнивает сообщение целиком, список — псевдонимы. `cancel_event()` (168) прячет сообщение. В модулях отмена почти всегда внутри `if has_privilege`: игрок без прав светит команду в чате и не слышит отказа. Сначала отмена, потом права.
- Права: `whitelisted` оператор мира (62 модуля), `owner` владелец (29), `developer` (26), `builder`, `builder_and_developer`. `privilege:` пиши всегда: `has_privilege()` значит `builder`. `exact: true` проверяет строителя и разработчика даже у оператора мира.

## Команда с аргументами
```kotlin
when player_chat {
    args = split_text(value.event_chat_message, " ")
    if text_case(args[0], case_type: lower) != "@mail" { end_thread() }
    cancel_event()
    if len(args) < 3 { send_message("&cНужно: @mail <ник> <текст>"); end_thread() }
    body = join_text(trim_list(args, 2, len(args)), " ")
    send_message("&aДля ${args[1]}: ${body}")
}
```
- Команду сравнивай первым словом: `text_starts_with(msg, "@set")` (70 модулей) поймает и `@setlore`. Если всё же началом, то с пробелом: `"@set "`. У `text_case` умолчание — верхний регистр, `case_type:` обязателен.
- `len(args)` проверяй до чтения (из 54 модулей с `split_text` в чате это делают 19): что даёт `args[5]` за концом, не проверено. Необязательный аргумент: `get_list_value(args, 3, "умолчание")`.
- Разделитель пиши явно: `split_text(msg)` без него (31 модуль) рассчитан на пробел. Двойные пробелы и пробелы по краям сжимает сам клиент (`ChatScreen.normalizeChatMessage`).
- Хвост: `trim_list(список, от, до)`, `от` с нуля, `до` не включается. Модули делают то же циклом (bans) и `remove_list_value_at_index` по одному (ItemEditor): длиннее и портит `args`. `remove_text("@t", msg)` вырежет `@t` и из середины, `trim_text(msg, 6, …)` сломается при переименовании команды.

## Много команд: функция на команду
```kotlin
const COMMANDS = ["@ping", "@me"]
func `@ping`() { send_message("&apong") }
func `@me`() { send_message("&7Ты %player%, аргументов: ${len(args) - 1}") }
when player_chat {
    args = split_text(value.event_chat_message, " ")
    command_name = text_case(args[0], case_type: lower)
    if command_name not in COMMANDS { end_thread() }
    cancel_event()
    call(command_name)
}
```
- Приём bans (419 установок): один разбор вместо копии `has_privilege` + `text_starts_with` на каждую команду, как в ItemEditor. Список нужен дважды: `call` несуществующей функции — ошибка, а чужие сообщения отменять нельзя. Для двух-трёх команд хватит `if command_name == … else if`.
- Локальные у вызова и функции общие (SERVER.md): функция видит `args`, но её `x` затрёт одноимённую у вызова, для своих бери `line x`. В функции `return` возвращает к вызову, `end_thread()` останавливает всю строку.

## Числа из текста
```kotlin
const NUMBER_PATTERN = "^-?[0-9]+([.][0-9]+)?$"
when player_chat {
    args = split_text(value.event_chat_message, " ")
    if args[0] != "@double" { end_thread() }
    cancel_event()
    raw = get_list_value(args, 1, "")
    if not text_matches(NUMBER_PATTERN, raw, regular_expressions: true) { send_message("&cНужно число"); end_thread() }
    amount = add(raw)
    send_message("&aВдвое больше: ${amount * 2}")
}
```
- Текст `"abc"` в числовом аргументе останавливает строку (SERVER.md), поэтому сначала проверка. Диапазон: `if amount not in 1..64`. У `text_matches` первым идёт шаблон, без `regular_expressions: true` сравнивает как текст.
- `convert_text_to_number` (18 модулей) — только целые, `add(текст)` берёт и дробные (так в MAPI). Модули ловят ошибку: `exception(err, exception_type: enum("ERROR")) { … }`, потом `err == "not_a_number"` (6 модулей). Работает, но Xero предупреждает про `exception_type`, а регулярка короче.

## Игрок по нику и его переменная
```kotlin
save `%var_local(nick)_gifts`
when player_chat {
    args = split_text(value.event_chat_message, " ")
    if args[0] != "@gift" { end_thread() }
    cancel_event()
    nick = get_list_value(args, 1, value.name)
    if not has_player(nick) { send_message("&c${nick} нет в мире"); end_thread() }
    player_by_name(nick)
    @current give_items(item(diamond))
    `%var_local(nick)_gifts` += 1
    @default send_message("&eУ %selected% подарков: ${`%var_local(nick)_gifts`}")
}
```
- `has_player` (27 модулей) — до выбора, после выбора то же даёт `value.selection_size == 0`. `player_by_conditional(player.name_equals(nick))` (53) здесь равно `player_by_name(nick)` (51), только длиннее.
- После `player_by_name` действие без цели уходит выбранному (так рассчитан bans). Пиши цель явно: `@current` выбранный, `@default` автор. `event_target()` возвращает выборку к автору. `%player%` остаётся ником автора, `%selected%` — первый в выборке.
- Имя чужой переменной: `` `%var_local(nick)_gifts` `` с объявлением `save` вне `when`, иначе она локальная. `${nick}` в имени не подставляется. Параметр функции — строчная: `%var_line(nick)`.

## Состояние игрока
```kotlin
const COOLDOWN = 5000
save `%player%_coins`
game `%player%_next`
when player_join {
    if not var.exists(`%player%_coins`) { `%player%_coins` = 100 }
}
when player_chat {
    if chat_message_equals("@daily", ignore_case: true) {
        cancel_event()
        now = value.timestamp
        if now < `%player%_next` { send_message("&cЖди ещё ${ceil((`%player%_next` - now) / 1000)} с"); end_thread() }
        `%player%_next` = now + COOLDOWN
        `%player%_coins` += 10
        send_message("&aМонет: ${`%player%_coins`}")
    }
}
```
- `%player%` в имени — у 219 модулей, словарь по нику — у 16: значение на игрока держи так, словарь бери для обхода всех (лидеры). Без `save`/`game` вне `when` такая переменная локальная. `var.exists`, а не `== 0`: незаданная сравнивается как 0 (на этом стоит bans), настоящий ноль не отличить.
- `save` — что жалко потерять: префиксы, деньги, счёт. `game` — позиции, режимы, шаги меню, кулдауны (8 имён кулдаунов в `game`, 0 в `save`). Шаг ввода («напиши ответ в чат», 12 модулей) проверяй первым в `when player_chat`, с `cancel_event()`, иначе ответ разберут как команду.
- `game` с ником переживает выход игрока: чисти в `player_quit`, `` var.remove(`%player%_next`) ``. `purge("%player%", scope: game, match: name_contains)` (stargunb) заденет и того, чей ник содержит этот.

## Записи: словарь и список вместо параллельных списков
```kotlin
save warns
when player_chat {
    if not var.exists(warns) { warns = {} }
    args = split_text(value.event_chat_message, " ")
    if args[0] != "@warn" { end_thread() }
    cancel_event()
    if len(args) < 3 { send_message("&cНужно: @warn <ник> <причина>"); end_thread() }
    rec = {"by": value.name, "reason": args[2]}
    history = get_map_value_single(warns, args[1], [])
    history = append_value(rec)
    warns[args[1]] = history
    for i, entry in history { send_message("&e${i + 1}. ${entry["reason"]} (${entry["by"]})") }
}
```
- bans (1280 установок) держит мут в пяти списках и ищет индекс по нику: разъезжаются от одной ошибки. Запись одним словарём не разъедется. В `{…}` и `[…]` пиши только постоянные: переменная внутри такого значения на сервере превращается в мусор. Вычисленное — `create_map_from_values(ключи, значения)` и `create_list([...])`.
- `m[k]` требует, чтобы вид был известен: `m = {}`, `m = []` или объявление `save m: map`. `if k in m` — есть ли ключ. Вложенная запись `p["bob"]["hp"] = 5` работает (SERVER.md).
- `list = append_value(x)` и `append_value(list, x)` дописывают в ту же переменную, `remove_list_value(list, x)` убирает. `get_list_index_of_value` без находки даёт -1, `set_list_value` за границей — ошибка (SERVER.md).

## Таблица лидеров
```kotlin
const TOP_SIZE = 3
save scores
when player_chat {
    if not var.exists(scores) { scores = {} }
    args = split_text(value.event_chat_message, " ")
    if args[0] != "@score" { end_thread() }
    cancel_event()
    if len(args) < 3 { send_message("&cНужно: @score <ник> <очки>"); end_thread() }
    old = get_map_value_single(scores, args[1], 0)
    scores[args[1]] = old + add(args[2])
    sorted = sort_any_map(scores, sort_order: descending, sort_type: values)
    place = 0
    for nick: points in sorted {
        place += 1
        if place > TOP_SIZE { break }
        send_message("&e${place}. &f${nick} &7— ${points}")
    }
}
```
- `sort_any_map` (18 модулей) по умолчанию идёт по ключу и по возрастанию: оба маркера пиши всегда, для времени прохождения — `ascending`. Значения храни числами (`add`). Если счёт уже лежит в переменных с ником, вариант Tops: список всех ников, словарь собирается перед выводом.
- `m[k] += 1` на новом ключе даёт 1: это проверено на сервере. Счётчик в словаре не нужно заранее заполнять нулём.

## Работа с текстом
```kotlin
const CLIP_PREFIX = "@clip "
const LIMIT = 12
when player_chat {
    message = value.event_chat_message
    if not text_starts_with(message, CLIP_PREFIX) { end_thread() }
    cancel_event()
    clean = clear_color_codes(trim_text(message, text_length(CLIP_PREFIX), text_length(message)))
    clean = replace_text(clean, "плохо", "***", ignore_case: true)
    if text_length(clean) > LIMIT { clean = "${trim_text(clean, 0, LIMIT)}..." }
    send_message("&7${text_case(clean, case_type: proper)} (${text_length(clean)})")
}
```
`trim_text(текст, от, до)`: `от` с нуля, `до` не включается. `text_contains`, `text_starts_with`, `text_ends_with` берут `ignore_case: true`. Склейка — `"${a}${b}"`, а не `text([a, b], merging: concatenation)`. Пробел — `" "` или `"%space%"`, пустая строка — `""` или `"%empty%"`.

## Формат времени
```kotlin
func duration(ms: number) {
    line total_seconds = floor(ms / 1000)
    return "${floor(total_seconds / 3600)}ч ${floor(total_seconds % 3600 / 60)}м ${total_seconds % 60}с"
}
when player_chat {
    if chat_message_equals("@time", ignore_case: true) {
        cancel_event()
        short = format_timestamp(90000, "mm:ss", format: custom)
        now = format_timestamp(value.timestamp, "dd.MM.yyyy HH:mm", "GMT+3", "ru_RU", format: custom)
        send_message("${short} / ${duration(90061000)} / ${now}")
    }
}
```
`value.timestamp` — миллисекунды, но с точностью до секунды: кулдаун короче секунды на нём не считается. Шаблон работает только с `format: custom`, умолчание — `dd_mm_yyyy_hh_mm_s`. Больше суток — формулой, как `duration` (так в bans и parkour): `HH` показывает время суток, а не сумму часов. Ввод `1h30m` (bans): `split_text(s, "%empty%")` режет на символы, цифры копятся в буфер, буква умножает его на словарь единиц; формат проверь заранее шаблоном `"^([0-9]+[smhd])+$"`.

## Свой формат чата
```kotlin
save `%player%_prefix`
when player_chat {
    if text_starts_with(value.event_chat_message, "@") { end_thread() }
    cancel_event()
    if not var.exists(`%player%_prefix`) { `%player%_prefix` = "&7Игрок" }
    @all send_message([`%player%_prefix`, " &f%player%&8: &7", value.event_chat_message], merging: concatenation)
}
```
Отмена и своя рассылка (SimplePrefix, prefix). Команды и мут проверяй до рассылки: отмена в другой строке эту рассылку не остановит, bans советует ставить такую строку последней.

## Частые ошибки
- `` `%player%_x` = 1 `` без объявления `save`/`game` — локальная. `` `${nick}_x` `` — буквальное имя, нужно `` `%var_local(nick)_x` ``.
- `text_matches(значение, шаблон)`: порядок обратный. В ItemEditor так работает только потому, что сравнение без регулярки.
- `get_map_value(умолчание, ключ, словарь)` из модулей — старый порядок: пиши `get_map_value_single(словарь, ключ, умолчание)`.
- Цепочки `increment`, `multiply`, `num("%math(…)")` из модулей в Xero — `+=` и формула.
