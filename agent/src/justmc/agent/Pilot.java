package justmc.agent;

import com.google.gson.JsonObject;
import java.lang.reflect.Field;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicLong;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Options;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.entity.Entity;

final class Pilot {
    private static final int FREE_TIMEOUT = 20 * 60;
    private static final int STUCK_TICKS = 50;
    private static final int MAX_REPLANS = 14;
    private static final int SEARCH_LIMIT = 40000;
    private static final int REPLAN_FOLLOW = 15;
    private static final double SEGMENT = 0.45;
    private static final double LOOK_NUDGE = 0.5;
    private static final int CLICK_GAP = 3;

    static final class Job {
        final long id;
        final String kind;
        final CompletableFuture<JsonObject> done = new CompletableFuture<>();

        Job(long id, String kind) {
            this.id = id;
            this.kind = kind;
        }
    }

    private interface Task {
        boolean tick(Minecraft mc);

        default void cancel(Minecraft mc) {}
    }

    private final Map<String, Integer> held = new HashMap<>();
    private final ArrayDeque<Runnable> clicks = new ArrayDeque<>();
    private final Map<Long, Job> jobs = new HashMap<>();
    private final AtomicLong nextJob = new AtomicLong();
    private Task task;
    private Job taskJob;
    private int clickWait;

    private static KeyMapping key(Options o, String name) {
        return switch (name) {
            case "forward" -> o.keyUp;
            case "back" -> o.keyDown;
            case "left" -> o.keyLeft;
            case "right" -> o.keyRight;
            case "jump" -> o.keyJump;
            case "sneak" -> o.keyShift;
            case "sprint" -> o.keySprint;
            case "use" -> o.keyUse;
            case "attack" -> o.keyAttack;
            case "drop" -> o.keyDrop;
            case "swap_hands" -> o.keySwapOffhand;
            case "pick" -> o.keyPickItem;
            case "inventory" -> o.keyInventory;
            default -> throw new Refusal("нет клавиши «" + name + "»");
        };
    }

    void hold(Minecraft mc, Iterable<String> keys, int ticks) {
        for (String k : keys) {
            key(mc.options, k);
            held.put(k, ticks);
        }
    }

    void release(Minecraft mc, Iterable<String> keys) {
        for (String k : keys) {
            KeyMapping m = key(mc.options, k);
            held.remove(k);
            m.setDown(false);
        }
    }

    void releaseAll(Minecraft mc) {
        boolean driving = task != null || !held.isEmpty();
        for (String k : held.keySet()) key(mc.options, k).setDown(false);
        held.clear();
        if (driving) {
            for (String k : List.of("forward", "back", "left", "right", "jump", "sneak", "sprint", "use", "attack")) {
                key(mc.options, k).setDown(false);
            }
        }
        clicks.clear();
        if (task != null) {
            task.cancel(mc);
            finish(Js.obj("ok", false, "outcome", "остановлено"));
        }
    }

    void click(Minecraft mc, String name, int times) {
        KeyMapping m = key(mc.options, name);
        for (int i = 0; i < times; i++) clicks.add(() -> press(m));
    }

    private static void press(KeyMapping m) {
        try {
            Field f = KeyMapping.class.getDeclaredField("clickCount");
            f.setAccessible(true);
            f.setInt(m, f.getInt(m) + 1);
        } catch (ReflectiveOperationException e) {
            throw new Refusal("нажатие: " + e);
        }
    }

    boolean busy() {
        return task != null || !held.isEmpty() || !clicks.isEmpty();
    }

