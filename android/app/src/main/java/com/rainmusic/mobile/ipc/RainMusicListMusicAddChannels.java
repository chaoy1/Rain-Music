package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * player_list_music_add: args=[{id,musicInfos,addMusicLocationType}] -> void.
 * Matches modules/list/index.ts musicsAdd and dbHelper.ts's two insert paths.
 * The default queue uses the existing JS-equivalent key; other lists use IDs.
 * The broadcast carries the ORIGINAL input songs (the renderer filters too),
 * as ListEvent.ts / winRendererEvent.ts do. No success event on failed writes.
 * No new Android/Gradle dependencies. Device execution remains to be verified.
 */
public final class RainMusicListMusicAddChannels {
    private RainMusicListMusicAddChannels() {}
    public static final String CHANNEL_MUSIC_ADD = "player_list_music_add";
    // Only named parameters change to positional parameters; columns stay identical.
    static final String SQL_INSERT_INFO = """
        INSERT INTO "main"."my_list_music_info" ("id", "listId", "name", "singer", "source", "interval", "meta")
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """;
    static final String SQL_INSERT_ORDER = """
        INSERT INTO "main"."my_list_music_info_order" ("listId", "musicInfoId", "order")
        VALUES (?, ?, ?)
        """;
    static final String SQL_DELETE_ORDER = """
        DELETE FROM "main"."my_list_music_info_order" WHERE "listId"=?
        """;
    static final String SQL_GET_ORDER = """
        SELECT "listId", "musicInfoId", "order"
        FROM "main"."my_list_music_info_order"
        WHERE "listId"=? AND "musicInfoId"=?
        """;

    public static void register(RainMusicIpcPlugin plugin) {
        if (plugin == null) throw new IllegalArgumentException("Plugin is required");
        RainMusicIpcHandlers.register(CHANNEL_MUSIC_ADD, (args, ctx) -> add(plugin, args, ctx));
    }

