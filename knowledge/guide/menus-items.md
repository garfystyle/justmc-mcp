# Меню инвентаря и предметы

Цифры — по 486 модулям каталога: меню показывают 85, клик ловят 75. Где код ниже расходится с модулями, сказано почему.

## Меню с кнопками
Схема: `const` на кнопку, тег на кнопке, `custom_id` на меню, свой `when` на меню с ранним выходом. Несколько `when player_click_inventory` в файле — норма: каждый идёт отдельной строкой, `end_thread()` останавливает только её.
```kotlin
const INFO = item(book, name: "&eИнфо", tags: {btn: "info"})
const EXIT = item(barrier, name: "&cЗакрыть", tags: {btn: "exit"})
func open_main() {
    show_inventory_menu(name: "&2Главное меню", custom_id: "main")
    set_inventory_menu_item(INFO, 4)
    set_inventory_menu_item(EXIT, 22)
}
when player_click_inventory {
    if value.open_inventory_custom_id != "main" { end_thread() }
    cancel_event()
    if item_has_tag(value.event_item, "btn", "info") { send_message("Слот ${value.event_slot}") }
    if item_has_tag(value.event_item, "btn", "exit") { close_inventory() }
}
when player_click_own_inventory {
    if value.open_inventory_custom_id == "main" { cancel_event() }
}
```
- `custom_id` — третий аргумент `show_inventory_menu`, читается `value.open_inventory_custom_id`. Заголовок сравнивают 43 модуля (`==` — 24), id — 4. Бери id: цвет и `%player%` в названии ему не мешают, а заголовок с цветом модули чистят `clear_color_codes` или ищут `text_contains`.
- `cancel_event()` — сразу после проверки меню, иначе игрок унесёт кнопку (есть в 69 из 75 модулей). Нижнюю половину окна ловит другое событие, `player_click_own_inventory`: без него shift-клик кладёт предмет в меню (КАСТОМ КЕЙСЫ и АУКЦИОН закрывают её целиком).
- Слоты с нуля, слева сверху; `value.event_slot` и `set_inventory_menu_item` считают одинаково. По слоту сравнивай, если кнопка меняет вид: `if value.event_slot == 22`.
- `event_item_equals(INFO)` (46 из 75 модулей) работает, но сравнивает предмет целиком, см. «Свой предмет». Клик по пустой клетке тоже приходит: перед разбором предмета модули ставят `item_has_tag` или `var.is_type(value.event_item, item)`.
- Плотная раскладка — сеткой, редкие кнопки — слотами: `show_inventory_menu([_, _, _, _, item(stone)], "Имя", "id")`, `_` — пустая клетка. Тип окна: `inventory_type: hopper` (5 слотов), `dispenser` (9), без него сундук на 27. Следующее меню открывай прямо из клика (16 модулей). Вид клика: `value.event_inventory_click_type == "right"` (`left`, `shift_left`, `shift_right`, `drop`, `number_key`…).

## Страницы и шесть рядов
```kotlin
const ARROW = item(arrow, name: "&eСтраница")
const PAGE_TAG = "page"
when world_start {
    game list_goods = []
    for i in 1..50 { list_goods = append_value(set_item_name(item(paper), "Товар ${i}")) }
}
func open_list(page) {
    show_inventory_menu(name: "Товары, стр. ${page + 1}", custom_id: "list")
    expand_inventory_menu(size: 3)
    for i in 0..44 {
        goods_index = page * 45 + i
        if goods_index < len(list_goods) { set_inventory_menu_item(list_goods[goods_index], i) }
    }
    if page > 0 { set_inventory_menu_item(set_item_custom_tag(ARROW, PAGE_TAG, page - 1), 45) }
    if (page + 1) * 45 < len(list_goods) { set_inventory_menu_item(set_item_custom_tag(ARROW, PAGE_TAG, page + 1), 53) }
}
when player_click_inventory {
    if value.open_inventory_custom_id != "list" { end_thread() }
    cancel_event()
    if item_has_tag(value.event_item, PAGE_TAG) { open_list(get_item_custom_tag(value.event_item, PAGE_TAG)) }
}
```
- `expand_inventory_menu` прибавляет к сундуку ряды: всего шесть, слоты 0–53. Сервер ждёт ровно 27 клеток, хвост компилятор дополняет сам: `expand_inventory_menu(size: 3)`, `expand_inventory_menu([item(stone)], size: 3)`.
- Номер страницы лежит в теге кнопки: нет переменной на игрока, нечего сбрасывать, стрелка видна, только если страница есть. Модули держат `` `%player%_page` `` (DNBS, КАСТОМ КЕЙСЫ): работает, но её надо обнулять при каждом открытии.
- Менять открытое меню, не открывая заново: `set_inventory_menu_item(предмет, слот)`, очистить клетку — `set_inventory_menu_item(slot: i)`, название — `set_inventory_menu_name("…")` (DNBS). Меньше трёх рядов: `remove_inventory_menu_row(1, position: button)`, `button` — нижний ряд (АУКЦИОН).

