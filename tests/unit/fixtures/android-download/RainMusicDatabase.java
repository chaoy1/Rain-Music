package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.util.concurrent.atomic.AtomicInteger;

/** Only connection hosting is replaced; required-table probes use real SQLite. */
final class RainMusicDatabase {
    static SQLiteDatabase db;
    static final AtomicInteger unlockedOpens = new AtomicInteger();
    static SQLiteDatabase open(Context context, String... tables) {
        // Observe the production synchronization boundary without relying on a thread race.
        if (!Thread.holdsLock(RainMusicListWriteLock.LOCK)) unlockedOpens.incrementAndGet();
        if (db == null) throw new IllegalStateException("Cannot open database");
        for (String table : tables) {
            Cursor cursor = db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' AND name=?", new String[] { table });
            try { if (!cursor.moveToFirst()) throw new IllegalStateException("Missing table: " + table); }
            finally { cursor.close(); }
        }
        return db;
    }
}
