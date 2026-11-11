package justmc.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mojang.brigadier.tree.CommandNode;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;
import net.minecraft.world.phys.HitResult;

public final class Agent {
    public static final String VERSION = "1.1.0";
    private static final long CLIENT_WAIT = 6000;
    private static final int ATTACH_EVERY = 20;
    private static final int RING_MAIN = 8192;
    private static final int RING_NOISE = 32768;
    private static final int MAX_FAILURES = 40;
    private static final String LIVE_COPY = "justmc.agent.live";

    private static volatile Agent live;

    private final Minecraft mc = Minecraft.getInstance();
    private final Ring main = new Ring(RING_MAIN);
    private final Ring noise = new Ring(RING_NOISE);
    private final Ring[] rings = {main, noise};
    private final Tap tap = new Tap(main, noise);
    private final Pilot pilot = new Pilot();
    private final Shell shell;
    private final Camera camera;
    private final Http http;
    private final long started = System.currentTimeMillis();
    private volatile boolean retired;
    private volatile String lastError;
    private int failures;
    private Recorder recorder;
    private Recorder.Replay replay;
    private long ticks;

    private Agent(String workDir, String token) throws IOException {
        Path dir = Path.of(workDir);
        Files.createDirectories(dir);
        camera = new Camera(dir);
        shell = new Shell(this, Agent.class.getClassLoader());
        http = new Http(token);
        routes();
        ClientTickEvents.START_CLIENT_TICK.register(client -> guarded(this::beforeTick));
        ClientTickEvents.END_CLIENT_TICK.register(client -> guarded(this::afterTick));
    }

    public static synchronized String start(String workDir, String token) throws IOException {
        if (live != null) live.stop();
        if (System.getProperties().get(LIVE_COPY) instanceof Runnable other) other.run();
        live = new Agent(workDir, token);
        System.getProperties().put(LIVE_COPY, (Runnable) Agent::shutdown);
        return Js.obj("port", live.http.port(), "version", VERSION).toString();
    }

    public static synchronized void shutdown() {
        if (live != null) live.stop();
        live = null;
    }

    private void stop() {
        retired = true;
        mc.execute(() -> {
            safely(() -> pilot.releaseAll(mc));
            safely(() -> camera.restore(mc));
        });
        safely(tap::detach);
        http.close();
    }