## Магазин с ценами
Цена написана один раз и лежит в теге, все товары идут через один обработчик: так Collumy/zavod (тег `cost`). mrvinagrad/SHOP пишет `if event_item_equals(…)` на товар и копирует `item(…)` дважды: не повторять.
```kotlin
const PRICE_TAG = "price"
save `shop_coins %player%`
func add_good(good: item, price: number, slot: number) {
    card = set_item_lore(good, "&7Цена: &e${price}")
    set_inventory_menu_item(set_item_custom_tag(card, PRICE_TAG, price), slot)
}
func open_shop() {
    show_inventory_menu(name: "Магазин", custom_id: "shop")
    add_good(item(iron_sword, name: "&fМеч"), 50, 11)
    add_good(item(bread, 8, name: "&fХлеб"), 5, 15)
}
when player_click_inventory {
    if value.open_inventory_custom_id != "shop" { end_thread() }
    cancel_event()
    if not item_has_tag(value.event_item, PRICE_TAG) { end_thread() }
    price = get_item_custom_tag(value.event_item, PRICE_TAG)
    if `shop_coins %player%` < price { send_message("&cНе хватает монет"); end_thread() }
    `shop_coins %player%` -= price
    give_items(set_item_lore(remove_item_custom_tag(value.event_item, PRICE_TAG)))
    send_message("&aКуплено, осталось ${`shop_coins %player%`}")
}
```
- Перед выдачей снимай служебное: `remove_item_custom_tag`, `set_item_lore(x)` без текста очищает описание. Для полного инвентаря до списания проверь `if not has_room_for_item(x) { … }`. Плата предметами: `const PAY = item(emerald, 5)`, затем `if has_item_at_least(PAY, 5) { remove_items(PAY) }`: снимается столько, сколько в стеке значения. В корпусе `has_item_at_least` нет, там `has_item(x, comparison_mode: ignore_stack_size)` и снятие по одному (guns2).

## Свой предмет: как отличать
- **Тег** — лучший способ: `item(blaze_rod, name: "&6Жезл", tags: {item_id: "wand"})`, проверка `item_has_tag(value.main_hand_item, "item_id", "wand")`. Не зависит от количества, прочности, лора и переименования (StarGuns, WorldEdit, АУКЦИОН; 14 модулей).
- **Предмет целиком**: `is_holding(WAND)` (137 модулей), `event_item_equals(WAND)` (75), `has_item`, `item_equals`. Без `comparison_mode` действует «Полное сравнение»: стак из 5 не равен `item(diamond)`. Поэтому режим задан явно в 192 из 381 `is_holding` и в 153 из 361 `event_item_equals`.
- Режимы: `ignore_stack_size` — без количества, `ignore_durability_and_stack_size` — ещё и без прочности (оружие, инструменты), `type_only` — только тип. Рука: у `is_holding` по умолчанию любая, `hand_slot: main_hand` — ведущая (39 модулей).
- Тег на лету: `x = set_item_custom_tag(предмет, "k", "v")`; чтение `get_item_custom_tag(предмет, "k", умолчание)`; `item_has_tag(предмет, "k")` без значения проверяет наличие. Числа из тегов идут в сравнения и формулы (StarGuns: `ammo`, Collumy/zavod: `cost`).
- Имя и лор на лету: `x = set_item_name(предмет, "Товар ${i}")`, `x = set_item_lore(предмет, "…")`: внутри `item(…)` `${…}` не подставляется.

