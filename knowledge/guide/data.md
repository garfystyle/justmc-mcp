# Данные и их хранение

Рецепты прогнаны на сервере 04.11.2026: 14 из 15. Цифры по 1075 модулям. Основы в `commands.md` (`var.exists`, записи, простой топ, `format_timestamp`), `menus-items.md` (`save_inventory`, рюкзак, страницы меню), `loops-ui.md` (лимиты строки). Поведение без ссылки на `SERVER.md` подтверждено только кодом модулей. «В модулях нет»: приём из справочника.

## Где что держать
| Данные | Форма | В модулях |
|:--|:--|:--|
| пара значений на игрока | `` save `монеты %player%` `` | 158 |
| много полей, живут и стираются вместе | `` save `профиль %player%`: map `` | 2, обычно переменная на поле |
| значение всех игроков разом | `save scores: map`, ключ ник | bans, Leaderboards, ᛃ Наказания |
| записи с полями | словарь по `%random_uuid%`, список словарей | АУКЦИОН, Privates |

- Вложенное лежит как есть: АУКЦИОН кладёт в `save` словарь с предметом и ником, Privates список словарей с местом, ᛟ Статистика месяц → день → список. В текст кодируй только там, где разрешён один текст.
- Ник короче, но смена ника теряет данные. Деньгам нужен `%player_uuid%` (8 модулей) и словарь uuid → ник для вывода.

## Профиль одним словарём
```kotlin
const NEW_PROFILE = {"coins": 100, "level": 1}
save `профиль %player%`: map
func pay(amount: number) {
    `профиль %player%`["coins"] += amount
    send_message("&aМонет: ${`профиль %player%`["coins"]}")
}
when player_join {
    if not var.exists(`профиль %player%`) { `профиль %player%` = {} }
    `профиль %player%` = append_maps([NEW_PROFILE, `профиль %player%`])
    pay(1)
}
```
- «Данные игрока» (1092 установки) держит 15 `save` и флаг `ПервыйВход`, сброс занимает 15 строк. Здесь сброс один: `` var.remove(`профиль %player%`) ``.
- `append_maps` дополняет старые профили новыми полями, сохранённое побеждает (в модулях нет). Разовое чтение: `get_map_value_single(профиль, "gems", 0)`.
- `m["x"] += 1` это два блока, чтение и запись. Счётчик, который растёт каждый тик, держи отдельной переменной.

## Топ с вышедшими игроками и своё место
Переменные с ником обойти нельзя, поэтому нужен реестр ников (19 модулей дописывают его в `player_join`).
```kotlin
const TOP_SIZE = 5
save known: list
save `монеты %var_local(nick)`
game top_text
game top_order: list
process refresh_top() {
    forever {
        board = {}
        for nick in known { board[nick] = `монеты %var_local(nick)` }
        board = sort_any_map(board, sort_order: descending, sort_type: values)
        top_order = get_map_keys(board)
        rows = []
        for nick: score in board {
            rows = append_value("&e${len(rows) + 1}. &f${nick} &7${score}")
            if len(rows) >= TOP_SIZE { break }
        }
        top_text = join_text(rows, "\n")
        wait(10s)
    }
}
when world_start {
    if not var.exists(known) { known = [] }
    top_order = []
    top_text = ""
    start refresh_top(target_mode: no_target)
}
when player_join {
    if value.name not in known { known = append_value(value.name) }
}
when player_chat {
    if chat_message_equals("@top") {
        cancel_event()
        send_message(top_text)
        send_message("&7Твоё место: ${get_list_index_of_value(top_order, value.name) + 1}")
    }
}
```
- Основа из «⚡ Лёгкий модуль на топы», там пересборка каждые 2 тика. Лидерборды v2.0 обновляют раз в 30 с, этого хватает.
- Игрока нет в списке: индекс -1, место 0. Без реестра ники дают `get_list_variables("монеты ", scope: save, match: starts_with)`: так MAPI ищет свои переменные, для топов в модулях нет.
- Вывод: `set_text_display_text` (5 модулей), `display_hologram` (4). Своя строка каждому: `@current display_hologram` в обходе онлайна (Leaderboards, SIMPLE TOPS).
- Значения только числами: «ТОП ПО КИЛЛАМ» сортирует строки `"12 🗡 ник"`, текст идёт посимвольно, 9 выше 10. Время прохождения: `ascending`. Мера любая: `@near` в bans кладёт `nearplayers[nick] = distance`. Порядок равных значений не проверен.

