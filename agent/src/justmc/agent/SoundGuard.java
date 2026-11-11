package justmc.agent;

import java.lang.reflect.Field;
import java.util.NoSuchElementException;
import net.minecraft.client.Minecraft;
import net.minecraft.client.sounds.SoundEngine;
import net.minecraft.client.sounds.SoundEngineExecutor;
import net.minecraft.client.sounds.SoundManager;

final class SoundGuard {
    private static Thread guarded;

    private SoundGuard() {}

    private static Object read(Object owner, Class<?> type, String name) throws ReflectiveOperationException {
        Field f = type.getDeclaredField(name);
        f.setAccessible(true);
        return f.get(owner);
    }

    static void watch(Minecraft mc) {
        try {
            install(mc);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void install(Minecraft mc) throws ReflectiveOperationException {
        SoundManager manager = mc.getSoundManager();
        if (manager == null) return;
        SoundEngine engine = (SoundEngine) read(manager, SoundManager.class, "soundEngine");
        SoundEngineExecutor executor = (SoundEngineExecutor) read(engine, SoundEngine.class, "executor");
        Thread thread = (Thread) read(executor, SoundEngineExecutor.class, "thread");
        if (thread == null || thread == guarded) return;
        Thread.UncaughtExceptionHandler original = thread.getUncaughtExceptionHandler();
        thread.setUncaughtExceptionHandler((t, e) -> {
            if (e instanceof NoSuchElementException) return;
            original.uncaughtException(t, e);
        });
        guarded = thread;
    }
}