## Способность на ПКМ с кулдауном
Обычная задержка, полоска на предмете (проверка и установка вместе — 54 модуля):
```kotlin
const WAND = item(blaze_rod, name: "&6Жезл", tags: {item_id: "wand"})
when player_right_click {
    if not item_has_tag(value.main_hand_item, "item_id", "wand") { end_thread() }
    cancel_event()
    if item_is_not_on_cooldown(WAND) {
        set_item_cooldown(2s, WAND)
        remove_items(item(arrow))
        send_message("Выстрел")
    }
}
```
- `cancel_event()` нужен предметам со своим действием: блок, голова, еда, лук. Задержка общая на весь тип предмета (описание сервера): два жезла на `blaze_rod` делят её.
Метка времени — своя задержка на способность и текст «ещё N с»; с `save` вместо `game` переживёт перезапуск. Незаданная переменная обнуляет формулу, поэтому в первый раз `left` равен 0. В обработчиках ПКМ корпуса этого нет (`value.timestamp` есть в 16 модулях, в основном сроки банов; Collumy/zavod считает `value.timestamp - was`), зато способности на одном типе предмета не мешают друг другу.
```kotlin
when player_right_click {
    if not item_has_tag(value.main_hand_item, "item_id", "dash") { end_thread() }
    left = `dash_ready %player%` - value.timestamp
    if left > 0 { send_message("&cЕщё ${ceil(left / 1000)} с"); end_thread() }
    game `dash_ready %player%` = value.timestamp + 3000
    send_message("Рывок")
}
```

## Состояние внутри предмета
Заряды, патроны и прочее состояние — в теге (StarGuns: `ammo`, Игровые карты: `hide`). Действия над предметом дают новый предмет и руку не меняют: результат кладут обратно `set_slot_item(x, value.held_slot)`, `value.held_slot` — от 0 до 8.
```kotlin
const STAFF = item(stick, name: "&bПосох", tags: {item_id: "staff", charges: "3"})
when player_right_click {
    if not item_has_tag(value.main_hand_item, "item_id", "staff") { end_thread() }
    left = get_item_custom_tag(value.main_hand_item, "charges", 0)
    if left <= 0 { end_thread() }
    left -= 1
    hand = set_item_custom_tag(value.main_hand_item, "charges", left)
    set_slot_item(set_item_lore(hand, "&7Зарядов: ${left}"), value.held_slot)
    send_message("Осталось ${left}")
}
```

## Наборы и слоты
```kotlin
const SWORD = item(iron_sword, name: "&fМеч набора", unbreakable: true)
func give_kit() {
    clear_inventory()
    set_items([
        _, _, _, _, _, _, _, _, _,
        _, _, _, _, _, _, _, _, _,
        item(arrow, 32), _, _, _, _, _, _, _, _,
        SWORD, item(bow), _, _, _, _, _, _, item(bread, 16),
    ])
    set_armor(item(iron_helmet), item(iron_chestplate), item(iron_leggings), item(iron_boots))
}
```
- Сетка `set_items` — 36 клеток, нижний ряд (27–35) — хотбар: клетку 31, середину хотбара, заполняют 34 модуля, Машинки кладут кнопки в 31, 33, 35. Хвост пустых клеток можно не писать, `_` в середине обязателен: без него предметы съедут.
- Один предмет в точный слот: `set_slot_item(x, слот)`: 0–8 хотбар, 9–35 основной инвентарь, 36–39 броня (ПросмотрИнвентаря). `give_items([a, b])` кладёт в свободные места, до 17 значений.
- Неснимаемый предмет (Очередь): `when player_drop_item { if item_has_tag(value.event_item, "locked", "yes") { cancel_event() } }`, то же в `player_click_own_inventory`, а в `player_swap_hands` проверяй `value.main_hand_item`.

