# Мобы, НПС, боссы

Основа в `combat-entities`: цели, выборка, NPC с тегом, подпись над мобом, езда. Цифры по 1075 модулям. Рецепты прогнаны на сервере 04.11.2026: 10 из 15, часть упала от мобов прошлых рецептов. Источник в скобках, «(в модулях нет)» значит по справочнику. На `@killer` после `entity.damage` из кода не рассчитывай: рецепт mb14 награды не получил, проверяй настоящим ударом.

## Спавн и настройка
```kotlin
func spawn_guard(at: location) {
    spawn_mob(
        mob: item(husk_spawn_egg), location: at, health: 40, custom_name: "&cСтраж",
        main_hand: item(iron_sword), helmet: item(iron_helmet), potion_effects: [potion(speed)],
    )
    @last set_custom_tag("role", "guard")
    @last set_despawning(despawning: false)
    @last entity.set_death_drops(drops: false)
    @last entity.set_attribute(6, attribute_type: generic_attack_damage)
    @last entity.set_attribute(1.5, attribute_type: generic_scale)
}
```
- Ещё аргументы: `off_hand`, `chestplate`, `leggings`, `boots`, `natural_equipment`. Зелье без `duration` бесконечно. После спавна: `set_equipment_item(item(bow), slot: hand)`, `set_armor_items(...)`, `entity.set_max_health(300, heal_to_max: true)`, `set_current_health(n)`, `entity.heal(n)`.
- Атрибуты в ходу: `generic_scale` (10 вызовов), `generic_movement_speed` (5; 0.75 у бегуна `nextbot`), `generic_step_height` 2 шагает через блоки, `generic_burning_time` 0 против солнца (`nextbot`). `husk` днём не горит сам.
- `set_despawning(despawning: false)` ставят долгоживущим (`herobrine`, `drochka_sim`). Толпа в одной клетке давит сама себя: `set_world_gamerule("100", gamerule: max_entity_cramming)` (`frog_rog`).

Всех мобов вида, включая яйца и спавнеры, настраивает событие (`entity_spawn` в 31 модуле):
```kotlin
when entity_spawn {
    if not entity.is_type(item(zombie_spawn_egg)) { end_thread() }
    entity.set_attribute(random_number(0.7, 1.3, integer: false), attribute_type: generic_scale)
    entity.set_death_drops(drops: false)
}
```
- Без цели здесь сам моб. Имя уже видно (19 обработчиков), а тег ставится блоком после `spawn_mob`: тег проверяют после `wait(1)` (`ball`).
- Запрет естественных мобов: `if spawn_reason_equals(reason: natural) { cancel_event() }` здесь же или `set_world_gamerule("false", gamerule: do_mob_spawning)` (в модулях нет).

## Найти своих
| Ключ | Запись | Когда |
|:--|:--|:--|
| Тег | `entity_by_conditional(has_custom_tag("role", "guard"))` (35 модулей) | группа; имя видно игрокам и меняется |
| UUID | `id = @last value.uuid`, потом `entity_by_name(id)` | один моб: босс, питомец |
| Имя | `entity_by_name(x)` (109), `mob_by_name(x)` (41) | простой случай |

- Несколько сразу: `entity_by_name(["a", "b"])`. `mob_by_name` не берёт визуализаторы с тем же именем. Цветное имя ищут той же строкой с кодами: `mob_by_name("&b&l[SHOP]")` (7 модулей).
- Есть ли кто: `value.selection_size == 0` надёжнее `if entity.exists()`, у которого в событии сущности есть свой участник.
- `has_custom_tag("orbital")` с одним аргументом: тег есть, значение любое (`OSC`).

Состояние моба держи в теге: уходит вместе с ним, а `` `%entity_uuid% x` `` останется до перезапуска.
```kotlin
when player_damage_entity {
    if not @victim has_custom_tag("role", "guard") { end_thread() }
    hits = @victim get_custom_tag("hits", 0)
    @victim set_custom_tag("hits", hits + 1)
}
```
Второй аргумент `get_custom_tag` вернётся, если тега нет. Снять: `remove_custom_tag("hits")`.

