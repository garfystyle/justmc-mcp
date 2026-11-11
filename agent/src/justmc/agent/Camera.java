package justmc.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mojang.blaze3d.platform.NativeImage;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.Marker;

final class Camera {
    private static final int SETTLE_TICKS = 3;
    private static final int SHOT_LIMIT_TICKS = 60;

    private record View(boolean moved, double x, double y, double z, float yaw, float pitch) {}

    private final Path dir;
    private final ArrayDeque<View> queue = new ArrayDeque<>();
    private final List<String> done = new ArrayList<>();
    private CompletableFuture<JsonArray> result;
    private Marker marker;
    private boolean hidHud;
    private volatile boolean grabbing;
    private int wait;
    private int age;
    private int downscale = 1;
    private int counter;

    Camera(Path dir) {
        this.dir = dir;
    }

    boolean busy() {
        return result != null;
    }

    private static float yawTo(double dx, double dz) {
        return (float) Math.toDegrees(Math.atan2(-dx, dz));
    }

    private static float pitchTo(double dx, double dy, double dz) {
        return (float) Math.toDegrees(Math.atan2(-dy, Math.hypot(dx, dz)));
    }

    private static View aimed(double x, double y, double z, double tx, double ty, double tz) {
        return new View(true, x, y, z, yawTo(tx - x, tz - z), pitchTo(tx - x, ty - y, tz - z));
    }

    CompletableFuture<JsonArray> shoot(Minecraft mc, JsonObject spec) {
        if (result != null) throw new Refusal("снимок уже делается");
        if (mc.player == null || mc.level == null) throw new Refusal("игрока нет в мире");
        boolean moved = Js.has(spec, "orbit") || Js.has(spec, "views") || Js.has(spec, "camera");
        if (moved && mc.gui.screen() != null) throw new Refusal("открыто окно «" + mc.gui.screen().getTitle().getString() + "»: камера занята им, закрой его");
        downscale = Math.max(1, Js.integer(spec, "downscale", 1));
        queue.clear();
        done.clear();
        if (Js.has(spec, "orbit")) {
            JsonObject o = spec.getAsJsonObject("orbit");
            double cx = Js.num(o, "x", mc.player.getX());
            double cy = Js.num(o, "y", mc.player.getY() + 1);
            double cz = Js.num(o, "z", mc.player.getZ());
            double radius = Js.num(o, "radius", 6);
            double height = Js.num(o, "height", 2);
            int views = Math.min(Js.integer(o, "views", 4), 12);
            double start = Math.toRadians(Js.num(o, "start", 45));
            for (int i = 0; i < views; i++) {
                double a = start + Math.PI * 2 * i / views;
                queue.add(aimed(cx + Math.sin(a) * radius, cy + height, cz + Math.cos(a) * radius, cx, cy, cz));
            }
        } else if (Js.has(spec, "views")) {
            for (JsonElement e : spec.getAsJsonArray("views")) queue.add(view(e.getAsJsonObject(), mc));
        } else if (Js.has(spec, "camera")) {
            queue.add(view(spec.getAsJsonObject("camera"), mc));
        } else {
            queue.add(new View(false, 0, 0, 0, 0, 0));
        }
        result = new CompletableFuture<>();
        wait = 0;
        age = 0;
        grabbing = false;
        return result;
    }

    private static View view(JsonObject v, Minecraft mc) {
        double x = Js.num(v, "x", mc.player.getX());
        double y = Js.num(v, "y", mc.player.getEyeY());
        double z = Js.num(v, "z", mc.player.getZ());
        if (Js.has(v, "lookAt")) {
            JsonObject t = v.getAsJsonObject("lookAt");
            return aimed(x, y, z, Js.num(t, "x", x), Js.num(t, "y", y), Js.num(t, "z", z));
        }
        return new View(true, x, y, z, (float) Js.num(v, "yaw", mc.player.getYRot()), (float) Js.num(v, "pitch", mc.player.getXRot()));
    }

    void tick(Minecraft mc) {
        if (result == null) return;
        try {
            step(mc);
        } catch (Throwable t) {
            fail(mc, "камера: " + t);
        }
    }

    private void step(Minecraft mc) {
        if (++age > SHOT_LIMIT_TICKS * Math.max(1, queue.size() + 1)) {
            fail(mc, "снимок не сделан: окно игры свёрнуто или кадры не рисуются");
            return;
        }
        if (grabbing) return;
        if (wait > 0) {
            wait--;
            return;
        }
        View next = queue.peek();
        if (next == null) {
            restore(mc);
            JsonArray out = new JsonArray();
            synchronized (done) {
                for (String s : done) if (!s.isEmpty()) out.add(s);
            }
            CompletableFuture<JsonArray> r = result;
            result = null;
            r.complete(out);
            return;
        }
        if (next.moved && (marker == null || mc.getCameraEntity() != marker || !same(next))) {
            place(mc, next);
            wait = SETTLE_TICKS;
            return;
        }
        queue.poll();
        grab(mc);
    }

    private boolean same(View v) {
        return marker != null && marker.getX() == v.x && marker.getY() == v.y && marker.getZ() == v.z
                && marker.getYRot() == v.yaw && marker.getXRot() == v.pitch;
    }

    private void place(Minecraft mc, View v) {
        if (!mc.gui.hud.isHidden()) {
            mc.gui.hud.toggle();
            hidHud = true;
        }
        if (marker == null || marker.level() != mc.level) marker = new Marker(EntityTypes.MARKER, mc.level);
        marker.snapTo(v.x, v.y, v.z, v.yaw, v.pitch);
        if (mc.getCameraEntity() != marker) mc.setCameraEntity(marker);
    }

    private int fitting(Minecraft mc) {
        int w = mc.getWindow().getWidth();
        int h = mc.getWindow().getHeight();
        for (int d = downscale; d > 1; d--) if (w % d == 0 && h % d == 0) return d;
        return 1;
    }

    private void grab(Minecraft mc) {
        if (mc.getWindow().getWidth() <= 0 || mc.getWindow().getHeight() <= 0) {
            fail(mc, "окно игры свёрнуто");
            return;
        }
        grabbing = true;
        File file = dir.resolve("shot-" + System.nanoTime() + "-" + (counter++) + ".png").toFile();
        try {
            Screenshot.takeScreenshot(mc.gameRenderer.mainRenderTarget(), fitting(mc), (NativeImage image) -> save(image, file));
        } catch (Throwable t) {
            grabbing = false;
            fail(mc, "снимок не сделан: " + t);
        }
    }

    private void save(NativeImage image, File file) {
        Thread writer = new Thread(() -> {
            try (image) {
                image.writeToFile(file);
                synchronized (done) {
                    done.add(Base64.getEncoder().encodeToString(Files.readAllBytes(file.toPath())));
                }
            } catch (Throwable t) {
                synchronized (done) {
                    done.add("");
                }
            } finally {
                file.delete();
                grabbing = false;
            }
        }, "justmc-agent-shot");
        writer.setDaemon(true);
        writer.start();
    }

    private void fail(Minecraft mc, String why) {
        restore(mc);
        queue.clear();
        CompletableFuture<JsonArray> r = result;
        result = null;
        grabbing = false;
        if (r != null) r.completeExceptionally(new Refusal(why));
    }

    void restore(Minecraft mc) {
        if (marker != null && mc.getCameraEntity() == marker && mc.player != null) mc.setCameraEntity(mc.player);
        if (hidHud) {
            hidHud = false;
            if (mc.gui.hud.isHidden()) mc.gui.hud.toggle();
        }
    }
}
