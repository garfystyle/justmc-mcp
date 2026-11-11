package justmc.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import io.netty.channel.Channel;
import io.netty.channel.ChannelDuplexHandler;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelPromise;
import java.lang.reflect.Field;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.core.Holder;
import net.minecraft.core.particles.ParticleOptions;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.Connection;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.protocol.BundlePacket;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.common.ClientboundDisconnectPacket;
import net.minecraft.network.protocol.game.ClientboundAddEntityPacket;
import net.minecraft.network.protocol.game.ClientboundBlockUpdatePacket;
import net.minecraft.network.protocol.game.ClientboundBossEventPacket;
import net.minecraft.network.protocol.game.ClientboundClearTitlesPacket;
import net.minecraft.network.protocol.game.ClientboundContainerClosePacket;
import net.minecraft.network.protocol.game.ClientboundDisguisedChatPacket;
import net.minecraft.network.protocol.game.ClientboundEntityPositionSyncPacket;
import net.minecraft.network.protocol.game.ClientboundExplodePacket;
import net.minecraft.network.protocol.game.ClientboundGameEventPacket;
import net.minecraft.network.protocol.game.ClientboundLevelParticlesPacket;
import net.minecraft.network.protocol.game.ClientboundOpenScreenPacket;
import net.minecraft.network.protocol.game.ClientboundPlayerChatPacket;
import net.minecraft.network.protocol.game.ClientboundPlayerPositionPacket;
import net.minecraft.network.protocol.game.ClientboundRemoveEntitiesPacket;
import net.minecraft.network.protocol.game.ClientboundRemoveMobEffectPacket;
import net.minecraft.network.protocol.game.ClientboundRespawnPacket;
import net.minecraft.network.protocol.game.ClientboundSectionBlocksUpdatePacket;
import net.minecraft.network.protocol.game.ClientboundSetActionBarTextPacket;
import net.minecraft.network.protocol.game.ClientboundSetEntityDataPacket;
import net.minecraft.network.protocol.game.ClientboundSetEntityMotionPacket;
import net.minecraft.network.protocol.game.ClientboundSetHealthPacket;
import net.minecraft.network.protocol.game.ClientboundSetSubtitleTextPacket;
import net.minecraft.network.protocol.game.ClientboundSetTitleTextPacket;
import net.minecraft.network.protocol.game.ClientboundSetTitlesAnimationPacket;
import net.minecraft.network.protocol.game.ClientboundSoundEntityPacket;
import net.minecraft.network.protocol.game.ClientboundSoundPacket;
import net.minecraft.network.protocol.game.ClientboundStopSoundPacket;
import net.minecraft.network.protocol.game.ClientboundSystemChatPacket;
import net.minecraft.network.protocol.game.ClientboundTabListPacket;
import net.minecraft.network.protocol.game.ClientboundTeleportEntityPacket;
import net.minecraft.network.protocol.game.ClientboundUpdateMobEffectPacket;
import net.minecraft.network.protocol.game.ServerboundChatCommandPacket;
import net.minecraft.network.protocol.game.ServerboundChatPacket;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.world.BossEvent;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.level.block.state.BlockState;

final class Tap extends ChannelDuplexHandler {
    private static final String PREFIX = "justmc_agent_tap";
    private static final int MAX_BLOCKS_PER_UPDATE = 64;
    private static final int MAX_PARTS = 60;
    private static final int MAX_PARTS_SEEN = 240;

    private final String name = PREFIX + "_" + Integer.toHexString(System.identityHashCode(this));
    private final Ring main;
    private final Ring noise;
    private final Set<Integer> displays = ConcurrentHashMap.newKeySet();
    private final Map<String, JsonObject> burst = new HashMap<>();
    private volatile Channel channel;
    private volatile Recorder recorder;
    private long burstTick = -1;
    private String lastActionbar = "";
    private String lastTab = "";

    Tap(Ring main, Ring noise) {
        this.main = main;
        this.noise = noise;
    }

    @Override
    public boolean isSharable() {
        return true;
    }

    void recorder(Recorder r) {
        recorder = r;
    }