## Поведение
| Нужно | Действие | Модулей |
|:--|:--|:-:|
| Замереть | `set_ai(ai: false)` | 41 |
| Без ИИ, но падать и толкаться | `set_aware(aware: false)` | 1 |
| Идти в точку | `move_to_location(место, 1)`, стоп `move_to_location_stop()` | 2 |
| Напасть | `set_target(uuid)`, снять `set_target()` | 6 |
| Смотреть | `entity.face_location(место)` | 9 |

Враждебный моб цель ищет сам, дальность задаёт `generic_follow_range`. `set_target` нужен, когда цель решает код: союзник (`SummonMob`), зомби против жителей (`Zaragenie`). Текущая цель: `@current value.targeted_entity`.

Патруль (приказ есть у `AI_cheat`, цикл по маршруту написан здесь):
```kotlin
game route: list

func walk_to(mob_id: text, point: location) {
    entity_by_name(mob_id)
    @current move_to_location(point, 1)
    repeat 120 {
        wait(10)
        entity_by_name(mob_id)
        if value.selection_size == 0 { return "gone" }
        if @current is_near_location(1.5, point) { return "ok" }
    }
    @current entity.teleport(point)
    return "ok"
}
process patrol(mob_id: text) {
    forever {
        for stop in route {
            state = walk_to(mob_id, stop)
            if state == "gone" { return }
            wait(2s)
        }
    }
}
```
- Запуск: `route = [loc(10, 64, 0), loc(10, 64, 20)]`, `start patrol(@last value.uuid, target_mode: no_target)`.
- Приказ не сообщает о приходе: `is_near_location` опросом. Вышел срок — телепорт, иначе застрявший держит патруль.
- `set_ai(ai: false)` выключает и поход, и цель: патрульному его не ставь.
- `set_pathfinder_settings(can_float: true, can_open_door: true, can_pass_door: false)`, значения ещё `not_set` (один модуль, `htyhthrty`). Маркер `navigation_type`: `default`, `ground`, `flying`, `water_bound`, `amphibious`, `spider`, `climber`.
- `has_available_path()` без аргументов, сундука у него нет: смотрит на текущую точку или цель, поэтому сначала приказ, потом условие (в модулях нет).
- `value.entity_pathfinder_points` — точки маршрута, `value.entity_pathfinder_point_index` — текущая (в модулях нет).

Свой поток на моба (20 из 51 обработчика `entity_spawn`):
```kotlin
when entity_spawn {
    if not entity.name_equals("&cОхотник") { end_thread() }
    while @default entity.exists() {
        wait(10)
        all_players()
        filter_by_conditional(not gamemode_equals(gamemode: spectator))
        filter_by_distance(value.location, 1)
        @default set_target(@current value.uuid)
    }
}
```
`value.location` здесь моб: значение за выборкой не идёт. Условие идёт, поэтому `@default`: `bappukaga` пишет `while entity.exists()`, а в выборке к тому времени игроки. Для десятков мобов нужен один цикл мира с выборкой по тегу (предел `too_many_processes_active`).

## НПС с диалогом
Реплика на клик: номер у игрока, никаких `wait`, частые клики ничего не ломают.
```kotlin
const AGREE_BUTTON = item(lime_dye, name: "&aПомогу", tags: {btn: "yes"})
const REFUSE_BUTTON = item(barrier, name: "&cНет", tags: {btn: "no"})

game `реплика %player%`
save `квест %player%`

when player_right_click_entity {
    if not @victim has_custom_tag("npc", "elder") { end_thread() }
    cancel_event()
    @victim entity.face_location(value.eye_location)
    if `квест %player%` == "взят" {
        send_message("&eСтарик: &fЖду тебя с волками.")
        end_thread()
    }
    talk = ["&eСтарик: &fДобрый день.", "&eСтарик: &fВолки режут овец.", "&eСтарик: &fПоможешь?"]
    if not var.exists(`реплика %player%`) { `реплика %player%` = 0 }
    if `реплика %player%` < len(talk) {
        send_message(talk[`реплика %player%`])
        `реплика %player%` += 1
        end_thread()
    }
    `реплика %player%` = 0
    show_inventory_menu(
        [AGREE_BUTTON, _, _, _, REFUSE_BUTTON],
        "&eСтарик", "elder", inventory_type: hopper,
    )
}
when player_click_inventory {
    if value.open_inventory_custom_id != "elder" { end_thread() }
    cancel_event()
    close_inventory()
    if item_has_tag(value.event_item, "btn", "yes") {
        `квест %player%` = "взят"
        send_dialogue(["&eСтарик: &fСпасибо!", "&eСтарик: &fОни в лесу на востоке."], 40)
    }
}
```
- Спавн: `spawn_shop` в `combat-entities`. Скин: `@last disguise_as_player("Ник", "&eСтарик", server_type: server)`.
- Ответы кнопками, как `NPC Creator` (280 установок). `Npc_And_AI1` разбирает чат 26 обработчиками с `text_contains`: опечатка ломает разговор.
- `send_dialogue(список, задержка)` (26 модулей) шлёт реплики сам. Печать по букве (`NPC Creator`): `trim_text(line, 0, i)` в цикле, `send_action_bar`, `wait(1)`, и нужен флаг «диалог идёт», иначе второй клик запустит вторую копию.

