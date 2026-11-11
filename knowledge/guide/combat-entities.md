# Цели, бой и сущности

## Кто получит действие
| Запись | Кому |
|:--|:--|
| без цели | текущей выборке; выборки нет — участнику события |
| `@default` | игроку события, выборку не видит |
| `@current` | выборке; выборка пуста — никому (на этом держится промах в `das`) |
| `@last` | последней появившейся сущности, выборку не меняет |
| `@victim` `@killer` `@damager` `@shooter` `@projectile` | участникам события |
| `@all` `@all_mobs` `@random` | всему миру, выборку не меняют |

Условие без цели идёт за выборкой, как действие. **Значение без цели — нет:** `value.name`, `value.location`, `%player%` остаются участником события. Поэтому `das` под выборкой пишет `player.damage(3, value.name)`: это имя стрелка. Значение выбранной цели — `@current value.name`.

| Событие | без цели и `%player%` | второй участник |
|:--|:--|:--|
| `player_damage_player` `player_kill_player` | бьющий, убийца | `@victim`, `%victim%` |
| `mob_kill_player` | | `%victim%` — игрок |
| `entity_damage_player` | раненый игрок | `@damager` — моб |
| `player_damage_entity` `player_kill_mob` `player_right_click_entity` | игрок | `@victim`, `%victim%` — сущность, `%entity%` здесь игрок |
| `player_projectile_hit` | стрелок | `@victim` — куда попал |
| `projectile_hit` | снаряд, он же `@projectile` | |
| `entity_death` | сущность, `%entity_uuid%` | `@killer` |

## Выборка
```kotlin
func slap(nick: text) {
    player_by_name(nick)
    if value.selection_size == 0 {
        @default send_message("&cТакого игрока нет")
        return
    }
    @current player.damage(2, value.uuid)
    @default send_message("Ударил %selected%")
}
func call_help() {
    player_by_conditional(not player.name_equals(value.uuid))
    filter_by_conditional(is_near(15, value.location))
    @current send_message("&e%player% зовёт на помощь")
}
```
- Выборка живёт до конца срабатывания, через `wait` тоже, следующее срабатывание начинается без неё. `reset()` нужен, только если дальше в этой же строке снова работает цель события; `das` ставит его последней строкой зря.
- `%selected%`, `%selected_uuid%` — первая цель, `value.selection_target_names`, `value.selection_target_uuids` — все. Переменная другого игрока: `` `монеты %selected%` += 5 ``, вне `when` объявить `` game `монеты %selected%` ``.
- В условии выборки цель без `@` — кандидат, а `value.x` без цели — участник события. Значение кандидата — `@current value.x`: `player_by_conditional(@current value.name in team)` (`queue`). Для сущности сравнение не сработало: `entity_by_conditional(@current value.name == X)` на сервере выбрал 0, а `entity_by_conditional(entity.name_equals(X))` — 1, поэтому имя проверяй условием, компилятор об этом предупредит. `and` и `or` здесь нельзя: второе условие — следующий `filter_by_conditional`.
- `invert()` на сервере моба рядом не выбрал, хотя модули (`fast_pvp`, `guns`) ждут этого: на него не полагайся, бери `all_mobs()` и фильтр. Ближайшая цель: `all_mobs()`, затем `filter_by_distance(value.location, 1, compare_mode: nearest)`.
- Каждому своё: `all_players()`, затем `start bonus(target_mode: for_each_in_selection)`. В процессе `%player%` и цель без `@` — очередной игрок.

## PvP и режим боя
```kotlin
game `бой %player%`
game `бой %victim%`
when player_damage_player {
    `бой %player%` = value.timestamp
    `бой %victim%` = value.timestamp
}
when player_quit {
    if var.exists(`бой %player%`) and value.timestamp - `бой %player%` < 15000 {
        player.damage(9999)
    }
}
```
`antirelog` гоняет на каждого игрока цикл с вычитанием по тику, метке времени цикл не нужен. `var.exists` обязателен: незаданная переменная обнуляет формулу, и `0 < 15000` убило бы того, кто не дрался. Свои: `` if `команда %player%` == `команда %victim%` { cancel_event() } ``; отменяют удар 12 из 20 модулей.