## Постраничный вывод в чат
```kotlin
const PER_PAGE = 5
save news: list
when player_chat {
    args = split_text(value.event_chat_message, " ")
    if args[0] != "@news" { end_thread() }
    cancel_event()
    if list_is_empty(news) { send_message("&7Пусто"); end_thread() }
    raw = get_list_value(args, 1, "1")
    if not text_matches("^[0-9]+$", raw, regular_expressions: true) { send_message("&cНужен номер"); end_thread() }
    pages = ceil(len(news) / PER_PAGE)
    page = clamp(add(raw), 1, pages)
    first = (page - 1) * PER_PAGE
    last = min(first + PER_PAGE, len(news))
    send_message("&eСтраница ${page} из ${pages}")
    for row in trim_list(news, first, last) { send_message(row) }
    if page < pages {
        send_message(set_component_click("&a[дальше]", "@news ${page + 1}", click_action: suggest_command))
    }
}
```
- Форма из `Mapi.modulesCommand`: страница зажата в границы, конец среза не дальше длины. Пустой список проверяй до `clamp`: там `pages` равно 0.
- `run_command` в модулях нет ни разу, кнопки идут через `suggest_command` (26 обработчиков): команда встаёт в поле чата, Enter жмёт игрок. `chunk_list(l, 5)` режет на страницы сразу (в модулях нет).

## Разбор текста
Параметры `ключ=значение` поверх умолчаний (White_145Gaming/chairs так разбирает состояния блока):
```kotlin
when player_chat {
    args = split_text(value.event_chat_message, " ")
    if args[0] != "@mob" { end_thread() }
    cancel_event()
    opts = {"count": "1", "name": "моб"}
    for word in trim_list(args, 1, len(args)) {
        pair = split_text(word, "=")
        if len(pair) == 2 { opts[pair[0]] = pair[1] }
    }
    send_message("count=${opts["count"]} name=${opts["name"]}")
}
```
Группы регулярки: результат это список находок, в каждой `[0]` вся находка, `[1]` и дальше группы (☠ Ванильные сообщения смерти, единственный модуль):
```kotlin
func roll(message: text) {
    found = get_text_regex_groups(message, "([0-9]+)d([0-9]+)", get_group_by: index)
    dice = found[0]
    send_message("Кубиков ${dice[1]}, граней ${dice[2]}")
}
```
| Задача | Действие | Модулей |
|:--|:--|:--|
| слова в кавычках как один аргумент | регулярка `"[^"]*"` или `[^ ]+` через `\|`, `[0]` каждой находки | нет |
| перенос описания по словам | `split_text_by_length(s, 30)` | 2 |
| ровно по N символов, рвёт слова | `chunk_text(s, 40)` | 3 |
| позиция подстроки | `get_index_of_subtext(s, sub, 0)` и `trim_text` | 8 |
| оставить цифры | `regex_replace_text(s, "[^0-9]", "")` | 9 с такой заменой |

Таблицу правил можно держать в коде: `parse_json("{…}")` один раз под `if not var.exists(table)`, обход `for regex: value in table` (☠ Ванильные сообщения смерти).

## Числа
```kotlin
const MINUTES = ["минут", "минута", "минуты", "минуты", "минуты", "минут", "минут", "минут", "минут", "минут"]
func short(amount: number) {
    if amount >= 1000000 { return "${round(amount / 1000000, 1)}M" }
    if amount >= 1000 { return "${round(amount / 1000, 1)}K" }
    return "${amount}"
}
func plural(amount: number, forms: list) {
    if amount % 100 in 11..14 { return forms[0] }
    return forms[amount % 10]
}
when player_join {
    send_message("${short(1500)} ${plural(21, MINUTES)}")
}
```
- `plural`: приём ᛃ Наказания, десять форм по последней цифре. `short`: ⁂ Числовые обозначения.
- `round(x, 2)`, вниз `round_type: floor`. Целая формула печатается без `.0` (`SERVER.md`), дробь всеми знаками: округляй перед выводом.
- Ведущий ноль: `if i < 10 { i = "0${i}" }` (ᛟ Статистика). Разряды: `regex_replace_text("${amount}", "(?<=[0-9])(?=([0-9]{3})+$)", " ")` (в модулях нет). Полоска: `repeat_text("#", full)` и `repeat_text("-", 10 - full)` (Полосы здоровья).
- **`//` в Xero это комментарий.** В модулях `%math(a//b)` значит целое деление, а `x = a // b` собирается молча и даёт `a`. Пиши `floor(a / b)`.