## Торговец
Спавн как у НПС, потом `@last clear_merchant_recipes()` и `@last set_merchant_recipe(item(diamond), item(emerald, 5), max_uses: 9999, mode: append)`: товар, цена, третьим вторая цена. Окно обмена игра открывает сама (8 модулей, `Shop` 782 установки), моб — `wandering_trader_spawn_egg`. Жителю сперва `set_villager_profession(profession: armorer)` (`lomai_bloc`). Цена в переменной: магазин из `menus-items`.

## Босс: фазы и полоса
```kotlin
const TAG = "boss"
const ROLE_CORE = "core"
const ROLE_GUARD = "guard"

game boss_id
game boss_phase

func boss_spawn(at: location) {
    entity_by_conditional(has_custom_tag(TAG, ROLE_CORE))
    @current entity.remove()
    spawn_mob(mob: item(wither_skeleton_spawn_egg), location: at, health: 300, custom_name: "&4Страж")
    @last set_custom_tag(TAG, ROLE_CORE)
    @last set_despawning(despawning: false)
    @last entity.set_death_drops(drops: false)
    boss_id = @last value.uuid
    boss_phase = 1
    @all set_boss_bar(TAG, "&4Страж", 100, sky_effect: dark_sky, style: notched_10, color: red)
}
when entity_take_damage {
    if not has_custom_tag(TAG, ROLE_CORE) { end_thread() }
    entity_by_conditional(has_custom_tag(TAG, ROLE_GUARD))
    if value.selection_size > 0 {
        cancel_event()
        end_thread()
    }
    wait(1)
    entity_by_name(boss_id)
    if value.selection_size == 0 { end_thread() }
    hp = @current value.current_health
    top = @current value.max_health
    part = 100 * hp / top
    @all set_boss_bar(TAG, "&4Страж &f${round(hp)}", part, sky_effect: dark_sky, style: notched_10, color: red)
    if boss_phase == 1 and part <= 50 {
        boss_phase = 2
        @all send_title("&4Вторая фаза", "&7Убей охрану", 5, 1s, 5)
        at = @current value.location
        repeat 3 {
            spawn_mob(mob: item(husk_spawn_egg), location: at, custom_name: "&cОхрана")
            @last set_custom_tag(TAG, ROLE_GUARD)
        }
    }
}
when entity_death {
    if not has_custom_tag(TAG, ROLE_CORE) { end_thread() }
    @all remove_boss_bar(TAG)
    @killer give_items(item(netherite_ingot))
    entity_by_conditional(has_custom_tag(TAG, ROLE_GUARD))
    @current entity.remove()
}
```
- Полоса живёт от урона, без опроса. Читать здоровье можно только после `wait(1)`, другой способ без ожидания описан в `effects`. Какой надёжнее на смертельном ударе, на сервере не разобрано, самый простой путь: процесс раз в несколько тиков обновляет полосу сам. В `entity_take_damage` здоровье ещё старое (`AI_cheat`, `healthbars`). За этот тик моб мог умереть, поэтому снова выборка.
- В модулях полоса босса стоит на 100 (`SvinoBogV3`), здоровье в неё считается здесь. Фаза сравнивается с номером, иначе блок сработает на каждом ударе.
- Щит на время охраны: `cancel_event()`. `SvinoBogV3` ставит `entity.set_invulnerability_ticks(9999999)`, такой щит переживает охрану.
- `sky_effect` передавай при каждом обновлении. Вошедшему в бою: `set_boss_bar` в `player_join`.
- Удары по таймеру: `process`, цикл как у `follow` ниже.
- `@killer` один (`AI_cheat`). Награда всем: копи ники из `player_damage_entity` в `game hitters: list`.
- Босса убрал код: `entity_death` не будет, полосу сними там же. Спавн на `player_kill_mob` с `wait(200, seconds)` (`s123`) даёт босса за каждое убийство.

