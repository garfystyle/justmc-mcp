package justmc.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.LerpingBossEvent;
import net.minecraft.client.gui.components.PlayerTabOverlay;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.numbers.StyledFormat;
import net.minecraft.world.scores.DisplaySlot;
import net.minecraft.world.scores.Objective;
import net.minecraft.world.scores.PlayerScoreEntry;
import net.minecraft.world.scores.PlayerTeam;
import net.minecraft.world.scores.Scoreboard;
import net.minecraft.world.scores.criteria.ObjectiveCriteria;

final class Hud {
    private Hud() {}

    @SuppressWarnings("unchecked")
    private static <T> T read(Object owner, Class<?> type, String name) {
        try {
            Field f = type.getDeclaredField(name);
            f.setAccessible(true);
            return (T) f.get(owner);
        } catch (ReflectiveOperationException e) {
            return null;
        }
    }

    private static String text(Component c) {
        return c == null ? null : c.getString();
    }

    static JsonObject snapshot(Minecraft mc) {
        var hud = mc.gui.hud;
        JsonObject o = new JsonObject();
        Class<?> hudClass = hud.getClass();
        Integer overlayTime = read(hud, hudClass, "overlayMessageTime");
        if (overlayTime != null && overlayTime > 0) Js.put(o, "actionbar", text(read(hud, hudClass, "overlayMessageString")));
        Integer titleTime = read(hud, hudClass, "titleTime");
        if (titleTime != null && titleTime > 0) {
            Js.put(o, "title", text(read(hud, hudClass, "title")));
            Js.put(o, "subtitle", text(read(hud, hudClass, "subtitle")));
        }
        Map<UUID, LerpingBossEvent> events = read(hud.getBossOverlay(), hud.getBossOverlay().getClass(), "events");
        JsonArray bars = new JsonArray();
        if (events != null) {
            for (LerpingBossEvent e : new ArrayList<>(events.values())) {
                bars.add(Js.obj("text", text(e.getName()), "progress", e.getProgress(), "color", e.getColor().getName(),
                        "style", e.getOverlay().getName()));
            }
        }
        if (!bars.isEmpty()) o.add("bossbars", bars);
        Js.put(o, "sidebar", sidebar(mc));
        PlayerTabOverlay tab = hud.getTabList();
        Js.put(o, "tabHeader", text(read(tab, PlayerTabOverlay.class, "header")));
        Js.put(o, "tabFooter", text(read(tab, PlayerTabOverlay.class, "footer")));
        ClientPacketListener net = mc.getConnection();
        if (net != null) {
            List<String> players = new ArrayList<>();
            for (PlayerInfo info : net.getOnlinePlayers()) {
                if (players.size() >= 40) break;
                players.add(tab.getNameForDisplay(info).getString());
            }
            Js.put(o, "tab", players);
        }
        return o;
    }

    private static JsonObject sidebar(Minecraft mc) {
        if (mc.level == null) return null;
        Scoreboard board = mc.level.getScoreboard();
        Objective objective = board.getDisplayObjective(DisplaySlot.SIDEBAR);
        if (objective == null) return null;
        List<PlayerScoreEntry> entries = new ArrayList<>();
        for (PlayerScoreEntry e : board.listPlayerScores(objective)) if (!e.isHidden()) entries.add(e);
        entries.sort(Comparator.comparingInt(PlayerScoreEntry::value).reversed().thenComparing(PlayerScoreEntry::owner));
        List<String> lines = new ArrayList<>();
        for (PlayerScoreEntry e : entries) {
            Component name = e.display();
            if (name == null) {
                PlayerTeam team = board.getPlayersTeam(e.owner());
                name = PlayerTeam.formatNameForTeam(team, e.ownerName());
            }
            String line = name.getString();
            String value = e.formatValue(objective.numberFormatOrDefault(StyledFormat.SIDEBAR_DEFAULT)).getString();
            lines.add(value.isEmpty() ? line : line + " " + value);
        }
        return Js.obj("title", text(objective.getDisplayName()), "lines", lines);
    }
}
