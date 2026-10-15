package com.rainmusic.mobile.ipc;

import java.util.ArrayDeque;

/** Serializes list read-modify-write operations, including default queue repair. */
final class RainMusicListWriteLock {
    private RainMusicListWriteLock() {}
    static final Object LOCK = new Object();
    private static final Object PUBLISH_LOCK = new Object();
    private static final ArrayDeque<Broadcast> BROADCASTS = new ArrayDeque<>();

    static final class Broadcast {
        private final Runnable publish;
        private volatile Throwable failure;
        private volatile boolean completed;
        private Broadcast(Runnable publish) { this.publish = publish; }
        private void checkResult() {
            if (!completed) throw new IllegalStateException("Broadcast was not published");
            if (failure instanceof RuntimeException) throw (RuntimeException) failure;
            if (failure instanceof Error) throw (Error) failure;
        }
    }

    /** Call after commit while holding LOCK; the callback is not executed here. */
    static Broadcast enqueueBroadcast(Runnable publish) {
        if (!Thread.holdsLock(LOCK)) throw new IllegalStateException("Broadcast must be queued in commit order");
        Broadcast broadcast = new Broadcast(publish);
        BROADCASTS.addLast(broadcast);
        return broadcast;
    }

    /** A later writer may drain first, but it still publishes the earlier commit first. */
    static void drainBroadcasts(Broadcast requested) {
        if (Thread.holdsLock(LOCK)) throw new IllegalStateException("Publish must happen outside the database lock");
        synchronized (PUBLISH_LOCK) {
            while (true) {
                Broadcast broadcast;
                synchronized (LOCK) { broadcast = BROADCASTS.pollFirst(); }
                if (broadcast == null) break;
                try { broadcast.publish.run(); }
                catch (RuntimeException | Error error) { broadcast.failure = error; }
                finally { broadcast.completed = true; }
            }
        }
        // A drainer may publish another writer's event; only its own error is returned.
        requested.checkResult();
    }

    static void runAndBroadcast(Runnable mutation, Runnable broadcast) {
        Broadcast queued;
        synchronized (LOCK) {
            mutation.run();
            queued = enqueueBroadcast(broadcast);
        }
        drainBroadcasts(queued);
    }
}
