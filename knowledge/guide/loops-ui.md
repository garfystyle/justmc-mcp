# Циклы, процессы, таймеры, интерфейс и мини-игры
## Подождать и выйти из цикла
```kotlin
when player_join {
    wait(10)
    wait(1, seconds)
    wait(2s)
}
```
- Голое число — тики, 20 тиков = 1 с: `wait(2s)` — 40 тиков, `wait(2, seconds)` — блок с единицей «секунды». Минимум 1 тик, в тиках только целые. `cancel_event()` ставь до первого `wait`.
- Цикл: `repeat 5`, если индекс не нужен; `for i in 1..n` (конец включён), `for i, v in l` (индекс с нуля); `while` пересчитывает условие на каждом проходе; `forever` только с `wait` внутри. Копии «`wait` + действие» (модуль `Taymer`: десять пар подряд) заменяй циклом с формулой.
- `break`, `continue` действуют на ближайший цикл (блоки `stop_repeat`, `skip_iteration`). `return` — выход из функции, а в `when` и процессе конец срабатывания. `end_thread()` в функции рубит всю вызвавшую строку: удобный сторож (433 раза в 64 модулях), но из цикла мира так гибнет сам цикл.
## Цикл на мир или на игрока
```kotlin
process hud() {
    forever {
        wait(1, seconds)
        all_players()
        for name in value.selection_target_names {
            player_by_name(name)
            send_action_bar("&eУбийств: ${kills[name]}")
        }
        reset()
    }
}
when world_start {
    game kills = {}
    start hud(target_mode: no_target)
}
when player_join {
    while has_player(value.uuid) {
        if is_sneaking() { send_action_bar("&7Ты крадёшься") }
        wait(5)
    }
}
```
- `forever` стоит в `player_join` 71 раз, в `world_start` 43, в процессах 28. Лучшая форма — процесс из `world_start`: один `wait` на всех (число активных `wait` ограничено), и код после `start` выполнится, а после `forever` в той же строке — никогда. Значение общее — обход не нужен, хватит `@all send_action_bar("…")`.
- Цикл на игрока — только для своей реакции чаще раза в секунду; там работают `%player%` и цель по умолчанию. В модулях чаще `forever` (71 против 8), но кончается ли он при выходе игрока, не подтверждено; `has_player` (`antirelog`, 836 установок) выходит сам.
- В `no_target` цели нет: без выборки и `@all` действие никому не дойдёт, `%player%` по описанию есть только у игрока события и в `for_each_in_selection`. Значение игрока читай `@current value.location`, переменную с ником пиши `` `монеты %selected%` `` или держи словарь по имени. Выборка живёт до `reset()`: все действия без цели идут ей; `player_by_name` заменяет её, `add_player_by_name` дополняет. В `world_start` готовь данные, `save` проверяй `if not var.exists(best) { best = 0 }` (25 строк в модулях); `world_stop` в модулях обычно убирает сущности.
## Процесс
```kotlin
process bonus(amount: number, who: text) {
    wait(1, seconds)
    send_message("&a${who}: +${amount}")
}
when player_join {
    start bonus(5, "%player%")
}
```
- `target_mode`: без него цель события остаётся (`bans`); `no_target` — циклы мира; `current_selection` — вся выборка; `for_each_in_selection` — свой процесс на каждую цель, `%player%` — она (`all_players()`, `start one(target_mode: for_each_in_selection)`, `reset()`).
- `local_variables_mode`: `dont_copy` свои локальные, `copy` копия, `share` общие. Чужую локальную объявляй вверху файла `local score`, иначе сборка скажет, что она нигде не задана. Лучше параметры: внутри это строчные переменные (в модулях так у `MakeLeaderboard`). Значение процесс не возвращает: итог — через `game` или `share`. Блока «остановить процесс» нет, цикл сам смотрит на переменную (`` `%player%_car_stop` ``). Цикл через вызов самого себя (19 мест в модулях) заменяй на `forever`.
## Обратный отсчёт: отмена и перезапуск
```kotlin
process countdown(id: number) {
    left = 5
    while left > 0 and run == id {
        @all send_title("&e${left}", fade_in: 0, stay: 25, fade_out: 5)
        wait(1, seconds)
        left -= 1
    }
    if run == id { @all send_title("&aСтарт!", fade_in: 0, stay: 25, fade_out: 5) }
}
when player_swap_hands {
    game run += 1
    start countdown(run, target_mode: no_target)
}
```
В модулях стоит флаг `Activate Timer = "False"`: включишь снова быстрее шага цикла — старый отсчёт оживёт, и их станет два. Номер запуска этого не допускает: `run += 1` гасит все прежние, отмена — тот же `run += 1` без `start`.
## Таймер и кулдаун
```kotlin
save `next %player%`
func clock(sec) { return format_timestamp(sec * 1000, "mm:ss", format: custom) }
when player_swap_hands {
    if value.timestamp < `next %player%` {
        send_message("&cЕщё ${clock(ceil((`next %player%` - value.timestamp) / 1000))}")
        end_thread()
    }
    `next %player%` = value.timestamp
    `next %player%` += 60000
}
```
`format_timestamp` заменяет ручной разбор на минуты, секунды и ноль впереди (`queue`: 6 блоков). Секунды в миллисекунды — формулой, а не цепочкой `multiply` + `add` (модуль `timer`). `value.timestamp` в миллисекундах; кулдаун на нём и `save` переживает перезапуск мира и не держит цикл.
## Большая работа порциями
```kotlin
process fill(total: number) {
    for i in 1..total {
        if remainder(i, 500) == 0 {
            wait(1)
            while value.cpu_usage >= 70 { wait(1) }
        }
    }
}
```
Приём `mapi`, `lknk`, `ban`, `worldedit`: `wait` по счётчику и проверка `value.cpu_usage`, порог чаще всего 70–85. `worldedit` (1941 установка) отдаёт тик через 5000 проходов; размер порции подбирай под тело цикла. Тяжёлое из события выноси в `start`: у строки события свой предел времени.
## Экшн-бар, титул, босс-бар, скорборд
```kotlin
when player_join {
    send_action_bar("&eОчки: &f10")
    send_title("&aСтарт", "&7Удачи", 5, 1s, 5)
    set_boss_bar("round", "&cОсталось 15", 100 * 15 / 60, style: notched_10, color: red)
    remove_boss_bar("round")
    id = "hud %player%"
    create_scoreboard(id, "&e&lМатч")
    set_scoreboard_line(id, "time", "&fВремя: &e60", 2)
    set_scoreboard_score(id, "&fОчки:", 5)
    show_scoreboard(id)
    set_scoreboard_line_display(id, "time", "&fВремя: &e59")
}
```
- Экшн-бар шли в цикле, чаще всего раз в 5 тиков. У титула `fade_in`, `stay`, `fade_out` в тиках, `1s` подставится как 20; без них значения сервера (76 вызовов из 132). У босс-бара `progress` 0–100 считай формулой, тот же `id` обновляет полосу; `@all` в цикле покажет её и вошедшим позже.
- Скорборд: создать, наполнить, показать (`show_scoreboard` требует хотя бы одно значение). Конец: `hide_scoreboard()` игроку, `remove_scoreboard(id)` совсем. Своё каждому — `%player%` в id: общий (модуль `ScoreBoard`) затирается чужими циклами. Текст в `set_scoreboard_score` — id строки, меняется только число справа. Новый текст даёт новую строку, поэтому модули чистят всё на каждом шаге (`clear_scoreboard_scores`, `remove_scoreboard_score_by_score`). Живой текст держи на линии с постоянным id: `set_scoreboard_line`, потом `set_scoreboard_line_display`.
## Звук, частицы, цвета
```kotlin
const PREFIX = "&8[&#a6ff6eИгра&8] &f"
when player_join {
    play_sound(sound(entity.experience_orb.pickup))
    @all display_particle(particle(flame, count: 5, first_spread: 0.5, second_spread: 0.5), value.location)
    @all display_particle_circle(particle(end_rod), value.location, 2, 16, 0, vec(0, 1, 0))
    send_message("${PREFIX}онлайн &l${value.player_count}")
    send_message(mm"<gradient:#ff0000:#0000ff>градиент</gradient> <#ffcc5c><hover:show_text:'текст'>наведи</hover>")
}
```
- Звук интерфейса — без места (110 вызовов из 511). С местом в `no_target` нужна цель: `@current value.location` после выборки. Частицы видит цель действия: всем — `@all`. Частые звуки: `entity.experience_orb.pickup`, `entity.villager.yes`, `entity.villager.no`, `entity.player.levelup`, `block.lever.click`. Цвета: основа — `&`-коды и `&#rrggbb` (3187 раз в 109 модулях). `mm"…"` (19 модулей) — ради `hover`, `click`, `gradient`, `sprite`; `&` внутри него модули не пишут, цвет там `<#rrggbb>`. `${…}` работает в обоих, `plain"…"` выводит `&` как есть. Повторяющийся префикс — `const`.
## Мини-игра: лобби, старт, раунд, конец
```kotlin
const NEED = 2
func count_down(total, label) {
    left = total
    while left > 0 and len(players) >= NEED {
        @all set_boss_bar("round", "${label} ${left}", 100 * left / total, color: green)
        wait(1, seconds)
        left -= 1
    }
}
process match() {
    count_down(10, "&eСтарт через")
    if left == 0 {
        phase = "run"
        player_by_conditional(@current value.name in players)
        player.teleport(loc(0, 64, 0))
        give_items(item(iron_sword))
        reset()
        count_down(120, "&fОсталось")
        players = []
        @all clear_inventory()
    }
    @all remove_boss_bar("round")
    @all set_gamemode(gamemode: adventure)
    phase = "lobby"
}
when world_start {
    game phase = "lobby"
    game players = []
}
when player_quit {
    players = remove_list_value(players, value.name, remove_mode: all)
}
when player_chat {
    if chat_message_equals("@play") {
        cancel_event()
        if phase == "run" or value.name in players { end_thread() }
        players = append_value(value.name)
        if phase == "lobby" and len(players) >= NEED {
            phase = "count"
            start match(target_mode: no_target)
        }
    }
}
```
- Основа как в `queue` (1173 установки): статус текстом, список ников, выборка `player_by_conditional(@current value.name in …)`. Но там опрос раз в секунду и цепочка из пяти процессов; здесь старт по событию и один процесс, а фаза меняется до `start`, поэтому второго запуска нет. Весь сброс — в конце `match`.
- Вышел: `player_quit` только убирает ник, цикл сам видит нехватку игроков. Вошёл в разгар: в `player_join` проверь `phase == "run"` и поставь `set_gamemode(gamemode: spectator)`, в конце режим вернётся всем. `/play` посреди боя ловит отменяемый `player_rejoin` (`antirelog`). Выбывание: смерть от моба приходит в `player_death` и `mob_kill_player` сразу, считай её в одном месте. В `player_respawn` сначала `wait`: так советует описание события.
## Команды
```kotlin
func deal(names) {
    game team = {}
    for i, name in randomize_list_order(names) {
        team[name] = remainder(i, 2) == 0 ? "red" : "blue"
    }
}
when player_damage_player {
    if "%damager%" in team and team["%damager%"] == team["%victim%"] { cancel_event() }
}
```
Один словарь «ник → команда» вместо четырёх списков (`Bedwars`) или переменной на игрока (`teams`): поровну, союзник проверяется в одну строку, сброс — `team = {}`.
## Лимиты сервера
| Ошибка | Причина | Что делать |
|:--|:--|:--|
| `too_many_iterations`, `too_many_actions_executed` | слишком много за один тик | `wait` по счётчику |
| `timeout` (`tick`, `second`, `line`), `line_lifetime`, `timeout_event` | строка идёт долго, забыт `wait`, огромный список | порции, из события в `start` |
| `high_cpu`, `max_tick`, `high_cpu_boost`, `super_high_cpu` | нагрузка на процессор | проверка `value.cpu_usage` |
| `infinite_recursion`, `max_call_depth`, `sync_run` | функция или процесс зовут себя без выхода | цикл с `wait`, условие выхода |
| `too_many_processes_active`, `more_wait_count`, `more_active_wait` | много процессов и `wait` разом | один цикл мира |
| `trigger_overflow` | события вызывают друг друга: урон в событии урона | условие или флаг |
- Порогов итераций и действий в локализации нет. Прочие пределы: список 20 000 значений, словарь 10 000, голограмм 500, линий голограммы 50. ⚠ строку не трогает, ❌ останавливает её, ☠ останавливает весь код.
## Частые ошибки
- `forever` или `while` без `wait`: `check` об этом советует, иначе ошибку даст сервер. Из 202 `forever` в модулях без `wait` только два.
- `send_message` без цели в `world_start` и `no_target`; забытый `reset()` — действия уходят старой выборке.
- Незаданная переменная обнуляет формулу: задай её заранее, счётчик веди через `+=`.
- Остаток считай `remainder(x, 2)`: `x % 2` в формуле на сервере не проверен.
- Второй запуск того же цикла: проверяй фазу или номер запуска. Нет `player_quit`: ник остаётся в списке, игра ждёт вышедшего.