## Сохранить и вернуть инвентарь
Выход и вход (15 модулей): `when player_quit { save_inventory() }`, `when player_join { load_inventory() }`. На время мини-игры (Машинки, СОЗДАНИЕ ПАРКУР): `save_inventory()`, `clear_inventory()`, на выходе `load_inventory()`. Без сохранения `load_inventory()` очистит инвентарь (описание сервера). Вещи при смерти держит `set_inventory_kept(kept: true)`.
Несколько снимков — списком в переменной. `value.inventory_items` — 41 значение, индекс равен слоту `set_slot_item`, пустые клетки — не предметы, отсюда проверка:
```kotlin
func remember_inventory() { save `kit_snapshot %player%` = value.inventory_items }
func restore_inventory() {
    clear_inventory()
    for slot, stored in `kit_snapshot %player%` {
        if var.is_type(stored, item) { set_slot_item(stored, slot) }
    }
}
```

## Рюкзак
```kotlin
func open_bag() {
    show_inventory_menu(name: "Рюкзак %player%")
    if var.exists(`bag_items %player%`) {
        for slot, stored in `bag_items %player%` {
            if var.is_type(stored, item) { set_inventory_menu_item(stored, slot) }
        }
    }
}
when player_close_inventory {
    if value.open_inventory_title == "Рюкзак %player%" { save `bag_items %player%` = value.custom_inventory_items }
}
```
- «Рюкзаки!» копирует пару функций на каждый размер: не повторять, размер — только `inventory_type: hopper` или `dispenser`. Клики здесь не отменяй: игрок сам кладёт предметы. В закрытии меню заголовок проверен модулями (Рюкзаки!, ⚔ ᴄᴜꜱᴛᴏᴍ ᴄʀᴀꜰᴛꜱ), поэтому сравнение по нему.
- В клике `value.custom_inventory_items` читай после `wait(1)` (ᴊᴜꜱᴛɪɴᴠꜱᴇᴇ, ПросмотрИнвентаря), а `value.event_slot` до `wait` скопируй в переменную. Индекс списка равен слоту меню.

## Рецепт крафта
```kotlin
when world_start {
    add_custom_crafting_recipe("ruby_sword", item(diamond_sword, name: "&cРубиновый меч"), [
        _, item(emerald), _,
        _, item(emerald), _,
        _, item(stick),   _,
    ], recipe_type: shaped)
}
```
- Ставь в `world_start`; `_` держит форму сетки 3×3. Настоящий верстак: `open_working_menu("Верстак", menu_type: crafting)`. Книга рецептов: `show_custom_recipe("ruby_sword")`, проверка `has_custom_recipe("ruby_sword")`, удаление `remove_custom_recipe("ruby_sword")`. Сравнение ингредиента задают `recipe_match_slot_1`…`9`: `exact`, `item_type`, `custom_tags_contains` и другие.
- Модули этих действий не знают (появились 16.10.2026, 0 использований) и опрашивают окно в цикле: `inventory_menu_slot_equals` (Создание кастомных рецептов), `value.custom_inventory_items` (⚔ ᴄᴜꜱᴛᴏᴍ ᴄʀᴀꜰᴛꜱ). Не копируй: это поток на каждого игрока.

## Частые ошибки
- `return` в `when` заканчивает срабатывание, в `func` выходит из функции. `end_thread()` из функции остановит всю строку, которая её вызвала.
- Нет `cancel_event()` в клике или нет `player_click_own_inventory` рядом с меню.
- `is_holding(item(iron_sword))` без режима: стак, потраченная прочность и лишний лор не совпадут. Для своих предметов бери тег.
- Длинный `item(…)` повторён в выдаче, проверке и задержке. Один `const` на предмет.
- `set_item_lore(x, "…")` то же, что `x = set_item_lore(x, "…")`; в руке новый предмет появится только после `set_slot_item`.
- Локальная переменная из `player_chat` в `player_click_inventory` пуста. Между событиями — тег кнопки или `` game `имя %player%` ``.
- `raw("{}")`, `item("AAAAAAAAAAA=")`, `num("30.0")`, `raw("{\"action\":\"start_process\"…")` в коде модулей — следы перевода. Пиши `_`, `30`, `start имя()`.
