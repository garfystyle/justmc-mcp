# Физика: векторы, толчки, снаряды, транспорт, поворот

Приёмы из кода модулей и расчёта ванильной физики. Метка `(ph03)`: это проверяет рецепт из `tests/physics.json`. Прогнаны на сервере 04.11.2026: 11 из 15, не подтвердились двойной прыжок через полёт (ph07) и снаряд ph11, который задел чужого моба. Лучи и оружие — в «Цели, бой и сущности», места — в «Мир, блоки».

## Вектор
```kotlin
func vectors(target: location) {
    to = get_vector_between_locations(value.location, target)
    ahead = rotate_vector_around_axis(vec(0, 0, 1), -value.yaw, axis: y)
    left = rotate_vector_around_axis(ahead, 90, axis: y)
    push = multiply_vector(left, 0.5)
    set_velocity(push + vec(0, 0.4, 0), increment: false)
    aim = set_location_direction(value.eye_location, to)
    send_message("${get_vector_length(to)} ${get_coordinate(aim, type: yaw)}")
}
```
| Нужно | Запись |
|:--|:--|
| координата | `get_vector_component(v, vector_component: y)`, замена: `set_vector_component(v, 0, vector_component: y)` |
| нормаль грани | `get_vector_from_block_face("north")` |
| отражение | `reflect_vector_product(v, normal, 0.8)`, третий аргумент — упругость (ph01) |
| место ↔ направление | `get_location_direction(l)`, `set_location_direction(l, v)` |

- **`v * 2`** собирается в `multiply_vector`, если компилятор видит вектор: `value.…`, `vec(…)`, параметр `: vector`, постоянная или результат действия вроде `rotate_vector_…`, `set_vector_length`, `get_vector_…`. У значения неизвестного вида объяви `game v: vector` или пиши `multiply_vector(v, 2)`. `a + vec(…)`, `v / 2`, `-v` работают так же.
- **«Вперёд по земле» считай от `value.yaw`, как `ahead` (`chairs`, ph02), а не обнулением Y у взгляда.** Такой вектор всегда единичный, а у взгляда без Y длина падает с наклоном, под ногами он почти нулевой. Поворот на `90` — влево, `-90` — вправо. `set_vector_length` от нуля проверяй заранее (ph01): `dash` страхуется `dir == vec(0, 0, 0)`, векторы сравниваются обычным `==`.
- `shift_location_on_vector(l, v)` сдвигает на длину `v`, с третьим аргументом — на `n` по направлению `v` (ph01).
- Умолчание `get_vector_component` — X: `Walljump` пишет `Z = get_vector_component(value.velocity)` и читает X.

## Толчок
| Нужно | Игрок | Сущность |
|:--|:--|:--|
| по вектору | `set_velocity(v)` | **`set_location(v)`** |
| вверх, вниз | `player.launch_up(n)` | `entity.launch_up(n)` |
| по взгляду | `player.launch_forward(n)` | `entity.launch_forward(n)` |
| к точке | `player.launch_to_location(l, n)` | `entity.launch_to_location(l, n)` |

- **`set_location` — запуск сущности по вектору, не телепорт** (22 модуля). Переместить: `entity.teleport(l)`.
- `n` — блоков за тик, прыжок ванили 0.42. Высота по расчёту: `launch_up(0.6)` 2.4 блока, `1` 5.9, `1.5` 12, `2` 20 (ph03).
- `increment` по умолчанию включён, толчок прибавляется к инерции. `increment: false` заменяет скорость целиком (38 модулей), поэтому порядок важен: `launch_forward(0.35, increment: false, launch_axis: yaw)`, затем `launch_up(0.5)` (`Walljump`, ph03).
- `launch_forward` идёт по наклону взгляда. По земле — `launch_axis: yaw` (`Машинки`, `Parcool`). Минус — назад, это отдача: `player.launch_forward(-0.1)`.
- `launch_to_location`: похоже, скорость равна расстоянию × сила (ph04). Сила `1` на каждый тик держит тело в точке (`Верити`), `0.2` тянет плавно (`gravitygun`), минус отталкивает (`OldPvp`). Постоянная скорость: `set_velocity(set_vector_length(to, n), increment: false)`.
- От толчка не сдвинутся стойка с `gravity: false` и моб с `set_ai(ai: false)` (логика ванили, ph04). Им — `entity.teleport`.
- Падение после толчка: `player.set_fall_distance(0)` (8 модулей). Толчки в `player_move` множат копии: толчок на тик делай циклом.
- Отбрасывание: `@victim set_velocity(value.direction_of_view * 0.2)` в `player_damage_player` (`OldPvp`), отмена: `cancel_event()` в `player_knockback`.

