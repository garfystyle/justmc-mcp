package justmc.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Options;
import net.minecraft.client.player.LocalPlayer;

final class Recorder {
    private static final int MAX_TICKS = 20 * 60 * 10;
    private static final String[] NAMES = {"forward", "back", "left", "right", "jump", "sneak", "sprint", "use", "attack"};

    private final JsonArray frames = new JsonArray();
    private final List<String> pending = new ArrayList<>();
    private int tick;
    private int lastMask = -1;
    private int lastSlot = -1;
    private float lastYaw = Float.NaN;
    private float lastPitch = Float.NaN;

    private static KeyMapping[] keys(Options o) {
        return new KeyMapping[] {o.keyUp, o.keyDown, o.keyLeft, o.keyRight, o.keyJump, o.keyShift, o.keySprint, o.keyUse, o.keyAttack};
    }

    synchronized void chat(String text) {
        pending.add(text);
    }

    synchronized boolean tick(Minecraft mc) {
        LocalPlayer p = mc.player;
        if (p == null) return true;
        tick++;
        JsonObject f = new JsonObject();
        int mask = 0;
        KeyMapping[] all = keys(mc.options);
        for (int i = 0; i < all.length; i++) if (all[i].isDown()) mask |= 1 << i;
        if (mask != lastMask) {
            f.addProperty("k", mask);
            lastMask = mask;
        }
        if (p.getYRot() != lastYaw || p.getXRot() != lastPitch) {
            f.addProperty("r", Js.round(p.getYRot()) + "," + Js.round(p.getXRot()));
            lastYaw = p.getYRot();
            lastPitch = p.getXRot();
        }
        int slot = p.getInventory().getSelectedSlot();
        if (slot != lastSlot) {
            f.addProperty("s", slot);
            lastSlot = slot;
        }
        if (!pending.isEmpty()) {
            JsonArray said = new JsonArray();
            for (String s : pending) said.add(s);
            pending.clear();
            f.add("c", said);
        }
        if (f.size() > 0) {
            f.addProperty("t", tick);
            frames.add(f);
        }
        return tick < MAX_TICKS;
    }

    synchronized JsonObject finish(Minecraft mc) {
        LocalPlayer p = mc.player;
        return Js.obj("ticks", tick, "frames", frames, "keys", List.of(NAMES),
                "end", p == null ? null : Js.obj("x", p.getX(), "y", p.getY(), "z", p.getZ()));
    }

    static final class Replay {
        private final JsonArray frames;
        private final int ticks;
        final CompletableFuture<JsonObject> done = new CompletableFuture<>();
        private int tick;
        private int index;

        Replay(JsonObject macro) {
            frames = macro.getAsJsonArray("frames");
            ticks = Js.integer(macro, "ticks", 0);
        }

        boolean tick(Minecraft mc, Agent agent) {
            LocalPlayer p = mc.player;
            if (p == null) {
                end(mc);
                done.complete(Js.obj("ok", false, "outcome", "игрока нет"));
                return true;
            }
            tick++;
            while (index < frames.size() && frames.get(index).getAsJsonObject().get("t").getAsInt() <= tick) {
                apply(mc, p, frames.get(index++).getAsJsonObject(), agent);
            }
            if (tick >= ticks) {
                end(mc);
                done.complete(Js.obj("ok", true, "ticks", tick));
                return true;
            }
            return false;
        }

        private void apply(Minecraft mc, LocalPlayer p, JsonObject f, Agent agent) {
            if (f.has("k")) {
                int mask = f.get("k").getAsInt();
                KeyMapping[] all = keys(mc.options);
                for (int i = 0; i < all.length; i++) all[i].setDown((mask & (1 << i)) != 0);
            }
            if (f.has("r")) {
                String[] r = f.get("r").getAsString().split(",");
                Pilot.turn(p, Double.parseDouble(r[0]), Double.parseDouble(r[1]));
            }
            if (f.has("s")) p.getInventory().setSelectedSlot(f.get("s").getAsInt());
            if (f.has("c")) for (JsonElement e : f.getAsJsonArray("c")) agent.say(e.getAsString());
        }

        void end(Minecraft mc) {
            for (KeyMapping k : keys(mc.options)) k.setDown(false);
        }
    }
}