    private static Object add(RainMusicIpcPlugin plugin, List<Object> args, RainMusicIpcHandlers.RequestContext ctx) throws Exception {
        // Capacitor JSArray.toList() retains nested JSONObject/JSONArray values.
        if (args == null || args.isEmpty() || !(args.get(0) instanceof JSONObject)) {
            throw new IllegalArgumentException(CHANNEL_MUSIC_ADD + " requires {id,musicInfos,addMusicLocationType}");
        }
        JSONObject params = (JSONObject) args.get(0);
        String listId = requireString(params, "id", true);
        Object rawSongs = params.opt("musicInfos");
        if (!(rawSongs instanceof JSONArray)) throw new IllegalArgumentException("musicInfos must be an array");
        JSONArray incoming = (JSONArray) rawSongs;
        List<Song> songs = new ArrayList<>();
        for (int i = 0; i < incoming.length(); i++) {
            Object raw = incoming.get(i);
            if (!(raw instanceof JSONObject)) throw new IllegalArgumentException("musicInfos[" + i + "] must be an object");
            songs.add(new Song((JSONObject) raw));
        }
        boolean top = "top".equals(params.opt("addMusicLocationType"));
        JSONObject broadcast = new JSONObject();
        broadcast.put("id", listId);
        broadcast.put("musicInfos", incoming);
        if (params.has("addMusicLocationType")) broadcast.put("addMusicLocationType", params.opt("addMusicLocationType"));
        Runnable publish = () -> ctx.emitTo(CHANNEL_MUSIC_ADD, broadcast);
        Context context = plugin.getContext();
        if (context == null) throw new IllegalStateException("Android context is unavailable");
        RainMusicListWriteLock.Broadcast queued;

        synchronized (RainMusicListWriteLock.LOCK) {
            SQLiteDatabase db = RainMusicDatabase.open(context,
                RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO, "my_list_music_info_order");
            RainMusicIpcHandlers.Handler reader = RainMusicIpcHandlers.get(RainMusicListMusicGetChannels.CHANNEL_MUSIC_GET);
            if (reader == null) throw new IllegalStateException("Song read channel is not registered");
            // Reads/repairs default before insertion, exactly as desktop getListMusics().
            // Its lock is the same reentrant monitor, so additions cannot be lost to repair.
            JSONArray existing = (JSONArray) reader.handle(Collections.singletonList(listId), ctx);
            Set<String> ids = new HashSet<>();
            Set<String> keys = new HashSet<>();
            for (int i = 0; i < existing.length(); i++) {
                JSONObject item = existing.getJSONObject(i);
                String id = requireString(item, "id", true);
                ids.add(id);
                keys.add(RainMusicPlaybackQueueKey.musicKey(id, stringOrNull(item.opt("name")), stringOrNull(item.opt("singer"))));
            }
            boolean defaultQueue = "default".equals(listId);
            List<Song> accepted = new ArrayList<>();
            for (Song song : songs) {
                String key = RainMusicPlaybackQueueKey.musicKey(song.id, song.name, song.singer);
                if (ids.contains(song.id) || (defaultQueue && keys.contains(key))) continue;
                ids.add(song.id); keys.add(key); accepted.add(song);
            }
            long offset = top ? 0 : appendOrder(db, listId, existing);
            db.beginTransaction();
            try {
                if (top) db.execSQL(SQL_DELETE_ORDER, new Object[] { listId });
                long order = offset;
                for (Song song : accepted) {
                    db.execSQL(SQL_INSERT_INFO, new Object[] { song.id, listId, song.name, song.singer, song.source, song.interval, song.meta });
                    db.execSQL(SQL_INSERT_ORDER, new Object[] { listId, song.id, order });
                    order = Math.addExact(order, 1);
                }
                if (top) {
                    for (int i = 0; i < existing.length(); i++) {
                        db.execSQL(SQL_INSERT_ORDER, new Object[] { listId, existing.getJSONObject(i).getString("id"), order });
                        order = Math.addExact(order, 1);
                    }
                }
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
            queued = RainMusicListWriteLock.enqueueBroadcast(publish);
        }
        // Both the commit and monitor exit happen before any observable broadcast.
        RainMusicListWriteLock.drainBroadcasts(queued);
        return null;
    }

    private static long appendOrder(SQLiteDatabase db, String listId, JSONArray existing) throws JSONException {
        if (existing.length() == 0) return 0;
        String lastId = existing.getJSONObject(existing.length() - 1).getString("id");
        Cursor cursor = db.rawQuery(SQL_GET_ORDER, new String[] { listId, lastId });
        try {
            long previous = existing.length();
            int index = cursor.getColumnIndexOrThrow("order");
            if (cursor.moveToFirst() && !cursor.isNull(index)) previous = cursor.getLong(index);
            return Math.addExact(previous, 1);
        } finally { cursor.close(); }
    }

    private static String requireString(JSONObject object, String field, boolean nonempty) {
        Object value = object.opt(field);
        if (!(value instanceof String) || (nonempty && ((String) value).isEmpty())) {
            throw new IllegalArgumentException("Invalid string field: " + field);
        }
        return (String) value;
    }
    private static String stringOrNull(Object value) { return value instanceof String ? (String) value : null; }

    private static final class Song {
        final String id, name, singer, source, interval, meta;
        Song(JSONObject item) {
            id = requireString(item, "id", true);
            name = requireString(item, "name", false);
            singer = requireString(item, "singer", false);
            source = requireString(item, "source", false);
            Object duration = item.opt("interval");
            if (!item.has("interval") || (duration != JSONObject.NULL && !(duration instanceof String))) {
                throw new IllegalArgumentException("interval must be a string or null");
            }
            interval = duration == JSONObject.NULL ? null : (String) duration;
            Object metadata = item.opt("meta");
            if (!(metadata instanceof JSONObject)) throw new IllegalArgumentException("meta must be an object");
            meta = metadata.toString();
            if (meta == null) throw new IllegalArgumentException("meta cannot be serialized");
        }
    }
}