## Скорость и направление игрока
- `value.velocity` показывает внешние силы, ходьбы в нём нет (описание сервера, ph03). Шаги считают разницей мест: `was = value.location`, `wait(2)`, `get_vector_between_locations(was, value.location)` процессом на игрока (`dash`, `dir_vector`). Скорость: `locations_distance(was, value.location)`.
- Нужна только сторона, куда жмёт игрок: `has_input(input_type: left)`, ещё `forward`, `backwards`, `right`, `jump`, `sneak`, `sprint`. Слежка тогда не нужна.

## Рывок
```kotlin
const DASH = item(feather, name: "&bРывок")
when player_swap_hands {
    cancel_event()
    if not item_is_not_on_cooldown(DASH) {
        return
    }
    set_item_cooldown(40, DASH)
    turn = 0
    if has_input(input_type: left) {
        turn = 90
    } else if has_input(input_type: right) {
        turn = -90
    } else if has_input(input_type: backwards) {
        turn = 180
    }
    dir = rotate_vector_around_axis(vec(0, 0, 1), turn - value.yaw, axis: y)
    repeat 5 {
        set_velocity(dir, increment: false)
        wait(1)
    }
}
```
**Один толчок съедает трение**: `launch_forward(1)` на земле проносит около 2 блоков, в воздухе 11 (расчёт). Рывок — вектор заново каждый тик (`Рывки`, 474 установки, ph05).

## Двойной прыжок
```kotlin
game `прыжок %player%`
when player_input_event {
    if not event_has_input(input_type: jump) or has_input(input_type: jump) {
        return
    }
    if is_on_ground() {
        `прыжок %player%` = 0
        return
    }
    if `прыжок %player%` == 1 {
        return
    }
    `прыжок %player%` = 1
    player.launch_up(0.6, increment: false)
    @all display_particle(particle(cloud, count: 10), value.location)
}
```
В событии новый набор клавиш — `event_has_input`, `value.event_input_list`, а старый ещё в `has_input`, `value.current_input_list`: «есть в событии, нет в текущем» значит нажатие (`Механики`, `gd001`, ph06).

Через полёт (`Облако в бутылке`, 165 установок, ph07): `set_allow_flying()` в `player_jump`, в `player_start_flight` — `cancel_event()`, `set_allow_flying(allow_flying: false)` и толчок. Разрешение приходит после отрыва, а полёт включается двойным нажатием: по логике клиента это два нажатия в воздухе. Клавишный способ берёт одно.

## Отскок от стены
```kotlin
func wall_jump() {
    hit = ray_trace_result(
        variable_for_hit_block_face: face,
        start: value.eye_location,
        max_distance: 1.5,
        ray_size: 0,
        ray_collision_mode: only_blocks
    )
    if is_on_ground() or not var.is_type(hit, location) {
        return
    }
    push = multiply_vector(get_vector_from_block_face(face), 0.6)
    set_velocity(push + vec(0, 0.5, 0), increment: false)
}
when player_left_click {
    wall_jump()
}
```
Точку и грань даёт один луч (ph08), `Walljump` ищет то же 80 шагами со сравнением блоков.

## Гравитация
Игроку и мобам — атрибут, `player.set_attribute(0.02, attribute_type: generic_gravity)`, то же у `entity.set_attribute`. `set_gravity(gravity: false)` есть только у сущностей.

| Атрибут | Ваниль | Смысл |
|:--|:--|:--|
| `generic_gravity` | 0.08 | ускорение вниз за тик, 0 — парение (`ZeroGravity`, ph09) |
| `generic_jump_strength` | 0.42 | сила прыжка |
| `generic_safe_fall_distance` | 3 | падение без урона |
| `bounciness`, `friction_modifier`, `air_drag_modifier` | | упругость, трение, воздух (`Верити`) |

Джетпак: цикл на игрока, `if is_sneaking() { player.launch_up(0.15) }` на тик и топливо в переменной (`jetpack`).