### Уроки живого боя

- Здоровье моба упирается в 1024 молча: это ванильный предел атрибута. Полоса босса считается своей переменной.
- Клиент не видит моба дальше примерно 48 блоков: `see entities` и бот теряют цель, это не значит, что она умерла.
- Прогон с бессмертием не доказывает проходимость: нужен прогон без него. Незерит срезает около 3/4 урона `player.damage`, удар 9 снимает 2.4, поэтому `armor` смотри в `player state`.
- Атрибуты пиши с приставкой `generic_`: голые `movement_speed`, `max_health`, `armor` и ещё 10 собираются, но сервер останавливает строку `Enum … value not found` и у игрока, и у сущности (07.11.2026).

Босс проверен ботом и живым игроком 05.11.2026.

- **Честность атак считай числами.** Спринт 5.6 блока в секунду: луч со скоростью 9.5 увернуться не даёт. Всё, от чего надо убегать, медленнее 5.
- **Босс на точке возрождения = петля смертей.** Игрок стоит на экране загрузки и умирает снова. Возрождай на дальнем краю арены и давай защиту на несколько секунд в `player_respawn`.
- **Броня срезает урон `player.damage`.** Незерит (броня 20) оставляет примерно четверть: удар 9 снимает 2.4. Проверяй урон в том снаряжении, которое получает игрок. Бот без брони и игрок в ней видят разный бой.
- **Перед ударом показывай, куда он придёт.** Метка на земле и заголовок дают увернуться, поэтому удар может быть сильным.
- **Кооп:** босс держит одну цель и меняет её только между атаками. Запас здоровья растёт с числом игроков.
- **Проверка боя:** готовый бот `fight-bot` в `script` кружит, стреляет, ест и уворачивается от меток. Честный бой длится минуты, поэтому запускай его с `background` и жди через `script` действие `wait`.

## Питомец
Волк, кошка, попугай следуют сами: `@last set_tame(value.name)` (`OSC`). Остальных ведёт код (в модулях нет, `Pigmini` и `mirror` лишь телепортируют каждый тик):
```kotlin
process follow(mob_id: text) {
    entity_by_name(mob_id)
    while value.selection_size > 0 {
        gap = locations_distance(@current value.location, value.location)
        if gap > 12 {
            @current entity.teleport(value.location)
        } else if gap > 3 {
            @current move_to_location(value.location, 1.3)
        } else {
            @current move_to_location_stop()
        }
        wait(10)
        entity_by_name(mob_id)
    }
}
func pet_remove() {
    entity_by_conditional(has_custom_tag("owner", value.name))
    @current entity.remove()
    reset()
}
when player_join {
    pet_remove()
    spawn_mob(mob: item(fox_spawn_egg), location: value.location, custom_name: "&aЛис %player%")
    @last set_custom_tag("owner", value.name)
    @last set_invulnerable(invulnerable: true)
    start follow(@last value.uuid)
}
when player_quit {
    pet_remove()
}
```
- Процесс без `target_mode` оставляет игрока целью: `value.location` — хозяин, `@current` — питомец. Цикл кончается сам, когда питомца убрали.
- Защита хозяина: в `entity_damage_player` выбери питомца и `@current set_target(@damager value.uuid)`.

## Маскировка
База в `combat-entities`. Мобу ещё: `entity.disguise_as_block(block(stone))` (10 модулей), `entity.disguise_as_entity(item(cat_spawn_egg))` (7), снять `entity.remove_disguise()`.
- Повадки остаются от настоящего моба: `skeleton` стреляет за бота (`AI_cheat`), под статичный скин берут `villager` (5 случаев).
- Искать по-прежнему по `custom_name`, `display_name` только показ: `mirror` показывает ник, а ищет `"%player%имитация 1"`.
- Камень-моб для пряток и разбор в `entity_death` по `entity.is_disguised()` (`Pryatki`), лежачее тело: `entity.set_pose(pose: sleeping)` со скином игрока (`sit_lay`).