## Урон и смерть

`cancel_event()` в `entity_take_damage` гасит и `player_damage_entity`: удар дальше не доходит, слышен `attack.nodamage`. Если хитбокс отменяет урон, а счёт ведётся отдельно, считай его прямо в `entity_take_damage`.
```kotlin
save `смерти %player%`
save `смерти %victim%`
save `убийства %player%`
when player_kill_player {
    `убийства %player%` += 1
    `смерти %victim%` += 1
}
when mob_kill_player {
    `смерти %victim%` += 1
}
when player_death {
    `смерти %player%` += 1
}
```
- При смерти от моба срабатывают оба события, `mob_kill_player` и `player_death` (проверено на сервере): счётчик смертей держи в одном `player_death`, иначе смерть посчитается дважды. Смерть от игрока одним игроком не проверить.
- `player.damage(урон, источник)`: источник — имя или UUID, от него сервер считает убийцу. Сущности — `entity.damage`. Здоровье: `value.current_health`, `value.max_health`, `set_health(n)`, `player.heal(n)`.
- В `player_take_damage`: `cancel_event()`, `damage_cause_equals(cause: fall)`, `set_event_damage(value.event_damage / 2)`. `value.event_final_damage` — урон после поправок.
- `player_respawn`: сначала `wait(1)`, так советует описание сервера. Без экрана смерти: `set_instant_respawn(instant_respawn: true)`. Системное сообщение: `hide_event_message(hide: true)`.
- Вовсе без смерти (`lknk`): в `player_death` первой строкой `cancel_event()`, затем `wait(1)` и `player.heal(20)`.

## Оружие и лучи
```kotlin
const GUN = item(iron_horse_armor, name: "&7Пистолет", tags: {weapon: "pistol"})

func shoot(power: number) {
    all_mobs()
    stop = filter_by_raycast(value.eye_location, 50, 0.15, 1, consider_blocks: true)
    @current entity.damage(power, value.uuid)
    @all display_particle_line(particle(crit), value.eye_location, stop, 0.5, unit_of_measurement: distance)
}
when player_right_click {
    if item_has_tag(value.main_hand_item, "weapon", "pistol") and item_is_not_on_cooldown(GUN) {
        cancel_event()
        set_item_cooldown(5, GUN)
        shoot(3)
    }
}
func beam(limit: number) {
    pos = value.eye_location
    dir = value.direction_of_view
    repeat limit * 2 {
        pos = shift_location_on_vector(pos, dir, 0.5)
        if not game.block_equals(block(air), pos) {
            return
        }
        @all display_particle(particle(flame), pos)
        wait(1)
    }
}
```
- `filter_by_raycast` (15 модулей) оставляет тех, в кого попал луч, и пишет конец луча в переменную. Цикл `beam` (4 модуля) нужен, только когда луч виден и летит по времени.
- По игрокам: `player_by_conditional(not player.name_equals(value.uuid))` вместо `all_mobs()` и `player.damage`. Оба вида — два луча подряд, второй при `value.selection_size == 0` (`stargunb`).
- Точка попадания: `hit = ray_trace_result(start: value.eye_location, max_distance: 20, ray_size: 0, ray_collision_mode: only_blocks)`, промах — `if not var.is_type(hit, location)` (`paint`).
- Направление луча — поворот `origin`, вектора нет. Разброс: `shift_all_coordinates(value.eye_location, 0, 0, 0, dyaw, dpitch)` (`stargunb`).
- `das` копирует обработчик на каждое оружие, здесь один `func` с параметром. Задержка общая на тип предмета: два оружия на одном `iron_horse_armor` делят её.
- Частицы и звук — действия над игроком: без `@all` их увидит только выборка.

## Снаряд
```kotlin
when player_projectile_hit {
    if @projectile entity.name_equals("grenade") {
        create_explosion(@projectile value.location, 2)
    }
}
```
- Запуск: `player.launch_projectile(item(snowball), value.eye_location, "grenade", 1.5, 0)`. Свой снаряд отличает имя, без проверки код сработает на любую стрелу.
- Снаряд игрока ловит `player_projectile_hit`: на сервере он сработал, а `projectile_hit` на тот же снежок нет. Попадание по живым: `projectile_damage_player`, `projectile_damage_entity`.