## Своя физика
Визуализатор законов не знает: скорость хранит переменная, шаг — телепорт.
```kotlin
const BALL = "мяч"
const FALL = vec(0, -0.04, 0)
game `мяч %entity_uuid%`
when entity_spawn {
    wait(1)
    if not entity.name_equals(BALL) {
        return
    }
    `мяч %entity_uuid%` = vec(0, 0, 0)
    while entity.exists() {
        wait(1)
        velocity = `мяч %entity_uuid%` + FALL
        speed = get_vector_length(velocity)
        hit = ray_trace_result(
            variable_for_hit_block_face: face,
            start: set_location_direction(value.location, velocity),
            max_distance: speed + 0.05,
            ray_size: 0,
            ray_collision_mode: only_blocks
        )
        if var.is_type(hit, location) {
            velocity = reflect_vector_product(velocity, get_vector_from_block_face(face), 0.7)
        }
        entity.teleport(shift_location_on_vector(value.location, velocity))
        `мяч %entity_uuid%` = velocity
    }
}
func throw_ball() {
    spawn_block_display(value.eye_location, BALL, block(white_wool))
    @last set_display_translation(vec(-0.5, -0.5, -0.5))
    @last set_display_teleport_duration(1)
}
```
- Цикл в `entity_spawn` живёт столько, сколько тело (`theballbitch`, `carcarcarlol`, ph10). Переменная с `%entity_uuid%` доступна другим событиям: удар прибавляет к ней вектор.
- **Луч длиной в скорость не даёт пролететь сквозь блок** (`physics`). `game.block_equals` по конечной точке годится только медленным телам (`physicsbase`). `set_display_teleport_duration(1)` сглаживает шаги (16 модулей).
- Много тел: один цикл мира, иначе `more_active_wait`: выборка по тегу и `start step(target_mode: for_each_in_selection)` (`physics`).

## Столкновения и хитбоксы
| Вопрос | Запись |
|:--|:--|
| центр тела | `value.hitbox_midpoint_location` (56 модулей), `value.location` — ноги |
| размер | `value.entity_height`, `value.entity_width_x`, `value.entity_width_z` (нет в модулях, ph15) |
| упрётся ли тело здесь | `player.collides_at_location(l)`, `entity.collides_at_location(l)` (нет в модулях, ph15) |
| без расталкивания | `player.set_collidable(collidable: false)` (19 модулей) |

У визуализатора хитбокса нет, клик и удар ловит сущность взаимодействия (18 модулей):
```kotlin
func spawn_model(at: location) {
    spawn_block_display(at, "модель", block(gold_block))
    body = @last value.uuid
    @last set_display_translation(vec(-0.5, 0, -0.5))
    spawn_interaction_entity(at, "хитбокс", 1, 1)
    @last entity.ride_entity(body)
}
when player_right_click_entity {
    if @victim entity.name_equals("хитбокс") {
        cancel_event()
        send_message("&aКлик по модели")
    }
}
```
Едет на модели (`itemphysic`, ph15), размер: `set_interaction_size(w, h)`. Коробка всегда вертикальная: попадание в повёрнутую модель считают сами, луч поворачивают в её оси (`rayTarget`).

## Снаряд своими руками
Дополнение к разделу «Снаряд» боевой темы.
```kotlin
func shell(power: number) {
    pos = value.eye_location
    fly = value.direction_of_view * power
    repeat 60 {
        step = get_vector_length(fly)
        all_mobs()
        stop = filter_by_raycast(set_location_direction(pos, fly), step, 0.3, 1, consider_blocks: true)
        @all display_particle_line(particle(crit), pos, stop, 0.5, unit_of_measurement: distance)
        if value.selection_size > 0 {
            @current entity.damage(5, value.uuid)
            return
        }
        if locations_distance(pos, stop) < step - 0.01 {
            create_explosion(stop, 2)
            return
        }
        pos = stop
        fly = fly + vec(0, -0.03, 0)
        wait(1)
    }
}
```
- Один луч на тик вместо проверки блока и поиска цели: конец короче шага — блок, выборка не пуста — тело (ph11).
- Снаряд быстрее параметра `speed`: `@last set_location(value.direction_of_view * 3)` сразу после запуска (`Выдаёт хрокалку`).
- `game.launch_projectile` ловит `projectile_hit`, цель там — снаряд, грань — `value.event_block_face` (`Мячики с физикой`, ph12). Снаряд против тела: `projective_collide`, цели `@victim`, `@projectile`, `@shooter`.
- **У снаряда `value.direction_of_view` идёт с обратными X и Y**: ванильный поворот снарядов считается иначе, `Мячики` возвращают знаки руками (ph12). Для рикошета отражай `value.velocity`, новый снаряд ставь на 0.3 от грани, потом `@last set_location(…)`, старому `entity.remove()`.

