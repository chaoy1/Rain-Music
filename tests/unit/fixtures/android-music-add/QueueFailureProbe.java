package com.rainmusic.mobile.ipc;

public final class QueueFailureProbe {
    public static void main(String[] args) {
        StringBuilder events = new StringBuilder();
        RainMusicListWriteLock.Broadcast a, b;
        synchronized (RainMusicListWriteLock.LOCK) {
            a = RainMusicListWriteLock.enqueueBroadcast(() -> { throw new IllegalStateException("A publish failed"); });
            b = RainMusicListWriteLock.enqueueBroadcast(() -> events.append("B"));
        }
        try { RainMusicListWriteLock.drainBroadcasts(b); System.out.println("B=success"); }
        catch (RuntimeException error) { System.out.println("B=" + error.getMessage()); }
        try { RainMusicListWriteLock.drainBroadcasts(a); System.out.println("A=success"); }
        catch (RuntimeException error) { System.out.println("A=" + error.getMessage()); }
        System.out.println("EVENTS=" + events);
    }
}
