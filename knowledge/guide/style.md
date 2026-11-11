# Читаемый код

Код мира читают люди: автор, друзья, ты сам через неделю. Работает он в любом виде, поэтому читаемость нужно делать намеренно. `check` выводит раздел «Читаемость»: код сдаётся, только когда там пусто. Комментарии не заменяют имена: если строку нужно объяснять, переименуй или вынеси её в функцию.

## Имена

Имя говорит, что лежит в переменной, без чтения соседних строк. Приставка из одной буквы ничего не добавляет.

| Было | Стало |
|:--|:--|
| `b_gd` | `distance_to_goal` |
| `b_hp` | `boss_health` |
| `cn`, `fi`, `dt` | `clip_name`, `frame_index`, `frame_delay` |
| `pf` | `part_pose` |
| `PB`, `PS` | `PART_BLOCKS`, `PART_SCALES` |
| `s0`, `s1` | `start_size`, `end_size` |
| `hn` | `player_name` |
| `MUZ_F` | `MUZZLE_FORWARD` |

Короткие имена остаются только там, где их смысл общий: `i`, `j`, `k` для счётчика, `x`, `y`, `z` для координат, `id`, `hp`, `npc`. Функция называется глаголом: `spawn_model`, `play_clip`, `hurt_players_near`. Событие и процесс называются тем, что происходит: `process boss_brain`, а не `process ai`.

Имена в мире видит и игрок в редакторе блоков. `func` и `process` с понятным именем читаются прямо в `/dev`.

## Состояния

Числа в сравнениях не говорят ничего. `boss_mode != 1` приходится расшифровывать, `boss_mode != MODE_FIGHT` читается сразу.

```kotlin
const MODE_IDLE = 0
const MODE_INTRO = 1
const MODE_FIGHT = 2
const PHASE_ARMORED = 1
const PHASE_ENRAGED = 2

game boss_mode
game boss_phase

func boss_is_fighting() {
    return boss_mode == MODE_FIGHT
}

when entity_take_damage {
    if boss_phase == PHASE_ENRAGED {
        send_message("Титан в ярости!")
    }
}
```

## Числа и строки

Значение, которое встречается больше одного раза или настраивает игру, живёт в `const` наверху файла. Баланс тогда правится в одном месте. `check` замечает число, встреченное вне `const` 5 раз, и короткую строку, встреченную 4 раза. Обычные числа вроде 10, 20, 100 и 0.5 он не считает.

```kotlin
const MELEE_DAMAGE = 12
const MELEE_RANGE = 4
const WINDUP_TICKS = 16
const PART_TAG = "boss_part"
const ROLE_BODY = "body"

func tag_as_body() {
    @last set_custom_tag(PART_TAG, ROLE_BODY)
}
```

Короткие теги вроде `"km"`, `"f"`, `"p"` не объясняют ничего. Тег хранится в мире, длина ему не мешает: пиши `"boss_part"`.

## Функции

Обработчик держится на экране: до 40 строк. Длинная атака делится на шаги, и верхний уровень читается как план.

```kotlin
const BEAM_TICKS = 84

game boss_mode

func fire_beam() {
    warn_players("&c&l⚠ ЛУЧ")
    charge_beam()
    sweep_beam(BEAM_TICKS)
    remove_beam()
}

func warn_players(message: text) {
    @all send_title(message, "", 5, 30, 5)
}

func charge_beam() {
    wait(1s)
}

func sweep_beam(duration: number) {
    wait(duration)
}

func remove_beam() {
    wait(1)
}
```

Условие отказа стоит первым, тело не уходит вглубь. Больше трёх вложенных блоков внутри обработчика значит, что кусок просится в свою функцию.

```kotlin
const MODE_FIGHT = 1

game boss_mode

func try_attack(target_name: text) {
    if boss_mode != MODE_FIGHT {
        return
    }
    if target_name == "" {
        return
    }
    player_by_name(target_name)
    @current player.damage(10)
    reset()
}
```

## Циклы и списки

Счётчик руками длиннее и легко ошибается на единицу. `for` включает конец диапазона.

```kotlin
game frame_delays: list

func play_frames() {
    for frame in 0..len(frame_delays) - 1 {
        wait(frame_delays[frame])
    }
}
```

`frame_delays[frame]` понятнее `get_list_value(frame_delays, frame)`. Если компилятор отвечает «не понятно, список или словарь», скажи это объявлением: `game frame_delays: list`, в функции отдельной строкой `line delays: list`, у параметра `delays: list`. `get_list_value(items, i, "умолчание")` остаётся, если нужно значение на случай конца списка.

## Файлы

Больше 400 строк в одном файле читать трудно. Проект становится папкой, `path` у `check`, `test` и `deploy` указывает на неё, файлы собираются вместе и видят `const` и функции друг друга.

| Файл | Что внутри |
|:--|:--|
| `settings.xero` | все `const`: урон, время, цвета, теги |
| `state.xero` | объявления `game` и `save` |
| `model.xero` | создание и уборка модели |
| `animation.xero` | проигрывание клипов |
| `attacks.xero` | атаки, по функции на атаку |
| `brain.xero` | выбор атаки и фазы |
| `events.xero` | `when`: команды, урон, смерть |
| `cheats.debug.xero` | тестовые команды |

Файлы `*.debug.xero` заливает только `test`. В `deploy` они не попадают, поэтому код для отладки не нужно вычищать руками перед сдачей.

Большие сгенерированные данные (кадры анимации) лежат своим файлом и не проверяются на читаемость. Генератор держи рядом, правь его, а не данные. Правки исходника делай инструментом правки файлов маленькими кусками, а не скриптами замены.

## Перед сдачей

1. `check` с `format=true` приводит к стилю.
2. `check` без замечаний в разделе «Читаемость».
3. Тестовых команд нет в обычных файлах, только в `*.debug.xero`.
4. `test` прошёл на этом самом коде.