## Машина
Лодка плюс толчок вперёд: A и D поворачивают её сами (`Машинки`, 797 установок; `value.steer_forward` в 7 модулях).
```kotlin
process drive(id: text) {
    speed = 0
    wait(2)
    while player.is_riding_entity(id, compare_mode: name_or_uuid) {
        wait(1)
        gas = value.steer_forward
        if gas == 0 {
            speed = speed * 0.95
        } else {
            speed = clamp(speed + gas * 0.02, -0.2, 0.8)
        }
        entity_by_name(id)
        @current entity.launch_forward(speed, increment: false, launch_axis: yaw)
        reset()
        send_action_bar("&cСкорость: ${round(speed * 72)} км/ч")
    }
    entity_by_name(id)
    @current entity.remove()
}
when player_right_click {
    if not event_item_equals(item(minecart), comparison_mode: type_only) {
        return
    }
    cancel_event()
    id = "машина %player%"
    spawn_vehicle(item(oak_boat), value.location, id)
    player.ride_entity(id)
    start drive(id)
}
```
- `value.steer_forward`: 1 вперёд, −1 назад; `value.steer_sideways`: 1 влево, −1 вправо. Значение игрока (ph13). Скорость × 72 — км/ч.
- Цикл с локальной `speed` заменяет два процесса и девять `game`-переменных `Машинки`. `game` нужен, если скорость меняет другое событие, например тормоз.
- Сойти можно Shift: `while` закончится и уберёт лодку, вышедшего убирай в `player_quit`. Удержать: `cancel_event()` в `player_dismount` и свой выход (`Машинки`). Пауза перед `while` нужна: посадка не мгновенная.
- Вагонетка едет за взглядом: `set_location(v, increment: false)` на тик с газом, `v` — взгляд с нулевым Y (`Вагонетка-машина`, 322 установки).
- `player_vehicle_move` срабатывает только при нажатых кнопках (`Tank`): замедление в нём не сделать. Модель там — визуализаторы и вагонетка на одной стойке с `gravity: true`, толкают только её.

## Крюк-кошка
```kotlin
const HOOK = item(tripwire_hook, name: "&eКрюк", tags: {tool: "hook"})
process pull(point: location) {
    repeat 40 {
        wait(1)
        if is_sneaking() or is_near(2.5, point, ignore_y_axis: false) {
            stop_repeat()
        }
        to = get_vector_between_locations(value.location, point)
        set_velocity(set_vector_length(to, 0.8), increment: false)
        @all display_particle_line(particle(crit), value.eye_location, point, 0.5, unit_of_measurement: distance)
    }
    player.set_fall_distance(0)
}
when player_right_click {
    if not item_has_tag(value.main_hand_item, "tool", "hook") {
        return
    }
    cancel_event()
    hit = ray_trace_result(start: value.eye_location, max_distance: 30, ray_size: 0, ray_collision_mode: only_blocks)
    if var.is_type(hit, location) {
        start pull(hit)
    }
}
```
- Тянуть надо каждый тик, иначе дугу заберёт гравитация (`Крюки`, ph14). Выход по близости, Shift и счётчику обязателен: `increment: false` держит игрока у стены в воздухе.
- Цель к себе: `entity.launch_to_location(hold, 0.2, increment: false)` на тик, бросок: `set_location(value.direction_of_view, increment: false)` (`Грави пушка`).

## Поворот и углы
Yaw: 0 — юг (+Z), 90 — запад (−X), ±180 — север, −90 — восток, растёт вправо. Pitch: −90 вверх, 90 вниз. `sin`, `cos`, `sine`, `cosine` — градусы, `atan2` — радианы (`ghsamm`, ph01).
```kotlin
func turn_to(target: location, rate: number) {
    want = get_coordinate(var.face_location(value.location, target), type: yaw)
    turn = want - value.yaw
    diff = turn - 360 * floor((turn + 180) / 360)
    entity.set_rotation(value.yaw + clamp(diff, -rate, rate), 0)
}
process orbit(center: location, radius: number) {
    angle = 0
    forever {
        wait(1)
        angle += 6
        entity.teleport(center + vec(radius * cos(angle), 0, radius * sin(angle)))
    }
}
```
- `turn_to` рассчитан на цикл в `entity_spawn`: там `value.…` без цели и есть сущность.
- **Угол из направления — без тригонометрии** (yaw идёт 0–360: восток 270, а не -90, проверено, ph02): `var.face_location(l, target)` или `set_location_direction(l, v)`, затем `get_coordinate(…, type: yaw)` (`Walljump`, ph02).
- Разницу углов оборачивай формулой `d - 360 * floor((d + 180) / 360)`, иначе 170 и −170 дают 340 и тело крутится через весь круг. Больше нуля — цель справа.
- Смотрит ли игрок на цель: `get_angle_between_vectors(value.direction_of_view, to) < 30` (`Herobrine`). Спереди или сзади: `vector_dot_product(a, b) > 0`.
- Сдвиг от поворота места: `shift_location_in_direction(l, 1, direction: sideways)`, плюс — вправо (ph02).
- Вращение модели: `set_display_rotation_from_euler_angles(1, 0, 3, mode: add)` на шаг (21 модуль).
