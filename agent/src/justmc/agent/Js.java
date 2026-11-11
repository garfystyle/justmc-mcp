package justmc.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import java.util.Collection;
import java.util.Map;

final class Js {
    private Js() {}

    static JsonObject obj(Object... pairs) {
        JsonObject o = new JsonObject();
        for (int i = 0; i + 1 < pairs.length; i += 2) put(o, String.valueOf(pairs[i]), pairs[i + 1]);
        return o;
    }

    static void put(JsonObject o, String key, Object value) {
        if (value != null) o.add(key, of(value));
    }

    static JsonElement of(Object value) {
        if (value == null) return JsonNull.INSTANCE;
        if (value instanceof JsonElement e) return e;
        if (value instanceof Boolean b) return new JsonPrimitive(b);
        if (value instanceof Number n) return number(n);
        if (value instanceof Collection<?> c) {
            JsonArray a = new JsonArray();
            for (Object item : c) a.add(of(item));
            return a;
        }
        if (value instanceof Map<?, ?> m) {
            JsonObject o = new JsonObject();
            for (Map.Entry<?, ?> entry : m.entrySet()) o.add(String.valueOf(entry.getKey()), of(entry.getValue()));
            return o;
        }
        return new JsonPrimitive(String.valueOf(value));
    }

    private static JsonElement number(Number n) {
        double d = n.doubleValue();
        if (Double.isNaN(d) || Double.isInfinite(d)) return JsonNull.INSTANCE;
        if (n instanceof Float || n instanceof Double) return new JsonPrimitive(round(d));
        return new JsonPrimitive(n);
    }

    static double round(double d) {
        return Math.round(d * 1000.0) / 1000.0;
    }

    static double num(JsonObject o, String key, double fallback) {
        return has(o, key) ? o.get(key).getAsDouble() : fallback;
    }

    static int integer(JsonObject o, String key, int fallback) {
        return has(o, key) ? o.get(key).getAsInt() : fallback;
    }

    static boolean flag(JsonObject o, String key, boolean fallback) {
        return has(o, key) ? o.get(key).getAsBoolean() : fallback;
    }

    static String text(JsonObject o, String key, String fallback) {
        return has(o, key) ? o.get(key).getAsString() : fallback;
    }

    static boolean has(JsonObject o, String key) {
        return o != null && o.has(key) && !o.get(key).isJsonNull();
    }
}