    static String trace(Throwable t) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        t.printStackTrace(new PrintStream(bytes, true, StandardCharsets.UTF_8));
        return bytes.toString(StandardCharsets.UTF_8);
    }

    private void guarded(Runnable work) {
        if (retired) return;
        try {
            work.run();
            failures = 0;
        } catch (Throwable t) {
            lastError = trace(t);
            if (++failures >= MAX_FAILURES) {
                retired = true;
                safely(() -> pilot.releaseAll(mc));
                safely(() -> camera.restore(mc));
                safely(tap::detach);
            }
        }
    }

    private void safely(Runnable work) {
        try {
            work.run();
        } catch (Throwable t) {
            lastError = trace(t);
        }
    }

    private void beforeTick() {
        safely(() -> {
            if (replay != null && replay.tick(mc, this)) replay = null;
        });
        pilot.beforeTick(mc);
    }

    private void afterTick() {
        ticks++;
        if (ticks % ATTACH_EVERY == 1) {
            safely(() -> tap.attach(mc));
            safely(() -> SoundGuard.watch(mc));
        }
        safely(() -> camera.tick(mc));
        safely(() -> {
            if (recorder != null && !recorder.tick(mc)) stopRecording();
        });
    }

    private JsonObject stopRecording() {
        tap.recorder(null);
        JsonObject out = recorder.finish(mc);
        recorder = null;
        return out;
    }

    private <T> T client(Supplier<T> work) {
        CompletableFuture<T> out = new CompletableFuture<>();
        mc.execute(() -> {
            try {
                out.complete(work.get());
            } catch (Throwable t) {
                out.completeExceptionally(t);
            }
        });
        return await(out, CLIENT_WAIT);
    }

    private static <T> T await(CompletableFuture<T> future, long ms) {
        try {
            return future.get(ms, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            throw new Refusal("клиент занят: нет ответа за " + ms + " мс");
        } catch (ExecutionException e) {
            if (e.getCause() instanceof Refusal r) throw r;
            throw new RuntimeException(e.getCause());
        } catch (InterruptedException e) {
            throw new Refusal("прервано");
        }
    }

    private void needPlayer() {
        if (mc.player == null || mc.level == null) throw new Refusal("игрока нет в мире");
    }

    void say(String text) {
        ClientPacketListener net = mc.getConnection();
        if (net == null || text == null) return;
        if (text.startsWith("/")) net.sendCommand(text.substring(1));
        else net.sendChat(text);
    }

    private static List<String> strings(JsonObject body, String key) {
        List<String> out = new ArrayList<>();
        if (Js.has(body, key)) for (JsonElement e : body.getAsJsonArray(key)) out.add(e.getAsString());
        return out;
    }

    private JsonObject state() {
        LocalPlayer p = mc.player;
        JsonObject o = new JsonObject();
        if (p == null || mc.level == null) {
            o.addProperty("inWorld", false);
            return o;
        }
        o.addProperty("inWorld", true);
        o.addProperty("name", p.getName().getString());
        o.addProperty("uuid", p.getUUID().toString());
        o.addProperty("x", p.getX());
        o.addProperty("y", p.getY());
        o.addProperty("z", p.getZ());
        o.addProperty("yaw", p.getYRot());
        o.addProperty("pitch", p.getXRot());
        o.addProperty("eye", p.getEyeHeight());
        o.addProperty("onGround", p.onGround());
        o.addProperty("flying", p.getAbilities().flying);
        o.addProperty("inWater", p.isInWater());
        o.addProperty("sneaking", p.isShiftKeyDown());
        o.addProperty("sprinting", p.isSprinting());
        o.addProperty("health", p.getHealth());
        o.addProperty("maxHealth", p.getMaxHealth());
        o.addProperty("absorption", p.getAbsorptionAmount());
        o.addProperty("armor", p.getArmorValue());
        o.addProperty("dead", p.isDeadOrDying());
        o.addProperty("gliding", p.isFallFlying());
        o.addProperty("focused", mc.isWindowActive());
        o.addProperty("food", p.getFoodData().getFoodLevel());
        o.addProperty("level", p.experienceLevel);
        o.addProperty("xp", Js.round(p.experienceProgress));
        o.addProperty("gamemode", mc.gameMode.getPlayerMode().toString());
        String dimension = mc.level.dimension().identifier().toString();
        o.addProperty("dimension", dimension);
        o.addProperty("mode", dimension.contains("creativeplus_editor") ? "dev" : dimension.contains("world_") ? "play" : "outside");
        o.addProperty("slot", p.getInventory().getSelectedSlot());
        o.add("hand", Items.item(p.getMainHandItem(), -1));
        if (p.isPassenger()) o.addProperty("vehicle", Scene.id(p.getVehicle()));
        List<JsonObject> effects = new ArrayList<>();
        for (MobEffectInstance e : p.getActiveEffects()) {
            effects.add(Js.obj("id", e.getEffect().getRegisteredName().replace("minecraft:", ""), "amplifier", e.getAmplifier(),
                    "ticks", e.getDuration()));
        }
        if (!effects.isEmpty()) Js.put(o, "effects", effects);
        var screen = mc.gui.screen();
        if (screen != null) {
            o.addProperty("screen", screen.getClass().getSimpleName());
            o.addProperty("screenTitle", screen.getTitle().getString());
        }
        HitResult hit = mc.hitResult;
        if (hit instanceof BlockHitResult b && hit.getType() == HitResult.Type.BLOCK) {
            BlockPos at = b.getBlockPos();
            o.add("target", Js.obj("kind", "block", "block", Scene.blockId(mc.level.getBlockState(at)), "x", at.getX(), "y", at.getY(),
                    "z", at.getZ(), "face", b.getDirection().getName()));
        } else if (hit instanceof EntityHitResult e && hit.getType() == HitResult.Type.ENTITY) {
            o.add("target", Js.obj("kind", "entity", "type", Scene.id(e.getEntity()), "name", e.getEntity().getName().getString(),
                    "uuid", e.getEntity().getUUID().toString()));
        }
        return o;
    }

    private JsonObject jobResult(Pilot.Job job, long waitMs) {
        if (job == null) throw new Refusal("нет такой задачи");
        try {
            JsonObject r = job.done.get(waitMs, TimeUnit.MILLISECONDS);
            return Js.obj("done", true, "result", r);
        } catch (TimeoutException e) {
            return Js.obj("done", false, "job", job.id);
        } catch (InterruptedException | ExecutionException e) {
            throw new Refusal("задача сорвалась: " + e);
        }
    }

    private static void tree(CommandNode<?> node, String prefix, int depth, List<String> out, int maxDepth) {
        for (CommandNode<?> child : node.getChildren()) {
            String part = child instanceof com.mojang.brigadier.tree.ArgumentCommandNode<?, ?> ? "<" + child.getName() + ">" : child.getName();
            String line = prefix + part;
            if (child.getCommand() != null || child.getChildren().isEmpty()) out.add(line);
            if (depth + 1 < maxDepth) tree(child, line + " ", depth + 1, out, maxDepth);
        }
    }

    private void routes() {
        http.route("GET /ping", r -> Js.obj("version", VERSION, "uptimeMs", System.currentTimeMillis() - started, "ticks", ticks,
                "inWorld", mc.player != null && mc.level != null, "events", Ring.head(), "retired", retired, "lastError", lastError));
        http.route("POST /stop", r -> {
            new Thread(Agent::shutdown, "justmc-agent-stop").start();
            return "ok";
        });
        http.route("GET /state", r -> client(this::state));
        http.route("GET /inventory", r -> client(() -> {
            needPlayer();
            return Items.inventory(mc);
        }));
        http.route("GET /gui", r -> client(() -> {
            needPlayer();
            return Items.gui(mc, "1".equals(r.param("all", "0")));
        }));
        http.route("POST /gui/click", r -> client(() -> {
            needPlayer();
            Items.click(mc, Js.integer(r.body(), "slot", 0), Js.integer(r.body(), "button", 0), Js.text(r.body(), "input", "PICKUP"));
            return "ok";
        }));
        http.route("POST /gui/close", r -> client(() -> {
            needPlayer();
            if (mc.gui.screen() != null) mc.player.closeContainer();
            return "ok";
        }));
        http.route("POST /respawn", r -> client(() -> {
            needPlayer();
            if (!mc.player.isDeadOrDying()) return false;
            mc.player.respawn();
            mc.gui.setScreen(null);
            return true;
        }));
        http.route("POST /say", r -> client(() -> {
            needPlayer();
            say(Js.text(r.body(), "text", null));
            return "ok";
        }));
        http.route("GET /hud", r -> client(() -> {
            needPlayer();
            return Hud.snapshot(mc);
        }));
        http.route("POST /scene", r -> client(() -> {
            needPlayer();
            return Scene.list(mc, r.body());
        }));
        http.route("POST /track", r -> {
            List<Tracker.Trail> trails = client(() -> {
                needPlayer();
                return Tracker.pick(mc, r.body());
            });
            try {
                return Tracker.watch(mc, trails, Js.integer(r.body(), "ms", 3000));
            } catch (InterruptedException e) {
                throw new Refusal("прервано");
            }
        });
        http.route("GET /block", r -> client(() -> {
            needPlayer();
            return Scene.block(mc, (int) r.number("x", 0), (int) r.number("y", 0), (int) r.number("z", 0));
        }));
        http.route("POST /region", r -> client(() -> {
            needPlayer();
            return Scene.region(mc, r.body());
        }));
        http.route("GET /events", r -> {
            Set<String> types = null;
            String wanted = r.param("types", "");
            if (!wanted.isEmpty()) types = new HashSet<>(List.of(wanted.split(",")));
            long since = r.number("since", 0);
            return Js.obj("head", Ring.head(), "events", Ring.merged(rings, since, types, (int) r.number("limit", 2000)));
        });
        http.route("POST /keys", r -> client(() -> {
            needPlayer();
            List<String> down = strings(r.body(), "down");
            List<String> up = strings(r.body(), "up");
            if (!up.isEmpty()) pilot.release(mc, up);
            if (!down.isEmpty()) pilot.hold(mc, down, Js.integer(r.body(), "ticks", -1));
            return "ok";
        }));
        http.route("POST /click", r -> client(() -> {
            needPlayer();
            pilot.click(mc, Js.text(r.body(), "key", "use"), Math.min(Js.integer(r.body(), "times", 1), 100));
            return "ok";
        }));
        http.route("POST /hotbar", r -> client(() -> {
            needPlayer();
            mc.player.getInventory().setSelectedSlot(Js.integer(r.body(), "slot", 0));
            return "ok";
        }));
        http.route("POST /look", r -> {
            Pilot.Job job = client(() -> {
                needPlayer();
                JsonObject b = r.body();
                LocalPlayer p = mc.player;
                double yaw = Js.num(b, "yaw", p.getYRot());
                double pitch = Js.num(b, "pitch", p.getXRot());
                if (Js.has(b, "x")) {
                    double dx = Js.num(b, "x", 0) - p.getX();
                    double dy = Js.num(b, "y", p.getEyeY()) - p.getEyeY();
                    double dz = Js.num(b, "z", 0) - p.getZ();
                    yaw = Math.toDegrees(Math.atan2(-dx, dz));
                    pitch = Math.toDegrees(Math.atan2(-dy, Math.hypot(dx, dz)));
                }
                if (Js.has(b, "entity")) {
                    var e = Scene.find(mc, Js.text(b, "entity", ""));
                    if (e == null) throw new Refusal("нет такой сущности рядом");
                    double dx = e.getX() - p.getX();
                    double dy = e.getY() + e.getBbHeight() * 0.6 - p.getEyeY();
                    double dz = e.getZ() - p.getZ();
                    yaw = Math.toDegrees(Math.atan2(-dx, dz));
                    pitch = Math.toDegrees(Math.atan2(-dy, Math.hypot(dx, dz)));
                }
                return pilot.start(mc, "look", pilot.look(yaw, pitch, Js.integer(b, "ticks", 0)));
            });
            return jobResult(job, 3000);
        });
        http.route("POST /goto", r -> {
            Pilot.Job job = client(() -> {
                needPlayer();
                return pilot.start(mc, "goto", pilot.go(r.body()));
            });
            return jobResult(job, Js.integer(r.body(), "waitMs", 200));
        });
        http.route("GET /job", r -> {
            Pilot.Job job = client(() -> pilot.job(r.number("id", 0)));
            return jobResult(job, r.number("wait", 500));
        });
        http.route("POST /release", r -> client(() -> {
            pilot.releaseAll(mc);
            if (replay != null) {
                replay.end(mc);
                replay.done.complete(Js.obj("ok", false, "outcome", "остановлено"));
                replay = null;
            }
            return "ok";
        }));
        http.route("POST /shot", r -> {
            CompletableFuture<JsonArray> shots = client(() -> camera.shoot(mc, r.body()));
            return await(shots, Js.integer(r.body(), "timeoutMs", 20000));
        });
        http.route("GET /commands", r -> client(() -> {
            needPlayer();
            List<String> out = new ArrayList<>();
            tree(mc.getConnection().getCommands().getRoot(), "/", 0, out, (int) r.number("depth", 4));
            return out;
        }));
        http.route("POST /exec", r -> {
            JsonObject b = r.body();
            if (Js.flag(b, "reset", false)) shell.reset();
            String code = Js.text(b, "code", null);
            if (code == null) return Js.obj("ok", true);
            return shell.run(code, Js.flag(b, "onClientThread", true), Js.integer(b, "timeoutMs", 8000), Js.flag(b, "keep", false));
        });
        http.route("POST /record/start", r -> client(() -> {
            needPlayer();
            if (recorder != null) throw new Refusal("запись уже идёт");
            recorder = new Recorder();
            tap.recorder(recorder);
            return "ok";
        }));
        http.route("POST /record/stop", r -> client(() -> {
            if (recorder == null) throw new Refusal("запись не идёт");
            return stopRecording();
        }));
        http.route("POST /replay", r -> {
            Recorder.Replay next = new Recorder.Replay(r.body());
            client(() -> {
                needPlayer();
                if (replay != null) throw new Refusal("воспроизведение уже идёт");
                replay = next;
                return "ok";
            });
            return await(next.done, Js.integer(r.body(), "timeoutMs", 600000));
        });
    }
}
