package justmc.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.CustomData;
import net.minecraft.world.item.component.ItemLore;

final class Items {
    private static final int LORE_LINES = 12;

    private Items() {}

    static String id(ItemStack s) {
        return BuiltInRegistries.ITEM.getKey(s.getItem()).toString().replace("minecraft:", "");
    }

    static String brief(ItemStack s) {
        return id(s) + (s.getCount() > 1 ? " x" + s.getCount() : "");
    }

    static JsonObject item(ItemStack s, int slot) {
        JsonObject o = new JsonObject();
        if (slot >= 0) o.addProperty("slot", slot);
        o.addProperty("id", id(s));
        o.addProperty("count", s.getCount());
        o.addProperty("name", s.getHoverName().getString());
        ItemLore lore = s.get(DataComponents.LORE);
        if (lore != null && !lore.lines().isEmpty()) {
            List<String> lines = new ArrayList<>();
            for (Component line : lore.lines()) {
                if (lines.size() >= LORE_LINES) break;
                lines.add(line.getString());
            }
            Js.put(o, "lore", lines);
        }
        CustomData data = s.get(DataComponents.CUSTOM_DATA);
        if (data != null) {
            String text = data.copyTag().toString();
            o.addProperty("data", text.length() > 400 ? text.substring(0, 400) + "…" : text);
        }
        if (s.isDamaged()) o.addProperty("damage", s.getDamageValue());
        if (s.isEnchanted()) o.addProperty("enchanted", true);
        return o;
    }

    static JsonObject inventory(Minecraft mc) {
        LocalPlayer p = mc.player;
        Inventory inv = p.getInventory();
        JsonArray items = new JsonArray();
        for (int i = 0; i < inv.getContainerSize(); i++) {
            ItemStack s = inv.getItem(i);
            if (!s.isEmpty()) items.add(item(s, i));
        }
        return Js.obj("items", items, "selected", inv.getSelectedSlot());
    }

    static JsonObject gui(Minecraft mc, boolean all) {
        LocalPlayer p = mc.player;
        JsonObject o = new JsonObject();
        var screen = mc.gui.screen();
        o.addProperty("open", screen != null);
        if (screen != null) {
            o.addProperty("title", screen.getTitle().getString());
            o.addProperty("screen", screen.getClass().getSimpleName());
        }
        AbstractContainerMenu menu = p.containerMenu;
        List<Slot> slots = menu.slots;
        int total = slots.size();
        int own = menu == p.inventoryMenu ? total : Math.max(0, total - 36);
        o.addProperty("containerId", menu.containerId);
        o.addProperty("slots", total);
        o.addProperty("containerSlots", own);
        JsonArray items = new JsonArray();
        int limit = all ? total : own;
        for (int i = 0; i < limit; i++) {
            ItemStack s = slots.get(i).getItem();
            if (!s.isEmpty()) items.add(item(s, i));
        }
        o.add("items", items);
        ItemStack carried = menu.getCarried();
        if (!carried.isEmpty()) o.add("cursor", item(carried, -1));
        return o;
    }

    static void click(Minecraft mc, int slot, int button, String input) {
        LocalPlayer p = mc.player;
        ContainerInput kind;
        try {
            kind = ContainerInput.valueOf(input.toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new Refusal("нет вида клика «" + input + "»");
        }
        mc.gameMode.handleContainerInput(p.containerMenu.containerId, slot, button, kind, p);
    }
}
