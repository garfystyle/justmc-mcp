package justmc.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.math.Transformation;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.regex.Pattern;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.world.entity.Display;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.SignBlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import org.joml.Quaternionf;
import org.joml.Quaternionfc;
import org.joml.Vector3f;
import org.joml.Vector3fc;

final class Scene {
    private static final int LIST_CELLS = 300_000;
    private static final Pattern NUMBER = Pattern.compile("\\d+");

    private Scene() {}

    static String id(Entity e) {
        return BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString().replace("minecraft:", "");
    }

    static String blockId(BlockState s) {
        return BuiltInRegistries.BLOCK.getKey(s.getBlock()).toString().replace("minecraft:", "");
    }

    static Entity find(Minecraft mc, String wanted) {
        Entity best = null;
        double bestD = Double.MAX_VALUE;
        Pattern pattern = compile(wanted);
        for (Entity e : mc.level.entitiesForRendering()) {
            if (e == mc.player) continue;
            boolean same = e.getUUID().toString().equals(wanted) || pattern.matcher(e.getName().getString()).find()
                    || pattern.matcher(id(e)).find();
            if (!same) continue;
            double d = e.distanceToSqr(mc.player);
            if (d < bestD) {
                best = e;
                bestD = d;
            }
        }
        return best;
    }

