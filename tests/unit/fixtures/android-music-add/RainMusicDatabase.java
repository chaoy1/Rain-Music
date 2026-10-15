package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

// Only opening the Android connection is replaced; all schema and SQL execute in SQLite.
final class RainMusicDatabase {
    static SQLiteDatabase db;
    static final String DATABASE_NAME = "rain.dataSQLite.db";
    static final String SCHEMA_VERSION_TEXT = "4";
    static final String TABLE_DB_INFO = "db_info";
    static final String TABLE_MY_LIST_MUSIC_INFO = "my_list_music_info";
    static final String TABLE_MY_LIST_MUSIC_INFO_ORDER = "my_list_music_info_order";
    static SQLiteDatabase open(Context context, String... tables) {
        if (db == null) throw new IllegalStateException("Cannot open database");
        for (String table : tables) {
            Cursor cursor = db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' AND name=?", new String[] { table });
            try { if (!cursor.moveToFirst()) throw new IllegalStateException("Missing table: " + table); }
            finally { cursor.close(); }
        }
        return db;
    }
}
