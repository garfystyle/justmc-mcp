package justmc.agent;

import com.google.gson.JsonObject;
import com.mojang.math.Transformation;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.Display;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;
import org.joml.Vector3f;
import org.joml.Vector3fc;

final class Tracker {
    private static final int SAMPLE_PAUSE_MS = 3;
    private static final int MAX_TRAILS = 64;
    private static final int MAX_WATCH_MS = 20000;
    private static final int WORST_TRAILS = 6;
    private static final int WORST_JUMPS = 3;
    private static final double JUMP_RATIO = 4;
    private static final double JUMP_FLOOR = 0.1;
    private static final int NEIGHBOUR_FRAMES = 3;
    private static final double SHORTEST_FRAME_TICKS = 0.001;
    private static final double REVERSAL_FLOOR = 0.01;
    private static final double STILL = 1e-5;
    private static final int STALL_FRAMES = 3;
    private static final float PROGRESS_RESET = 0.2f;

    private record Point(double time, Vector3f part, Vec3 root, float yaw, float progress) {
        static double partStep(Point before, Point after) {
            return before.part.distance(after.part);
        }

        static double rootStep(Point before, Point after) {
            return before.root.distanceTo(after.root);
        }
    }

    private record Motion(double median, double max, int jumps, List<Integer> jumpFrames) {}

    static final class Trail {
        private final Entity entity;
        private final String name;
        private final List<Point> points = new ArrayList<>();

        private Trail(Entity entity) {
            this.entity = entity;
            this.name = entity.getName().getString();
        }

        private void sample(float partial) {
            if (entity.isRemoved()) return;
            double time = entity.tickCount + (double) partial;
            if (!points.isEmpty() && time <= points.getLast().time()) return;
            points.add(new Point(time, partCentre(entity, partial), entity.getPosition(partial), entity.getYRot(partial), progress(entity, partial)));
        }

        private JsonObject report() {
            Motion part = motion(points, Point::partStep);
            Motion root = motion(points, Point::rootStep);
            JsonObject out = Js.obj("name", name, "type", Scene.id(entity), "frames", points.size(),
                    "part", Js.obj("median", part.median(), "max", part.max(), "jumps", part.jumps()),
                    "root", Js.obj("median", root.median(), "max", root.max(), "jumps", root.jumps()),
                    "reversals", reversals(), "stalls", stalls(), "interpolationResets", resets());
            if (points.size() > 1) {
                out.addProperty("travel", travel());
                out.add("yaw", Js.of(List.of(points.getFirst().yaw(), points.getLast().yaw())));
            }
            if (!part.jumpFrames().isEmpty()) out.add("firstJumps", Js.of(jumpsAt(part.jumpFrames())));
            return out;
        }

        private List<JsonObject> jumpsAt(List<Integer> frames) {
            List<JsonObject> out = new ArrayList<>();
            for (int frame : frames.subList(0, Math.min(WORST_JUMPS, frames.size()))) {
                Point before = points.get(frame);
                Point after = points.get(frame + 1);
                out.add(Js.obj("tick", after.time() - points.getFirst().time(),
                        "step", Point.partStep(before, after),
                        "progress", List.of(before.progress(), after.progress())));
            }
            return out;
        }

        private int reversals() {
            int count = 0;
            for (int i = 2; i < points.size(); i++) {
                Vector3f earlier = new Vector3f(points.get(i - 1).part()).sub(points.get(i - 2).part());
                Vector3f later = new Vector3f(points.get(i).part()).sub(points.get(i - 1).part());
                if (earlier.dot(later) < 0 && earlier.length() > REVERSAL_FLOOR && later.length() > REVERSAL_FLOOR) count++;
            }
            return count;
        }

        private int stalls() {
            int count = 0;
            int still = 0;
            for (int i = 1; i < points.size(); i++) {
                if (Point.partStep(points.get(i - 1), points.get(i)) < STILL) {
                    still++;
                } else {
                    if (still >= STALL_FRAMES) count++;
                    still = 0;
                }
            }
            return count;
        }

        private int resets() {
            int count = 0;
            for (int i = 1; i < points.size(); i++) {
                if (points.get(i).progress() - points.get(i - 1).progress() < -PROGRESS_RESET) count++;
            }
            return count;
        }