    void beforeTick(Minecraft mc) {
        if (task != null) {
            boolean done;
            try {
                done = task.tick(mc);
            } catch (Throwable t) {
                task.cancel(mc);
                finish(Js.obj("ok", false, "outcome", "сбой", "error", Agent.trace(t)));
                done = false;
            }
            if (done) task = null;
        }
        if (mc.player == null) return;
        Iterator<Map.Entry<String, Integer>> it = held.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<String, Integer> e = it.next();
            KeyMapping m = key(mc.options, e.getKey());
            if (e.getValue() == 0) {
                m.setDown(false);
                it.remove();
                continue;
            }
            m.setDown(true);
            if (e.getValue() > 0) e.setValue(e.getValue() - 1);
        }
        if (clickWait > 0) clickWait--;
        else if (!clicks.isEmpty() && mc.player != null) {
            clicks.poll().run();
            clickWait = CLICK_GAP;
        }
    }

    Job start(Minecraft mc, String kind, Object spec) {
        if (task != null) {
            task.cancel(mc);
            finish(Js.obj("ok", false, "outcome", "заменено"));
        }
        Job job = new Job(nextJob.incrementAndGet(), kind);
        jobs.put(job.id, job);
        if (jobs.size() > 64) jobs.remove(jobs.keySet().iterator().next());
        taskJob = job;
        task = (Task) spec;
        return job;
    }

    private void finish(JsonObject result) {
        Job j = taskJob;
        task = null;
        taskJob = null;
        if (j != null) j.done.complete(result);
    }

    Job job(long id) {
        return jobs.get(id);
    }

    Object look(double yaw, double pitch, int ticks) {
        return new Look(yaw, pitch, ticks);
    }

    private final class Look implements Task {
        private final double yaw;
        private final double pitch;
        private final int ticks;
        private int elapsed;
        private double fromYaw;
        private double fromPitch;

        Look(double yaw, double pitch, int ticks) {
            this.yaw = yaw;
            this.pitch = pitch;
            this.ticks = Math.max(ticks, 0);
        }

        @Override
        public boolean tick(Minecraft mc) {
            LocalPlayer p = mc.player;
            if (p == null) {
                finish(Js.obj("ok", false, "outcome", "игрока нет"));
                return true;
            }
            if (elapsed == 0) {
                fromYaw = p.getYRot();
                fromPitch = p.getXRot();
            }
            elapsed++;
            double wrapped = fromYaw + wrap(yaw - fromYaw);
            if (elapsed <= ticks) {
                double t = (double) elapsed / ticks;
                turn(p, fromYaw + (wrapped - fromYaw) * t, fromPitch + (pitch - fromPitch) * t);
                return false;
            }
            int settle = elapsed - ticks;
            if (settle == 1) {
                turn(p, wrapped + (wrapped > 0 ? -LOOK_NUDGE : LOOK_NUDGE), pitch + (pitch > 0 ? -LOOK_NUDGE : LOOK_NUDGE));
                return false;
            }
            if (settle == 3) {
                turn(p, wrapped, pitch);
                return false;
            }
            if (settle < 5) return false;
            finish(Js.obj("ok", true, "outcome", "готово", "yaw", p.getYRot(), "pitch", p.getXRot()));
            return true;
        }
    }

    static double wrap(double angle) {
        double a = angle % 360;
        if (a > 180) a -= 360;
        if (a < -180) a += 360;
        return a;
    }

    static void turn(LocalPlayer p, double yaw, double pitch) {
        p.setYRot((float) yaw);
        p.setYHeadRot((float) yaw);
        p.setXRot((float) Math.max(-90, Math.min(90, pitch)));
    }

    Object go(JsonObject spec) {
        return new Walk(spec);
    }

    private final class Walk implements Task {
        private double x;
        private final Double wantedY;
        private double z;
        private final String follow;
        private final boolean sprint;
        private final double tolerance;
        private final int deadline;
        private int age;
        private int replans;
        private List<Route.Cell> path;
        private int index;
        private double lastX;
        private double lastZ;
        private int still;
        private int sinceReplan;
        private boolean noPath;

        Walk(JsonObject spec) {
            x = Js.num(spec, "x", 0);
            z = Js.num(spec, "z", 0);
            wantedY = Js.has(spec, "y") ? Js.num(spec, "y", 0) : null;
            follow = Js.text(spec, "entity", null);
            sprint = Js.flag(spec, "sprint", false);
            tolerance = Js.num(spec, "tolerance", follow == null ? 0.8 : 2.5);
            deadline = (int) (Js.num(spec, "timeoutMs", 60000) / 50);
        }

        private void keysOff(Minecraft mc) {
            mc.options.keyUp.setDown(false);
            mc.options.keySprint.setDown(false);
            mc.options.keyJump.setDown(false);
            mc.options.keyShift.setDown(false);
        }

        @Override
        public void cancel(Minecraft mc) {
            keysOff(mc);
        }

        private boolean end(Minecraft mc, boolean ok, String outcome) {
            keysOff(mc);
            LocalPlayer p = mc.player;
            double left = p == null ? -1 : Math.hypot(p.getX() - x, p.getZ() - z);
            finish(Js.obj("ok", ok, "outcome", outcome, "left", left, "x", p == null ? null : p.getX(),
                    "y", p == null ? null : p.getY(), "z", p == null ? null : p.getZ()));
            return true;
        }

        private boolean retarget(Minecraft mc) {
            if (follow == null) return true;
            Entity e = Scene.find(mc, follow);
            if (e == null) return false;
            x = e.getX();
            z = e.getZ();
            return true;
        }

        private void plan(Minecraft mc, LocalPlayer p) {
            Route route = new Route(mc.level);
            Route.Cell from = route.snap(p.getX(), p.getY(), p.getZ());
            int ty = wantedY != null ? (int) Math.floor(wantedY) : from.y();
            Route.Cell to = route.snap(x, ty + 0.0, z);
            if (wantedY == null) to = route.snap(x, from.y(), z);
            Route.Found found = route.find(from, to, SEARCH_LIMIT);
            noPath = found.path().size() < 2 || (!found.reached() && found.left() > 3 && Math.hypot(x - p.getX(), z - p.getZ()) < 20);
            path = route.simplify(found.path());
            index = Math.min(1, path.size() - 1);
            sinceReplan = 0;
        }

        @Override
        public boolean tick(Minecraft mc) {
            LocalPlayer p = mc.player;
            if (p == null || mc.level == null) return end(mc, false, "игрока нет");
            if (mc.gui.screen() != null) return end(mc, false, p.isDeadOrDying() ? "игрок мёртв" : "открыто окно " + mc.gui.screen().getClass().getSimpleName());
            if (++age > deadline) return end(mc, false, "время вышло");
            if (!retarget(mc)) return end(mc, false, "цель пропала");
            if (Math.hypot(p.getX() - x, p.getZ() - z) <= tolerance) return end(mc, true, "дошёл");
            if (p.getAbilities().flying) return fly(mc, p);
            if (path == null || (follow != null && sinceReplan >= REPLAN_FOLLOW)) {
                plan(mc, p);
                if (noPath && path.size() < 2) return end(mc, false, "нет пути");
            }
            sinceReplan++;
            if (index >= path.size()) {
                if (noPath) return end(mc, false, "нет пути");
                if (++replans > MAX_REPLANS) return end(mc, false, "застрял");
                plan(mc, p);
                if (path.size() < 2) return end(mc, false, "нет пути");
            }
            Route.Cell next = path.get(Math.min(index, path.size() - 1));
            double tx = next.x() + 0.5;
            double tz = next.z() + 0.5;
            double near = index == path.size() - 1 ? Math.min(tolerance, SEGMENT) : SEGMENT;
            if (Math.hypot(p.getX() - tx, p.getZ() - tz) <= near) {
                index++;
                return false;
            }
            float yaw = (float) Math.toDegrees(Math.atan2(-(tx - p.getX()), tz - p.getZ()));
            p.setYRot(yaw);
            p.setYHeadRot(yaw);
            mc.options.keyUp.setDown(true);
            mc.options.keySprint.setDown(sprint);
            boolean higher = next.y() > p.getY() + 0.4;
            mc.options.keyJump.setDown(p.horizontalCollision || higher || p.isInWater());
            if (Math.hypot(p.getX() - lastX, p.getZ() - lastZ) > 0.03) {
                still = 0;
                lastX = p.getX();
                lastZ = p.getZ();
            } else if (++still > STUCK_TICKS) {
                still = 0;
                if (++replans > MAX_REPLANS) return end(mc, false, "застрял");
                path = null;
            }
            return false;
        }

        private boolean fly(Minecraft mc, LocalPlayer p) {
            double ty = wantedY != null ? wantedY : p.getY();
            double dy = ty - p.getY();
            float yaw = (float) Math.toDegrees(Math.atan2(-(x - p.getX()), z - p.getZ()));
            p.setYRot(yaw);
            p.setYHeadRot(yaw);
            mc.options.keyUp.setDown(true);
            mc.options.keySprint.setDown(sprint);
            mc.options.keyJump.setDown(dy > 0.4);
            mc.options.keyShift.setDown(dy < -0.4);
            return false;
        }
    }
}