## Время, сроки, календарь
```kotlin
const UNITS = {"д": 86400, "ч": 3600, "м": 60, "с": 1}
save `день %player%`
save `серия %player%`
func human(seconds: number) {
    line rest = seconds
    line parts = []
    for unit: size in UNITS {
        if rest >= size {
            parts = append_value("${floor(rest / size)}${unit}")
            rest = rest % size
        }
        if len(parts) == 2 { break }
    }
    return join_text(parts, " ")
}
func date_of(ms: number) { return format_timestamp(ms, "yyyy-MM-dd", "GMT+3", "ru_RU", format: custom) }
when player_chat {
    if chat_message_equals("@daily") {
        cancel_event()
        today = date_of(value.timestamp)
        if `день %player%` == today { send_message("&cУже получено"); end_thread() }
        yesterday = date_of(value.timestamp - 86400000)
        if `день %player%` == yesterday { `серия %player%` += 1 } else { `серия %player%` = 1 }
        `день %player%` = today
        send_message("&aДней подряд: ${`серия %player%`}")
    }
}
```
- Награда раз в календарный день сравнивает даты: при кулдауне на 24 часа время игрока уползает. В модулях такого нет. Пояс задавай явно: `GMT+3` у 15 модулей.
- `human(90061)` даёт `1д 1ч`, порядок единиц держит порядок словаря, как `convert` в ᛃ Наказания.
- Срок храни моментом конца, а не остатком. «@ban и @unban на время» раз в минуту уменьшает счётчик, при выключенном мире срок стоит. Моменту конца цикл не нужен: при входе сравни `value.timestamp < until`.
- Просроченное чисти обходом копии ключей: `for nick in get_map_keys(bans)`, внутри `bans = remove_map_entry(map: bans, key: nick)`.
- Точнее секунды: `value.server_current_tick`, 20 в секунду (СОЗДАНИЕ ПАРКУР). Переживает ли счётчик перезапуск, не проверено.

## Много кулдаунов одним словарём
```kotlin
game `кд %player%`: map
func cooldown(name: text, ms: number) {
    line now = value.timestamp
    line until = get_map_value_single(`кд %player%`, name, 0)
    if now < until { return ceil((until - now) / 1000) }
    `кд %player%`[name] = now + ms
    return 0
}
when player_join {
    if not var.exists(`кд %player%`) { `кд %player%` = {} }
}
when player_chat {
    if chat_message_equals("@heal") {
        cancel_event()
        left = cooldown("heal", 30000)
        if left > 0 { send_message("&cЕщё ${left} с"); end_thread() }
        set_health(20)
    }
}
```
Модули заводят по переменной на кулдаун. Функция проверяет и взводит сразу, копии проверки не разъедутся. При выходе словарь не чисти: перезаход снимет кулдаун. Суточным нужен `save`. Точность метки 1 с: `1500` значит 1–2 с.

## Именованные снимки инвентаря
`save_inventory()` хранит один снимок на игрока (40 модулей, 28 в `player_quit`). Несколько наборов:
```kotlin
save `киты %player%`: map
func kit_save(name: text) {
    if not var.exists(`киты %player%`) { `киты %player%` = {} }
    `киты %player%`[name] = value.inventory_items
}
func kit_load(name: text) {
    if name not in `киты %player%` { send_message("&cНет набора"); return }
    clear_inventory()
    for slot, stored in `киты %player%`[name] {
        if var.is_type(stored, item) { set_slot_item(stored, slot) }
    }
}
```
У `save_inventory` своя ошибка «Слишком много попыток сохранения инвентаря»: в цикле не зови.

## Очередь
```kotlin
const LOG_SIZE = 50
game jobs: list
save log: list
process worker() {
    forever {
        wait(1s)
        if list_is_empty(jobs) { continue }
        jobs = remove_list_value_at_index(job, jobs, 0)
        log = append_value(job)
        if len(log) > LOG_SIZE { log = remove_list_value_at_index(list: log, index: 0) }
        @all send_message("&7В работе: ${job}")
    }
}
when world_start {
    jobs = []
    if not var.exists(log) { log = [] }
    start worker(target_mode: no_target)
}
when player_chat {
    if chat_message_equals("@join") {
        cancel_event()
        if value.name not in jobs { jobs = append_value(value.name) }
        send_message("&eМесто: ${get_list_index_of_value(jobs, value.name) + 1}")
    }
}
when player_quit {
    jobs = remove_list_value(jobs, value.name, remove_mode: all)
}
```
- Первый аргумент получает вынутое (MAPI, АУКЦИОН). Без него только именами, как в `log`: два позиционных не соберутся.
- Вне очереди: `insert_list_value(q, 0, x)` (9 модулей). Стек: индекс `len(q) - 1`.
- Журналу предел ставь сразу. ✉ FEEDBACK отказывает при переполнении и считает лимит на игрока, а не ждёт ошибки сервера.

