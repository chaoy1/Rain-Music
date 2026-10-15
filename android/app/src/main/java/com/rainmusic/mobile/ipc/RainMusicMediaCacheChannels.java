package com.rainmusic.mobile.ipc;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.util.Base64;
import org.json.JSONObject;
import org.json.JSONException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Iterator;

/**
 * Desktop music.ts cache contracts on the existing music_url / lyric tables.
 * Lyric text is UTF-8 base64, including the legacy edited rows. Raw save appends
 * rows as desktop insertRawLyric does; counts are row counts, not song counts.
 * No events are broadcast by these desktop channels. Failures reach the caller.
 */
public final class RainMusicMediaCacheChannels {
    private RainMusicMediaCacheChannels() {}
    private static final String[] LYRIC_TYPES = { "lyric", "tlyric", "rlyric", "rainlyric" };

    public static void register(RainMusicIpcPlugin plugin) {
        if (plugin == null) throw new IllegalArgumentException("Plugin is required");
        bind(plugin, "get_music_url", "music_url", (db, args) -> readUrl(db, stringArg(args)));
        bind(plugin, "save_music_url", "music_url", RainMusicMediaCacheChannels::saveUrl);
        bind(plugin, "remove_music_url", "music_url", (db, args) -> {
            String id = stringArg(args);
            write(db, () -> db.execSQL("DELETE FROM music_url WHERE id=?", new Object[] { id }));
            return null;
        });
        bind(plugin, "clear_music_url", "music_url", (db, args) -> {
            write(db, () -> db.execSQL("DELETE FROM music_url", new Object[0]));
            return null;
        });
        bind(plugin, "get_music_url_count", "music_url", (db, args) -> count(db, "SELECT COUNT(*) FROM music_url", new String[0]));
        for (String source : new String[] { "raw", "edited" }) {
            bind(plugin, "get_lyric_" + source, "lyric", (db, args) -> readLyric(db, stringArg(args), source));
            bind(plugin, "clear_lyric_" + source, "lyric", (db, args) -> {
                write(db, () -> db.execSQL("DELETE FROM lyric WHERE source=?", new Object[] { source }));
                return null;
            });
            bind(plugin, "get_lyric_" + source + "_count", "lyric", (db, args) -> count(db, "SELECT COUNT(*) FROM lyric WHERE source=?", new String[] { source }));
        }
        bind(plugin, "save_lyric_raw", "lyric", RainMusicMediaCacheChannels::saveRawLyric);
        // Original channel spelling is part of the renderer ABI.
        bind(plugin, "get_palyer_lyric", "lyric", (db, args) -> {
            String id = stringArg(args);
            JSONObject raw = readLyric(db, id, "raw"), edited = readLyric(db, id, "edited");
            JSONObject selected = "".equals(edited.opt("lyric")) ? copy(raw) : edited;
            selected.put("rawlrcInfo", raw);
            return selected;
        });
    }

    private interface Operation { Object apply(SQLiteDatabase db, List<Object> args) throws Exception; }
    private static void bind(RainMusicIpcPlugin plugin, String channel, String table, Operation operation) {
        RainMusicIpcHandlers.register("winMain_" + channel, (args, ctx) -> {
            synchronized (RainMusicListWriteLock.LOCK) {
                return operation.apply(RainMusicDatabase.open(plugin.getContext(), table), args);
            }
        });
    }
    private static JSONObject objectArg(List<Object> args) {
        if (args == null || args.isEmpty() || !(args.get(0) instanceof JSONObject)) throw new IllegalArgumentException("Expected object argument");
        return (JSONObject) args.get(0);
    }
    private static String stringArg(List<Object> args) {
        if (args == null || args.isEmpty() || !(args.get(0) instanceof String)) throw new IllegalArgumentException("Expected string ID");
        return (String) args.get(0);
    }
    private static String field(JSONObject params, String key) {
        Object value = params.opt(key);
        if (!(value instanceof String)) throw new IllegalArgumentException(key + " must be a string");
        return (String) value;
    }
    private static void write(SQLiteDatabase db, Runnable mutation) {
        db.beginTransaction();
        try { mutation.run(); db.setTransactionSuccessful(); }
        finally { db.endTransaction(); }
    }
    private static String readUrl(SQLiteDatabase db, String id) {
        Cursor cursor = db.rawQuery("SELECT url FROM music_url WHERE id=?", new String[] { id });
        try { return cursor.moveToFirst() ? cursor.getString(0) : ""; }
        finally { cursor.close(); }
    }
    private static Object saveUrl(SQLiteDatabase db, List<Object> args) {
        JSONObject params = objectArg(args);
        String id = field(params, "id"), url = field(params, "url");
        write(db, () -> {
            db.execSQL("DELETE FROM music_url WHERE id=?", new Object[] { id });
            db.execSQL("INSERT INTO music_url (id,url) VALUES (?,?)", new Object[] { id, url });
        });
        return null;
    }
    private static int count(SQLiteDatabase db, String sql, String[] args) {
        Cursor cursor = db.rawQuery(sql, args);
        try {
            if (!cursor.moveToFirst()) throw new IllegalStateException("Cache count returned no row");
            return cursor.getInt(0);
        } finally { cursor.close(); }
    }
    private static JSONObject readLyric(SQLiteDatabase db, String id, String source) throws JSONException {
        JSONObject lyric = new JSONObject(); lyric.put("lyric", "");
        Cursor cursor = db.rawQuery("SELECT type,text FROM lyric WHERE id=? AND source=?", new String[] { id, source });
        try {
            while (cursor.moveToNext()) lyric.put(cursor.getString(0), new String(Base64.decode(cursor.getString(1), Base64.DEFAULT), StandardCharsets.UTF_8));
        } finally { cursor.close(); }
        return lyric;
    }
    private static Object saveRawLyric(SQLiteDatabase db, List<Object> args) {
        JSONObject params = objectArg(args);
        String id = field(params, "id");
        Object raw = params.opt("lyrics");
        if (!(raw instanceof JSONObject)) throw new IllegalArgumentException("lyrics must be an object");
        JSONObject lyrics = (JSONObject) raw;
        List<Object[]> rows = new ArrayList<>();
        // Validate and encode the complete payload before opening a transaction.
        for (String type : LYRIC_TYPES) {
            Object value = lyrics.opt(type);
            if (value == null || value == JSONObject.NULL) continue;
            if (!(value instanceof String)) throw new IllegalArgumentException("lyrics." + type + " must be a string");
            rows.add(new Object[] { id, type, Base64.encodeToString(((String) value).getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP), "raw" });
        }
        write(db, () -> {
            for (Object[] row : rows) db.execSQL("INSERT INTO lyric (id,type,text,source) VALUES (?,?,?,?)", row);
        });
        return null;
    }
    private static JSONObject copy(JSONObject value) throws JSONException {
        JSONObject result = new JSONObject();
        Iterator<String> keys = value.keys();
        while (keys.hasNext()) { String key = keys.next(); result.put(key, value.opt(key)); }
        return result;
    }
}