    void attach(Minecraft mc) {
        ClientPacketListener listener = mc.getConnection();
        if (listener == null) return;
        Connection connection = listener.getConnection();
        Channel now = channelOf(connection);
        if (now == null || now == channel || !now.isActive()) return;
        if (now.pipeline().get("packet_handler") == null) return;
        if (now.pipeline().get(name) == null) now.pipeline().addBefore("packet_handler", name, this);
        channel = now;
        displays.clear();
    }

    void detach() {
        Channel c = channel;
        channel = null;
        if (c == null) return;
        try {
            c.eventLoop().execute(() -> {
                if (c.pipeline().get(name) != null) c.pipeline().remove(name);
            });
        } catch (Throwable ignored) {
        }
    }

    private static Channel channelOf(Connection connection) {
        try {
            Field f = Connection.class.getDeclaredField("channel");
            f.setAccessible(true);
            return (Channel) f.get(connection);
        } catch (ReflectiveOperationException e) {
            return null;
        }
    }

    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) throws Exception {
        try {
            if (msg instanceof Packet<?> p) inbound(p);
        } catch (Throwable ignored) {
        }
        ctx.fireChannelRead(msg);
    }

    @Override
    public void write(ChannelHandlerContext ctx, Object msg, ChannelPromise promise) throws Exception {
        try {
            Recorder r = recorder;
            if (r != null) {
                if (msg instanceof ServerboundChatCommandPacket c) r.chat("/" + c.command());
                else if (msg instanceof ServerboundChatPacket c) r.chat(c.message());
            }
        } catch (Throwable ignored) {
        }
        ctx.write(msg, promise);
    }

    private void inbound(Packet<?> packet) {
        if (packet instanceof BundlePacket<?> bundle) {
            for (Packet<?> p : bundle.subPackets()) inbound(p);
            return;
        }
        if (packet instanceof ClientboundSystemChatPacket p) {
            if (p.overlay()) actionbar(p.content());
            else text("chat", p.content());
        } else if (packet instanceof ClientboundPlayerChatPacket p) {
            String body = p.unsignedContent() != null ? p.unsignedContent().getString() : p.body().content();
            String name = p.chatType().name().getString();
            main.add("chat", Js.obj("text", name.isEmpty() ? body : "<" + name + "> " + body, "player", true));
        } else if (packet instanceof ClientboundDisguisedChatPacket p) {
            text("chat", p.message());
        } else if (packet instanceof ClientboundSetActionBarTextPacket p) {
            actionbar(p.text());
        } else if (packet instanceof ClientboundSetTitleTextPacket p) {
            text("title", p.text());
        } else if (packet instanceof ClientboundSetSubtitleTextPacket p) {
            text("subtitle", p.text());
        } else if (packet instanceof ClientboundSetTitlesAnimationPacket p) {
            main.add("title_times", Js.obj("in", p.getFadeIn(), "stay", p.getStay(), "out", p.getFadeOut()));
        } else if (packet instanceof ClientboundClearTitlesPacket) {
            main.add("title_clear", new JsonObject());
        } else if (packet instanceof ClientboundBossEventPacket p) {
            boss(p);
        } else if (packet instanceof ClientboundSoundPacket p) {
            noise.add("sound", Js.obj("id", sound(p.getSound()), "source", p.getSource().name().toLowerCase(),
                    "volume", p.getVolume(), "pitch", p.getPitch(), "x", p.getX(), "y", p.getY(), "z", p.getZ()));
        } else if (packet instanceof ClientboundSoundEntityPacket p) {
            noise.add("sound", Js.obj("id", sound(p.getSound()), "source", p.getSource().name().toLowerCase(),
                    "volume", p.getVolume(), "pitch", p.getPitch(), "entity", p.getId()));
        } else if (packet instanceof ClientboundStopSoundPacket p) {
            noise.add("sound_stop", Js.obj("id", p.getName() == null ? "" : p.getName().toString()));
        } else if (packet instanceof ClientboundLevelParticlesPacket p) {
            particle(p);
        } else if (packet instanceof ClientboundAddEntityPacket p) {
            String type = entityId(p.getType());
            if (type.endsWith("_display")) displays.add(p.getId());
            noise.add("entity_add", Js.obj("id", p.getId(), "entity", type, "uuid", p.getUUID().toString(),
                    "x", p.getX(), "y", p.getY(), "z", p.getZ()));
        } else if (packet instanceof ClientboundRemoveEntitiesPacket p) {
            for (int id : p.getEntityIds()) displays.remove(id);
            noise.add("entity_remove", Js.obj("ids", new java.util.ArrayList<>(p.getEntityIds())));
        } else if (packet instanceof ClientboundSetEntityDataPacket p) {
            if (displays.contains(p.id())) entityData(p);
        } else if (packet instanceof ClientboundTeleportEntityPacket p) {
            if (displays.contains(p.id())) {
                noise.add("display_move", Js.obj("id", p.id(), "x", p.change().position().x,
                        "y", p.change().position().y, "z", p.change().position().z));
            }
        } else if (packet instanceof ClientboundEntityPositionSyncPacket p) {
            if (displays.contains(p.id())) {
                noise.add("display_move", Js.obj("id", p.id(), "x", p.values().position().x,
                        "y", p.values().position().y, "z", p.values().position().z));
            }
        } else if (packet instanceof ClientboundBlockUpdatePacket p) {
            noise.add("block", Js.obj("x", p.getPos().getX(), "y", p.getPos().getY(), "z", p.getPos().getZ(),
                    "block", block(p.getBlockState())));
        } else if (packet instanceof ClientboundSectionBlocksUpdatePacket p) {
            int[] left = {MAX_BLOCKS_PER_UPDATE};
            p.runUpdates((pos, state) -> {
                if (left[0]-- > 0) {
                    noise.add("block", Js.obj("x", pos.getX(), "y", pos.getY(), "z", pos.getZ(), "block", block(state)));
                }
            });
        } else if (packet instanceof ClientboundOpenScreenPacket p) {
            main.add("screen", Js.obj("title", p.getTitle().getString(), "id", p.getContainerId()));
        } else if (packet instanceof ClientboundContainerClosePacket) {
            main.add("screen_close", new JsonObject());
        } else if (packet instanceof ClientboundPlayerPositionPacket p) {
            main.add("teleport", Js.obj("x", p.change().position().x, "y", p.change().position().y, "z", p.change().position().z));
        } else if (packet instanceof ClientboundSetHealthPacket p) {
            main.add("health", Js.obj("health", p.getHealth(), "food", p.getFood()));
        } else if (packet instanceof ClientboundUpdateMobEffectPacket p) {
            if (isOwn(p.getEntityId())) {
                main.add("effect", Js.obj("id", p.getEffect().getRegisteredName(), "amplifier", p.getEffectAmplifier(),
                        "ticks", p.getEffectDurationTicks()));
            }
        } else if (packet instanceof ClientboundRemoveMobEffectPacket p) {
            if (isOwn(p.entityId())) main.add("effect_remove", Js.obj("id", p.effect().getRegisteredName()));
        } else if (packet instanceof ClientboundExplodePacket p) {
            main.add("explosion", Js.obj("x", p.center().x, "y", p.center().y, "z", p.center().z, "radius", p.radius()));
        } else if (packet instanceof ClientboundSetEntityMotionPacket p) {
            if (isOwn(p.id())) main.add("motion", Js.obj("x", p.movement().x, "y", p.movement().y, "z", p.movement().z));
        } else if (packet instanceof ClientboundGameEventPacket p) {
            if (p.getEvent() == ClientboundGameEventPacket.CHANGE_GAME_MODE) main.add("gamemode", Js.obj("mode", (int) p.getParam()));
        } else if (packet instanceof ClientboundRespawnPacket) {
            displays.clear();
            main.add("respawn", new JsonObject());
        } else if (packet instanceof ClientboundTabListPacket p) {
            tab(p.header().getString(), p.footer().getString());
        } else if (packet instanceof ClientboundDisconnectPacket p) {
            main.add("disconnect", Js.obj("reason", p.reason().getString()));
        }
    }

    private boolean isOwn(int id) {
        Minecraft mc = Minecraft.getInstance();
        return mc.player != null && mc.player.getId() == id;
    }

    private void actionbar(Component c) {
        String text = c.getString();
        if (text.equals(lastActionbar)) return;
        lastActionbar = text;
        if (!text.isEmpty()) main.add("actionbar", Js.obj("text", text));
    }

    private void tab(String header, String footer) {
        String stable = (header + "\n" + footer).replaceAll("\\d+", "#");
        if (stable.equals(lastTab)) return;
        lastTab = stable;
        main.add("tab", Js.obj("header", header, "footer", footer));
    }

    private void text(String type, Component c) {
        JsonObject event = Js.obj("text", c.getString());
        if ("chat".equals(type)) details(c, event);
        main.add(type, event);
    }

    private static void details(Component root, JsonObject out) {
        JsonArray parts = new JsonArray();
        java.util.ArrayDeque<Component> queue = new java.util.ArrayDeque<>();
        queue.add(root);
        int seen = 0;
        while (!queue.isEmpty() && seen++ < MAX_PARTS_SEEN && parts.size() < MAX_PARTS) {
            Component c = queue.poll();
            queue.addAll(c.getSiblings());
            JsonObject part = new JsonObject();
            if (c.getStyle().getHoverEvent() instanceof HoverEvent.ShowText hover) part.addProperty("hover", hover.value().getString());
            ClickEvent click = c.getStyle().getClickEvent();
            if (click instanceof ClickEvent.RunCommand run) part.addProperty("run", run.command());
            else if (click instanceof ClickEvent.SuggestCommand suggest) part.addProperty("suggest", suggest.command());
            if (part.size() == 0) continue;
            part.addProperty("text", c.plainCopy().getString());
            parts.add(part);
        }
        if (!parts.isEmpty()) out.add("parts", parts);
    }

    private static String sound(Holder<SoundEvent> holder) {
        return holder.value().location().toString().replace("minecraft:", "");
    }

    private static String entityId(EntityType<?> type) {
        return BuiltInRegistries.ENTITY_TYPE.getKey(type).toString().replace("minecraft:", "");
    }

    private static String block(BlockState state) {
        return BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString().replace("minecraft:", "");
    }

    private static String particleId(ParticleOptions options) {
        return BuiltInRegistries.PARTICLE_TYPE.getKey(options.getType()).toString().replace("minecraft:", "");
    }

    private void particle(ClientboundLevelParticlesPacket p) {
        long tick = System.currentTimeMillis() / 50;
        String id = particleId(p.getParticle());
        synchronized (burst) {
            if (tick != burstTick) {
                burst.clear();
                burstTick = tick;
            }
            JsonObject seen = burst.get(id);
            if (seen != null) {
                seen.addProperty("packets", seen.get("packets").getAsInt() + 1);
                seen.addProperty("count", seen.get("count").getAsInt() + Math.max(p.getCount(), 1));
                return;
            }
            JsonObject e = Js.obj("id", id, "x", p.getX(), "y", p.getY(), "z", p.getZ(),
                    "count", Math.max(p.getCount(), 1), "packets", 1, "speed", p.getMaxSpeed(),
                    "dx", p.getXDist(), "dy", p.getYDist(), "dz", p.getZDist());
            burst.put(id, e);
            noise.add("particle", e);
        }
    }

    private void entityData(ClientboundSetEntityDataPacket p) {
        JsonArray items = new JsonArray();
        for (SynchedEntityData.DataValue<?> v : p.packedItems()) items.add(Js.obj("i", v.id(), "v", String.valueOf(v.value())));
        noise.add("display_data", Js.obj("id", p.id(), "items", items));
    }

    private void boss(ClientboundBossEventPacket packet) {
        packet.dispatch(new ClientboundBossEventPacket.Handler() {
            @Override
            public void add(UUID id, Component name, float progress, BossEvent.BossBarColor color,
                    BossEvent.BossBarOverlay overlay, boolean darken, boolean music, boolean fog) {
                main.add("bossbar", Js.obj("op", "add", "id", id.toString(), "text", name.getString(), "progress", progress,
                        "color", color.getName(), "style", overlay.getName()));
            }

            @Override
            public void remove(UUID id) {
                main.add("bossbar", Js.obj("op", "remove", "id", id.toString()));
            }

            @Override
            public void updateProgress(UUID id, float progress) {
                main.add("bossbar", Js.obj("op", "progress", "id", id.toString(), "progress", progress));
            }

            @Override
            public void updateName(UUID id, Component name) {
                main.add("bossbar", Js.obj("op", "name", "id", id.toString(), "text", name.getString()));
            }

            @Override
            public void updateStyle(UUID id, BossEvent.BossBarColor color, BossEvent.BossBarOverlay overlay) {
                main.add("bossbar", Js.obj("op", "style", "id", id.toString(), "color", color.getName(), "style", overlay.getName()));
            }
        });
    }
}