## NPC и мобы
```kotlin
func spawn_shop(at: location) {
    entity_by_conditional(has_custom_tag("npc", "shop"))
    @current entity.remove()
    spawn_mob(mob: item(villager_spawn_egg), location: at, custom_name: "&aТорговец")
    @last set_ai(ai: false)
    @last set_invulnerable(invulnerable: true)
    @last set_custom_tag("npc", "shop")
}
when player_right_click_entity {
    if @victim has_custom_tag("npc", "shop") {
        cancel_event()
        send_message("&aТорговец: привет, %player%!")
    }
}
```
- Тип моба — яйцо призыва. `health: 9999999800000` (6 модулей) не нужен, есть `set_invulnerable`.
- `@last` (353 блока, 48 модулей) лучше, чем `last_entity()` и `mob_by_name`: выборка цела, `send_message` дойдёт. Новая сущность сдвигает `@last`, поэтому перед `wait` сохрани `id = @last value.uuid`, потом `entity_by_name(id)`.
- Удаление по тегу перед спавном не даёт копиться дублям (`case` чистит так при `world_start`). Тег надёжнее имени: имя видно игрокам и повторяется.
- Награда: `when player_kill_mob`, проверка `@victim has_custom_tag(...)`, без цели — убийца.

## Голограмма и подпись над сущностью
```kotlin
func show_top(at: location, line: text) {
    entity_by_name("top")
    @current entity.remove()
    spawn_text_display(at, "top", line)
    @last set_display_billboard(billboard_type: center)
    @last set_display_scale(vec(1.5, 1.5, 1.5))
}
func attach_label(mob: text) {
    spawn_text_display(value.location, "${mob} label", "&cБосс")
    @last set_display_translation(vec(0, 0.5, 0))
    @last entity.ride_entity(mob)
}
```
- Второй аргумент `spawn_text_display` — имя для поиска, текст — третий. Обновление: `entity_by_name("top")`, затем `@current set_text_display_text(line)`.
- UUID хозяина в имени подписи находит её без списков (`healthbars`): в `entity_death` `entity_by_name("%entity_uuid% label")`, затем `@current entity.remove()`. Над игроком: `entity.ride_entity(value.name)`.

## Маскировка
- Игрок: `player.disguise_as_entity(item(pig_spawn_egg), visible_to_self: false)`, снять — `player.remove_disguise()`, проверить — `player.is_disguised()`.
- NPC со скином: `@last disguise_as_player("Ник", "&bИмя", server_type: server)`, действие есть только у сущностей. `server` — скин JustMC (17 из 20), `mojang` — Mojang.
- Вид снаряда: `@last entity.disguise_as_item(item(tnt))` сразу после запуска (`granades`).

## Езда
```kotlin
func sit() {
    spawn_armor_stand(
        location: value.location,
        custom_name: "seat %player%",
        gravity: false,
        show_arms: false,
        invisible: true
    )
    player.ride_entity(@last value.uuid)
}
when player_dismount {
    entity_by_name("seat %player%")
    @current entity.remove()
}
```
Цель садится, аргумент — на кого: `entity.ride_entity(uuid)` сажает сущность. `cancel_event()` в `player_dismount` не даёт сойти (`Cars`). `value.vehicle` — UUID или `"none"`, `value.passengers` — список.

## Частые ошибки
- `send_message` после `entity_by_name` без `@default`: сообщение уходит сущности.
- `value.location` под выборкой вместо `@current value.location`: читается участник события.
- Снаряд из глаз круто вниз события попадания не даёт: при наклоне 70 `player_projectile_hit` молчит, при 30 срабатывает.
- Цель пишется и в тексте, и в формуле: `"${@current value.name}"`, `x = @killer value.current_health + 1`. Значение ложится в переменную отдельным блоком.
- `return` в `when` заканчивает срабатывание, в `func` выходит из функции. `end_thread()` из функции останавливает всю строку.
- `isolated_selection() { }` пишется со скобками: без них тело не собирается.