## Случайный выбор
| Задача | Как | Модулей |
|:--|:--|:--|
| целое | `random_number(1, 6)` | 83 |
| шанс 15 % | `if random_number(1, 100) <= 15` | 7 |
| одно из перечисленных, до 21 | `random(["a", "b"])` | 73 |
| из списка | `get_list_random_value(l)` | 45 |
| ключ и значение | `get_map_random_entry(k, v, m)` | нет |
| N разных | `trim_list(randomize_list_order(l), 0, n)` | 10 перемешивают |

Веса накопленной суммой (КАСТОМ КЕЙСЫ, 504 установки):
```kotlin
const LOOT = {"stone": 70, "iron_ingot": 25, "diamond": 5}
func pick(table: map) {
    line total = 0
    for name: weight in table { total += weight }
    line left = random_number(0, total, integer: false)
    for name: weight in table {
        left -= weight
        if left <= 0 { return name }
    }
    return name
}
when player_chat {
    if chat_message_equals("@loot") {
        cancel_event()
        give_items(pick(LOOT))
    }
}
```
КАСТОМ КЕЙСЫ держит шансы и награды двумя списками, они разъезжаются от одной правки. Для предметов бери список пар `[предмет, вес]`. Повтор значений в `random([...])` (Генерация по перлину) годится на 3–5 вариантов.

## Кодирование в текст
```kotlin
when player_right_click {
    if not item_has_tag(value.main_hand_item, "item_id", "rune") { end_thread() }
    data = parse_json(get_item_custom_tag(value.main_hand_item, "data", "{}"))
    data["level"] += 1
    set_slot_item(set_item_custom_tag(value.main_hand_item, "data", to_json(data)), value.held_slot)
    send_message("Уровень ${data["level"]}")
}
```
| Где | Чем | Откуда |
|:--|:--|:--|
| тег предмета, только текст | `to_json`, `parse_json` | Кастомные зачарования, АУКЦИОН |
| плоская запись в строке | `join_text(parts, SEP)`, `split_text(s, SEP)` | ⚡ Лучший модуль на Логи, `<%%%>` |
| Base64 | `text_to_bytes`, `code_bytes(b, codec: base64_decode)`, `bytes_to_text` | Epicfail0003/sprite |
| отпечаток | `hash(s, algorithm: sha256)` | Fast Jukebox |

- Разделитель не должен встретиться в данных: `;` игрок введёт сам. JSON экранирует сам. После `split_text` всё текст, числа верни через `add`.
- Умолчание `"{}"` убирает проверку первого раза. АУКЦИОН после `parse_json` переводит значения в числа, а предметы заранее в текст: сохраняются ли виды в JSON, не проверено.

## Границы: незаданное и пустое
| Запись | Итог | Откуда |
|:--|:--|:--|
| `"${x}"` незаданной | `0` | `tests/start.json` |
| `get_list_value(l, i, d)` за концом | `d` | 30 модулей |
| `set_list_value` за концом | ошибка | `SERVER.md` |
| `get_list_index_of_value` без находки | -1 | `SERVER.md` |
| деление на 0 в формуле | 0 | `LANGUAGE.md` |
| `list_is_empty(x)` незаданной | работает | справочник |
| `l[i]` за концом, `len` и `for` по незаданной | не проверено, ставь проверку | |

- Первый запуск: `game` готовь в `world_start`, `save` под `if not var.exists(x)` (68 модулей). `var.is_type(x, array)` (29) лечит ещё и чужой вид значения.
- Список меняется только присваиванием: `q = remove_list_value(q, x)`, без `q =` не соберётся.
- Удалять из списка в его же обходе модули не боятся (10 модулей), но это не проверено. Надёжно: обход копии.

## Сколько можно хранить
- Потолки сервера: список 20 000 значений, словарь 10 000, дальше ошибка («Список достиг лимита»). Текст обрезается молча на 25 000 символов: `split_text(repeat_text(…))` дал 12 501 значение без ошибки (проверено, dt15). Предела на сумму `save` в локализации нет, 5 МБ относится к коду модуля.
- Без конца растёт то, что копится по игрокам и событиям: журналы, реестр ников, `save` по нику после ухода игрока. Предел или чистка нужны сразу, чистка точным именем: `purge` с `name_contains` заденет чужие ники.
- Обход тысяч значений упрётся в лимит итераций: выноси в `start`, отдавай тик по счётчику (`loops-ui.md`).