## Волны
```kotlin
const TAG = "wave"
const ARENA_CORNER = loc(-20, 64, -20)
const ARENA_FAR_CORNER = loc(20, 64, 20)

game wave
game wave_on

func spawn_wave(count: number) {
    repeat count {
        while value.cpu_usage >= 70 { wait(1) }
        line spawn_point = random_location(ARENA_CORNER, ARENA_FAR_CORNER)
        spawn_mob(mob: item(husk_spawn_egg), location: spawn_point, health: 10 + wave * 2, custom_name: "&cЗомби")
        @last set_custom_tag(TAG, "mob")
        @last set_despawning(despawning: false)
        @last entity.set_death_drops(drops: false)
        wait(2)
    }
}
process run_waves() {
    wave = 0
    wave_on = 1
    while wave_on == 1 {
        entity_by_conditional(has_custom_tag(TAG, "mob"))
        left = value.selection_size
        if left == 0 {
            wave += 1
            @all send_title("&cВолна ${wave}", "", 5, 1s, 5)
            wait(3s)
            spawn_wave(2 + wave * 2)
        }
        @all set_boss_bar(TAG, "&cВолна ${wave} &7осталось &f${left}", 100, style: notched_10, color: red)
        wait(1s)
    }
    entity_by_conditional(has_custom_tag(TAG, "mob"))
    @current entity.remove()
    @all remove_boss_bar(TAG)
}
```
- Запуск: `start run_waves(target_mode: no_target)`, конец: `wave_on = 0`, цикл сам уберёт мобов. Лобби и выбывание: «Мини-игра» в `loops-ui`.
- Основа `frog_rog`: живых считает опрос. Счётчик на `entity_death` расходится с миром, если моба удалили. Но `all_mobs()`, как там, считает и НПС, и чужих: нужен тег.

## Свой дроп
```kotlin
when entity_death {
    if not has_custom_tag("loot", "zombie") { end_thread() }
    roll = random_number(0, 100, integer: false)
    if roll < 5 {
        spawn_item(value.location, item(diamond))
    } else if roll < 40 {
        spawn_item(value.location, item(iron_ingot, 2))
    }
    @killer give_random_item([item(cooked_beef), item(bread, 3)])
}
```
- Обычную добычу снимает `entity.set_death_drops(drops: false)` на спавне (9 модулей) или `set_world_gamerule("false", gamerule: do_mob_loot)` на весь мир (в модулях нет).
- `entity_death` срабатывает при любой смерти, `value.location` — моб (`bappukaga`). `player_kill_mob` (5 модулей) только от игрока: без цели там игрок, место `@victim value.location` (`CustomDrop`, там же таблица шансов словарём).
- `cancel_event()` в `entity_death` оставляет моба живым: так `trups` делает трупы.

## Уборка
Мобы переживают перезапуск мира (проверено), без уборки копии растут с каждым `/build`.
```kotlin
when world_start {
    entity_by_conditional(has_custom_tag("mod", "arena"))
    @current entity.remove()
}
when entity_removed_from_world {
    entity_by_conditional(has_custom_tag("dependency", @default_entity value.uuid))
    if value.selection_size > 0 {
        @current entity.remove()
    }
}
```
- Один тег на всё своё и чистка в `world_start` (39 модулей). `world_stop` (27) только в придачу. Игроку: `player_quit` (51).
- Второй `when` убирает детей: подписи, сиденью, охране ставь `set_custom_tag("dependency", id_родителя)`, и смерть или удаление родителя снесёт их (`EpicCards`). Он идёт на каждую удалённую сущность: при сотнях мобов сперва отсей родителя условием.
- `@all_mobs entity.remove()` (`frog_rog`), `all_mobs()` при `value.cpu_usage >= 95` (`AntiCPU`) снесут и НПС, и чужих мобов: выбирай по тегу.

## Частые ошибки
- В `player_right_click_entity` действие и условие сущности без цели — кликнутый моб (`Coins`, `ball`), значение без цели — игрок. Значение моба: `@victim value.x` или `@default_entity value.x`.
- `mob_by_name` сразу после `spawn_mob` (`NPC`, `Shop`) зацепит всех тёзок, `@last` только нового.
- `set_ai()`, `set_silenced()`, `set_invulnerable()` без маркера берут значение сервера: пиши его явно.
