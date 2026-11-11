package justmc.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;

final class Ring {
    private static final AtomicLong SEQ = new AtomicLong();

    private final JsonObject[] items;
    private int next;
    private int size;

    Ring(int capacity) {
        items = new JsonObject[capacity];
    }

    static long head() {
        return SEQ.get();
    }

    synchronized void add(String type, JsonObject event) {
        event.addProperty("seq", SEQ.incrementAndGet());
        event.addProperty("t", System.currentTimeMillis());
        event.addProperty("type", type);
        items[next] = event;
        next = (next + 1) % items.length;
        if (size < items.length) size++;
    }

    synchronized void collect(long since, Set<String> types, List<JsonObject> out) {
        for (int i = 0; i < size; i++) {
            JsonObject e = items[(next - size + i + items.length * 2) % items.length];
            if (e.get("seq").getAsLong() <= since) continue;
            if (types == null || types.contains(e.get("type").getAsString())) out.add(e);
        }
    }

    static JsonArray merged(Ring[] rings, long since, Set<String> types, int limit) {
        List<JsonObject> all = new ArrayList<>();
        for (Ring r : rings) r.collect(since, types, all);
        all.sort((a, b) -> Long.compare(a.get("seq").getAsLong(), b.get("seq").getAsLong()));
        JsonArray out = new JsonArray();
        int from = Math.max(0, all.size() - limit);
        for (int i = from; i < all.size(); i++) out.add(all.get(i));
        return out;
    }
}
