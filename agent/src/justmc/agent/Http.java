package justmc.agent;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class Http {
    interface Route {
        Object handle(Request r) throws Exception;
    }

    record Request(Map<String, String> query, JsonObject body) {
        String param(String key, String fallback) {
            return query.getOrDefault(key, fallback);
        }

        long number(String key, long fallback) {
            String v = query.get(key);
            return v == null ? fallback : Long.parseLong(v);
        }
    }

    private static final int MAX_BODY = 8 * 1024 * 1024;
    private static final int MAX_LINE = 8192;
    private static final int READ_TIMEOUT = 15_000;

    private final Map<String, Route> routes = new HashMap<>();
    private final String token;
    private final ExecutorService pool;
    private final ServerSocket socket;
    private volatile boolean running = true;

    Http(String token) throws IOException {
        this.token = token;
        this.socket = new ServerSocket(0, 64, InetAddress.getLoopbackAddress());
        this.pool = Executors.newCachedThreadPool(run -> {
            Thread t = new Thread(run, "justmc-agent-http");
            t.setDaemon(true);
            return t;
        });
        Thread accept = new Thread(this::accept, "justmc-agent-accept");
        accept.setDaemon(true);
        accept.start();
    }

    int port() {
        return socket.getLocalPort();
    }

    void route(String key, Route route) {
        routes.put(key, route);
    }

    void close() {
        running = false;
        try {
            socket.close();
        } catch (IOException ignored) {
        }
        pool.shutdown();
    }

    private void accept() {
        while (running) {
            try {
                Socket client = socket.accept();
                pool.execute(() -> serve(client));
            } catch (IOException e) {
                if (!running) return;
            }
        }
    }

    private void serve(Socket client) {
        try (client) {
            client.setSoTimeout(READ_TIMEOUT);
            InputStream in = new BufferedInputStream(client.getInputStream());
            String first = line(in);
            if (first == null) return;
            String[] parts = first.split(" ");
            if (parts.length < 2) return;
            Map<String, String> headers = new HashMap<>();
            for (String h = line(in); h != null && !h.isEmpty(); h = line(in)) {
                int at = h.indexOf(':');
                if (at > 0) headers.put(h.substring(0, at).trim().toLowerCase(Locale.ROOT), h.substring(at + 1).trim());
            }
            if (headers.containsKey("origin") || !token.equals(headers.get("x-agent-token"))) {
                respond(client, 403, Js.obj("ok", false, "error", "нет доступа").toString());
                return;
            }
            int length = Integer.parseInt(headers.getOrDefault("content-length", "0"));
            if (length > MAX_BODY) {
                respond(client, 413, Js.obj("ok", false, "error", "слишком большой запрос").toString());
                return;
            }
            byte[] raw = in.readNBytes(length);
            String target = parts[1];
            int mark = target.indexOf('?');
            String path = mark < 0 ? target : target.substring(0, mark);
            Map<String, String> query = mark < 0 ? Map.of() : parse(target.substring(mark + 1));
            JsonObject body = raw.length == 0
                    ? new JsonObject()
                    : JsonParser.parseString(new String(raw, StandardCharsets.UTF_8)).getAsJsonObject();
            Route route = routes.get(parts[0] + " " + path);
            if (route == null) {
                respond(client, 404, Js.obj("ok", false, "error", "нет пути " + path).toString());
                return;
            }
            String answer;
            try {
                answer = Js.obj("ok", true, "result", Js.of(route.handle(new Request(query, body)))).toString();
            } catch (Refusal e) {
                answer = Js.obj("ok", false, "error", e.getMessage()).toString();
            } catch (Throwable t) {
                answer = Js.obj("ok", false, "error", Agent.trace(t)).toString();
            }
            respond(client, 200, answer);
        } catch (Throwable ignored) {
        }
    }

    private static Map<String, String> parse(String query) {
        Map<String, String> out = new HashMap<>();
        for (String pair : query.split("&")) {
            int at = pair.indexOf('=');
            if (at > 0) out.put(pair.substring(0, at), URLDecoder.decode(pair.substring(at + 1), StandardCharsets.UTF_8));
        }
        return out;
    }

    private static String line(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (int b = in.read(); b != -1; b = in.read()) {
            if (b == '\n') return out.toString(StandardCharsets.UTF_8).replaceAll("\r$", "");
            if (out.size() >= MAX_LINE) return null;
            out.write(b);
        }
        return out.size() == 0 ? null : out.toString(StandardCharsets.UTF_8);
    }

    private static void respond(Socket client, int status, String body) throws IOException {
        byte[] data = body.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + status + " X\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: "
                + data.length + "\r\nConnection: close\r\n\r\n";
        OutputStream out = client.getOutputStream();
        out.write(head.getBytes(StandardCharsets.ISO_8859_1));
        out.write(data);
        out.flush();
    }
}