        private double travel() {
            double sum = 0;
            for (int i = 1; i < points.size(); i++) sum += Point.rootStep(points.get(i - 1), points.get(i));
            return sum;
        }

        private int jumpCount() {
            return motion(points, Point::partStep).jumps() + motion(points, Point::rootStep).jumps();
        }
    }

    private Tracker() {}

    private interface Step {
        double between(Point before, Point after);
    }

    private static Vector3f partCentre(Entity entity, float partial) {
        if (!(entity instanceof Display display) || display.renderState() == null) return new Vector3f();
        Transformation now = display.renderState().transformation().get(display.calculateInterpolationProgress(partial));
        Vector3fc scale = now.scale();
        Vector3f centre = new Vector3f(scale.x() * 0.5f, scale.y() * 0.5f, scale.z() * 0.5f);
        now.leftRotation().transform(centre);
        return centre.add(now.translation());
    }

    private static float progress(Entity entity, float partial) {
        return entity instanceof Display display && display.renderState() != null ? display.calculateInterpolationProgress(partial) : 0f;
    }

    private static Motion motion(List<Point> points, Step step) {
        int frames = Math.max(points.size() - 1, 0);
        double[] steps = new double[frames];
        double[] durations = new double[frames];
        for (int i = 0; i < frames; i++) {
            steps[i] = step.between(points.get(i), points.get(i + 1));
            durations[i] = Math.max(points.get(i + 1).time() - points.get(i).time(), SHORTEST_FRAME_TICKS);
        }
        List<Integer> jumps = new ArrayList<>();
        double max = 0;
        for (int i = 0; i < frames; i++) {
            max = Math.max(max, steps[i]);
            if (steps[i] > Math.max(neighbourSpeed(steps, durations, i) * durations[i] * JUMP_RATIO, JUMP_FLOOR)) jumps.add(i);
        }
        return new Motion(median(Arrays.stream(steps).filter(s -> s > STILL).toArray()), max, jumps.size(), jumps);
    }

    private static double neighbourSpeed(double[] steps, double[] durations, int frame) {
        int from = Math.max(frame - NEIGHBOUR_FRAMES, 0);
        int to = Math.min(frame + NEIGHBOUR_FRAMES, steps.length - 1);
        double[] speeds = new double[to - from];
        int filled = 0;
        for (int i = from; i <= to; i++) {
            if (i != frame) speeds[filled++] = steps[i] / durations[i];
        }
        return median(speeds);
    }

    private static double median(double[] values) {
        if (values.length == 0) return 0;
        double[] sorted = values.clone();
        Arrays.sort(sorted);
        return sorted[sorted.length / 2];
    }

    static List<Trail> pick(Minecraft mc, JsonObject query) {
        List<Entity> found = Scene.matching(mc, query);
        if (found.isEmpty()) throw new Refusal("таких сущностей нет в радиусе " + Js.num(query, "radius", 32) + " от камеры: подними radius или задай x, y, z");
        List<Trail> trails = new ArrayList<>();
        for (Entity entity : found.subList(0, Math.min(MAX_TRAILS, found.size()))) trails.add(new Trail(entity));
        return trails;
    }

    static JsonObject watch(Minecraft mc, List<Trail> trails, int wantedMs) throws InterruptedException {
        int ms = Math.min(wantedMs, MAX_WATCH_MS);
        long end = System.nanoTime() + ms * 1_000_000L;
        while (System.nanoTime() < end) {
            float partial = mc.getDeltaTracker().getGameTimeDeltaPartialTick(false);
            for (Trail trail : trails) trail.sample(partial);
            Thread.sleep(SAMPLE_PAUSE_MS);
        }
        List<Trail> worst = new ArrayList<>(trails);
        worst.sort(Comparator.comparingInt(Trail::jumpCount).reversed());
        int jumps = trails.stream().mapToInt(Trail::jumpCount).sum();
        int frames = trails.stream().mapToInt(trail -> trail.points.size()).max().orElse(0);
        return Js.obj("ms", ms, "tracked", trails.size(), "fps", frames * 1000 / Math.max(ms, 1), "jumps", jumps,
                "worst", worst.subList(0, Math.min(WORST_TRAILS, worst.size())).stream().map(Trail::report).toList());
    }
}