    private static Pattern compile(String text) {
        return text == null ? null : Pattern.compile(text, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    }

    static List<Entity> matching(Minecraft mc, JsonObject q) {
        LocalPlayer p = mc.player;
        Entity center = mc.getCameraEntity() != null ? mc.getCameraEntity() : p;
        double radius = Js.num(q, "radius", 32);
        Pattern type = compile(Js.text(q, "type", null));
        Pattern name = compile(Js.text(q, "name", null));
        Pattern text = compile(Js.text(q, "text", null));
        boolean onlyDisplays = Js.flag(q, "displays", false);
        double cx = Js.num(q, "x", center.getX());
        double cy = Js.num(q, "y", center.getY());
        double cz = Js.num(q, "z", center.getZ());
        List<Entity> found = new ArrayList<>();
        for (Entity e : mc.level.entitiesForRendering()) {
            if (e == p) continue;
            if (onlyDisplays && !(e instanceof Display)) continue;
            if (Math.sqrt(e.distanceToSqr(cx, cy, cz)) > radius) continue;
            if (type != null && !type.matcher(id(e)).find()) continue;
            if (name != null && !name.matcher(e.getName().getString()).find()) continue;
            if (text != null && !(e instanceof Display.TextDisplay t && text.matcher(t.getText().getString()).find())) continue;
            found.add(e);
        }
        found.sort(Comparator.comparingDouble(e -> e.distanceToSqr(cx, cy, cz)));
        return found;
    }

    private static Map<String, Integer> counts(List<Entity> found) {
        Map<String, Integer> out = new TreeMap<>();
        for (Entity e : found) {
            String name = e.hasCustomName() ? " «" + NUMBER.matcher(e.getCustomName().getString()).replaceAll("#") + "»" : "";
            out.merge(id(e) + name, 1, Integer::sum);
        }
        return out;
    }

    static JsonObject list(Minecraft mc, JsonObject q) {
        List<Entity> found = matching(mc, q);
        double cx = Js.num(q, "x", mc.player.getX());
        double cy = Js.num(q, "y", mc.player.getY());
        double cz = Js.num(q, "z", mc.player.getZ());
        JsonArray rows = new JsonArray();
        int n = Math.min(found.size(), Js.integer(q, "limit", 40));
        for (int i = 0; i < n; i++) rows.add(row(found.get(i), cx, cy, cz));
        return Js.obj("total", found.size(), "counts", counts(found), "entities", rows);
    }

    private static JsonObject row(Entity e, double cx, double cy, double cz) {
        JsonObject o = Js.obj("id", e.getId(), "uuid", e.getUUID().toString(), "type", id(e), "name", e.getName().getString(),
                "distance", Math.sqrt(e.distanceToSqr(cx, cy, cz)), "x", e.getX(), "y", e.getY(), "z", e.getZ(),
                "yaw", e.getYRot(), "pitch", e.getXRot());
        if (e.isCustomNameVisible()) o.addProperty("nameVisible", true);
        if (e.isPassenger()) o.addProperty("riding", id(e.getVehicle()));
        if (!e.getPassengers().isEmpty()) o.addProperty("passengers", e.getPassengers().size());
        if (e.isCurrentlyGlowing()) o.addProperty("glowing", true);
        if (e.isInvisible()) o.addProperty("invisible", true);
        if (e instanceof LivingEntity l) {
            o.addProperty("health", Js.round(l.getHealth()));
            o.addProperty("maxHealth", Js.round(l.getMaxHealth()));
        }
        if (e instanceof Display d) o.add("display", display(d));
        return o;
    }

    private static JsonObject display(Display d) {
        JsonObject o = new JsonObject();
        for (Class<?> c = d.getClass(); c != null && c != Entity.class; c = c.getSuperclass()) {
            for (Field f : c.getDeclaredFields()) {
                if (!Modifier.isStatic(f.getModifiers()) || f.getType() != EntityDataAccessor.class) continue;
                try {
                    f.setAccessible(true);
                    EntityDataAccessor<?> accessor = (EntityDataAccessor<?>) f.get(null);
                    Object value = d.getEntityData().get(accessor);
                    Js.put(o, field(f.getName()), value(value));
                } catch (Throwable ignored) {
                }
            }
        }
        derived(o);
        live(d, o);
        return o;
    }

    private static void live(Display d, JsonObject o) {
        try {
            Display.RenderState state = d.renderState();
            if (state == null) return;
            float progress = d.calculateInterpolationProgress(0f);
            Transformation now = state.transformation().get(progress);
            Vector3fc t = now.translation();
            Vector3fc s = now.scale();
            JsonObject live = Js.obj("progress", progress,
                    "translation", List.of(Js.round(t.x()), Js.round(t.y()), Js.round(t.z())),
                    "scale", List.of(Js.round(s.x()), Js.round(s.y()), Js.round(s.z())));
            if (d instanceof Display.TextDisplay text && text.textRenderState() != null) {
                live.addProperty("textOpacity", text.textRenderState().textOpacity().get(progress) & 0xFF);
                live.addProperty("background", String.format("#%08X", text.textRenderState().backgroundColor().get(progress)));
            }
            o.add("now", live);
        } catch (Throwable ignored) {
        }
    }

    private static String field(String constant) {
        String s = constant.replaceFirst("^DATA_", "").replaceFirst("_ID$", "").toLowerCase(Locale.ROOT);
        StringBuilder out = new StringBuilder();
        boolean up = false;
        for (char c : s.toCharArray()) {
            if (c == '_') {
                up = true;
                continue;
            }
            out.append(up ? Character.toUpperCase(c) : c);
            up = false;
        }
        return out.toString();
    }

    private static Object value(Object v) {
        if (v instanceof Vector3fc t) return List.of(Js.round(t.x()), Js.round(t.y()), Js.round(t.z()));
        if (v instanceof Quaternionfc q) return List.of(Js.round(q.x()), Js.round(q.y()), Js.round(q.z()), Js.round(q.w()));
        if (v instanceof Component c) return c.getString();
        if (v instanceof BlockState s) return blockText(s);
        if (v instanceof ItemStack i) return i.isEmpty() ? "пусто" : Items.brief(i);
        if (v instanceof Byte b) return (int) b;
        return v;
    }

    private static void derived(JsonObject o) {
        if (o.has("billboardRenderConstraints")) {
            String[] names = {"fixed", "vertical", "horizontal", "center"};
            int i = o.remove("billboardRenderConstraints").getAsInt();
            o.addProperty("billboard", i >= 0 && i < names.length ? names[i] : String.valueOf(i));
        }
        if (o.has("brightnessOverride")) {
            int b = o.remove("brightnessOverride").getAsInt();
            if (b >= 0) o.add("brightness", Js.obj("block", (b >> 4) & 15, "sky", (b >> 20) & 15));
        }
        if (o.has("glowColorOverride")) {
            int c = o.remove("glowColorOverride").getAsInt();
            if (c != -1) o.addProperty("glowColor", String.format("#%06X", c & 0xFFFFFF));
        }
        if (o.has("backgroundColor")) {
            int c = o.remove("backgroundColor").getAsInt();
            o.addProperty("background", String.format("#%08X", c));
        }
        if (o.has("textOpacity")) {
            int a = o.remove("textOpacity").getAsInt() & 0xFF;
            o.addProperty("textOpacity", a);
        }
        if (o.has("styleFlags")) {
            int f = o.remove("styleFlags").getAsInt();
            o.addProperty("shadow", (f & 1) != 0);
            o.addProperty("seeThrough", (f & 2) != 0);
            o.addProperty("defaultBackground", (f & 4) != 0);
            o.addProperty("align", (f & 8) != 0 ? "left" : (f & 16) != 0 ? "right" : "center");
        }
        if (o.has("itemDisplay")) {
            String[] names = {"none", "thirdperson_lefthand", "thirdperson_righthand", "firstperson_lefthand",
                "firstperson_righthand", "head", "gui", "ground", "fixed", "on_shelf"};
            int i = o.remove("itemDisplay").getAsInt();
            o.addProperty("modelType", i >= 0 && i < names.length ? names[i] : String.valueOf(i));
        }
        euler(o, "leftRotation");
        euler(o, "rightRotation");
    }

    private static void euler(JsonObject o, String key) {
        if (!o.has(key)) return;
        JsonArray a = o.getAsJsonArray(key);
        Quaternionf q = new Quaternionf(a.get(0).getAsFloat(), a.get(1).getAsFloat(), a.get(2).getAsFloat(), a.get(3).getAsFloat());
        if (q.x == 0 && q.y == 0 && q.z == 0) return;
        Vector3f e = q.getEulerAnglesYXZ(new Vector3f());
        o.add(key + "Deg", Js.of(List.of(Js.round(Math.toDegrees(e.x)), Js.round(Math.toDegrees(e.y)), Js.round(Math.toDegrees(e.z)))));
    }

    static String blockText(BlockState s) {
        StringBuilder out = new StringBuilder(blockId(s));
        if (!s.getProperties().isEmpty()) {
            out.append('[');
            boolean first = true;
            for (Property<?> p : s.getProperties()) {
                if (!first) out.append(',');
                first = false;
                out.append(p.getName()).append('=').append(s.getValue(p));
            }
            out.append(']');
        }
        return out.toString();
    }

    static JsonObject block(Minecraft mc, int x, int y, int z) {
        BlockPos pos = new BlockPos(x, y, z);
        BlockState state = mc.level.getBlockState(pos);
        JsonObject o = Js.obj("x", x, "y", y, "z", z, "block", blockId(state), "state", blockText(state),
                "loaded", mc.level.hasChunkAt(pos));
        BlockEntity be = mc.level.getBlockEntity(pos);
        if (be instanceof SignBlockEntity sign) {
            List<String> front = new ArrayList<>();
            List<String> back = new ArrayList<>();
            for (int i = 0; i < 4; i++) {
                front.add(sign.getFrontText().getMessage(i, false).getString());
                back.add(sign.getBackText().getMessage(i, false).getString());
            }
            Js.put(o, "signFront", front);
            Js.put(o, "signBack", back);
        }
        return o;
    }

    static JsonObject region(Minecraft mc, JsonObject q) {
        LocalPlayer p = mc.player;
        int radius = Js.integer(q, "radius", 6);
        int height = Js.integer(q, "height", 2);
        int cx = (int) Math.floor(Js.num(q, "x", p.getX()));
        int cy = (int) Math.floor(Js.num(q, "y", p.getY()));
        int cz = (int) Math.floor(Js.num(q, "z", p.getZ()));
        int x1 = Js.integer(q, "x1", cx - radius);
        int y1 = Js.integer(q, "y1", cy - height);
        int z1 = Js.integer(q, "z1", cz - radius);
        int x2 = Js.integer(q, "x2", cx + radius);
        int y2 = Js.integer(q, "y2", cy + height);
        int z2 = Js.integer(q, "z2", cz + radius);
        int sx = Math.abs(x2 - x1) + 1;
        int sy = Math.abs(y2 - y1) + 1;
        int sz = Math.abs(z2 - z1) + 1;
        if ((long) sx * sy * sz > LIST_CELLS) throw new Refusal("слишком большая область: " + sx + "×" + sy + "×" + sz);
        int ox = Math.min(x1, x2);
        int oy = Math.min(y1, y2);
        int oz = Math.min(z1, z2);
        List<String> palette = new ArrayList<>();
        java.util.Map<String, Integer> index = new java.util.HashMap<>();
        java.util.Map<String, Integer> counts = new java.util.TreeMap<>();
        StringBuilder cells = new StringBuilder();
        BlockPos.MutableBlockPos at = new BlockPos.MutableBlockPos();
        for (int y = 0; y < sy; y++) {
            for (int z = 0; z < sz; z++) {
                for (int x = 0; x < sx; x++) {
                    at.set(ox + x, oy + y, oz + z);
                    String id = blockId(mc.level.getBlockState(at));
                    Integer i = index.get(id);
                    if (i == null) {
                        i = palette.size();
                        index.put(id, i);
                        palette.add(id);
                    }
                    counts.merge(id, 1, Integer::sum);
                    cells.append(i).append(',');
                }
            }
        }
        return Js.obj("origin", List.of(ox, oy, oz), "size", List.of(sx, sy, sz), "palette", palette, "counts", counts,
                "cells", cells.toString());
    }
}
