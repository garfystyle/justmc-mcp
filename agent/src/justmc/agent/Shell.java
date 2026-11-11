package justmc.agent;

import bsh.Interpreter;
import bsh.NameSpace;
import bsh.TargetError;
import com.google.gson.JsonObject;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import net.minecraft.client.Minecraft;

final class Shell {
    private static final Pattern SOURCE_NOISE = Pattern.compile("Sourced file: inline evaluation of: ``.*?'' : ", Pattern.DOTALL);
    private static final Pattern LOCATION = Pattern.compile(" : at Line: (\\d+) : in file: inline evaluation of: ``.*?'' : ([^\\n]*).*", Pattern.DOTALL);
    private static final Pattern MISSING_METHOD = Pattern.compile("ethod (\\w+)\\(.*?\\) not found in class\\s*'?([\\w.$]+)'?");
    private static final Pattern WORD_START = Pattern.compile("(?=\\p{Lu})");
    private static final Set<String> ACCESSOR_WORDS = Set.of("get", "set", "is", "has");
    private static final int MIN_WORD_LENGTH = 3;
    private static final int SIMILAR_METHODS = 10;

    private final Object owner;
    private final ClassLoader loader;
    private final Object lock = new Object();
    private Interpreter interpreter;

    Shell(Object owner, ClassLoader loader) {
        this.owner = owner;
        this.loader = loader;
    }

    void reset() {
        synchronized (lock) {
            interpreter = null;
        }
    }

    private Interpreter get() throws Exception {
        if (interpreter == null) {
            Interpreter i = new Interpreter();
            i.setClassLoader(loader);
            i.set("agent", owner);
            try {
                i.eval("api = new com.mcexec.Api();");
            } catch (Throwable ignored) {
            }
            i.eval("StringBuilder __out = new StringBuilder();");
            i.eval("void p(Object o){ __out.append(o).append(\"\\n\"); }");
            interpreter = i;
        }
        return interpreter;
    }

    JsonObject run(String code, boolean onClient, long timeoutMs, boolean keep) {
        Minecraft mc = Minecraft.getInstance();
        CompletableFuture<JsonObject> out = new CompletableFuture<>();
        if (onClient) {
            mc.execute(() -> out.complete(eval(code, keep)));
        } else {
            Thread t = new Thread(() -> out.complete(eval(code, keep)), "justmc-agent-shell");
            t.setDaemon(true);
            t.start();
        }
        try {
            return out.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            return Js.obj("ok", false, "error", "не уложилось в " + timeoutMs + " мс");
        } catch (InterruptedException | ExecutionException e) {
            return Js.obj("ok", false, "error", Agent.trace(e));
        }
    }

    private String signature(Method method) {
        String parameters = Arrays.stream(method.getParameterTypes()).map(Class::getSimpleName).collect(Collectors.joining(", "));
        return method.getName() + "(" + parameters + ")" + (method.isVarArgs() ? " varargs: передай массив" : "");
    }

    private String similarMethods(String wanted, String className) {
        try {
            Class<?> owner = Class.forName(className, false, loader);
            List<String> words = Arrays.stream(WORD_START.split(wanted))
                    .map(word -> word.toLowerCase(Locale.ROOT))
                    .filter(word -> word.length() >= MIN_WORD_LENGTH && !ACCESSOR_WORDS.contains(word))
                    .toList();
            TreeSet<String> close = new TreeSet<>();
            for (Method method : owner.getMethods()) {
                String name = method.getName().toLowerCase(Locale.ROOT);
                if (method.getDeclaringClass() != Object.class && words.stream().anyMatch(name::contains)) close.add(signature(method));
            }
            return close.stream().limit(SIMILAR_METHODS).collect(Collectors.joining(", "));
        } catch (Throwable ignored) {
            return "";
        }
    }

    private String explain(Throwable failure) {
        if (failure instanceof TargetError target && target.getTarget() != null) return Agent.trace(target.getTarget());
        String text = SOURCE_NOISE.matcher(failure.toString()).replaceAll("");
        Matcher location = LOCATION.matcher(text);
        if (location.find()) text = "строка " + location.group(1) + ": " + text.substring(0, location.start()) + " → " + location.group(2).trim();
        Matcher missing = MISSING_METHOD.matcher(text);
        if (missing.find()) {
            String similar = similarMethods(missing.group(1), missing.group(2));
            if (!similar.isEmpty()) text += "\nЕсть: " + similar;
        }
        return text;
    }

    private JsonObject eval(String code, boolean keep) {
        long started = System.nanoTime();
        JsonObject r = new JsonObject();
        synchronized (lock) {
            try {
                Interpreter i = get();
                i.eval("__out.setLength(0);");
                i.set("mc", Minecraft.getInstance());
                Object value = keep ? i.eval(code) : i.eval(code, new NameSpace(i.getNameSpace(), "call"));
                r.addProperty("ok", true);
                Js.put(r, "result", value == null ? null : String.valueOf(value));
                r.addProperty("out", String.valueOf(i.eval("__out.toString()")));
            } catch (Throwable t) {
                r.addProperty("ok", false);
                r.addProperty("error", explain(t));
                try {
                    r.addProperty("out", String.valueOf(get().eval("__out.toString()")));
                } catch (Throwable ignored) {
                }
            }
        }
        r.addProperty("ms", (System.nanoTime() - started) / 1_000_000L);
        return r;
    }
}
