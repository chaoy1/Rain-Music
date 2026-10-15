package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

/** Download record persistence only; these desktop channels never emit events or delete files. */
public final class RainMusicDownloadChannels {
    private RainMusicDownloadChannels() {}

    public static final String CHANNEL_GET = "winMain_download_list_get";
    public static final String CHANNEL_ADD = "winMain_download_list_add";
    public static final String CHANNEL_UPDATE = "winMain_download_list_update";
    public static final String CHANNEL_REMOVE = "winMain_download_list_remove";
    public static final String CHANNEL_CLEAR = "winMain_download_list_clear";

    static final String SQL_GET = """
        SELECT "id", "isComplate", "status", "statusText", "progress_downloaded", "progress_total",
               "url", "quality", "ext", "fileName", "filePath", "musicInfo", "position"
        FROM download_list ORDER BY "position" ASC
        """;
    static final String SQL_INSERT = """
        INSERT INTO "main"."download_list" ("id", "isComplate", "status", "statusText", "progress_downloaded", "progress_total", "url", "quality", "ext", "fileName", "filePath", "musicInfo", "position")
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """;
    // Desktop statements.ts deliberately excludes quality/ext/fileName/musicInfo/position.
    static final String SQL_UPDATE = """
        UPDATE "main"."download_list"
        SET "isComplate"=?, "status"=?, "statusText"=?, "progress_downloaded"=?, "progress_total"=?, "url"=?, "filePath"=?
        WHERE "id"=?
        """;
    static final String SQL_POSITION = "UPDATE \"main\".\"download_list\" SET \"position\"=? WHERE \"id\"=?";
    static final String SQL_REMOVE = "DELETE FROM \"main\".\"download_list\" WHERE \"id\"=?";
    static final String SQL_CLEAR = "DELETE FROM \"main\".\"download_list\"";

    public static void register(RainMusicIpcPlugin plugin) {
        if (plugin == null) throw new IllegalArgumentException("Plugin is required");
        RainMusicIpcHandlers.register(CHANNEL_GET, (args, ctx) -> {
            synchronized (RainMusicListWriteLock.LOCK) { return read(open(plugin)); }
        });
        RainMusicIpcHandlers.register(CHANNEL_ADD, (args, ctx) -> add(plugin, args));
        RainMusicIpcHandlers.register(CHANNEL_UPDATE, (args, ctx) -> update(plugin, args));
        RainMusicIpcHandlers.register(CHANNEL_REMOVE, (args, ctx) -> remove(plugin, args));
        RainMusicIpcHandlers.register(CHANNEL_CLEAR, (args, ctx) -> {
            synchronized (RainMusicListWriteLock.LOCK) {
                SQLiteDatabase db = open(plugin);
                transaction(db, () -> db.execSQL(SQL_CLEAR, new Object[0]));
            }
            return null;
        });
    }

    private static SQLiteDatabase open(RainMusicIpcPlugin plugin) {
        Context context = plugin.getContext();
        if (context == null) throw new IllegalStateException("Android context is unavailable");
        return RainMusicDatabase.open(context, "download_list");
    }

    private static JSONArray read(SQLiteDatabase db) throws JSONException {
        JSONArray result = new JSONArray();
        Cursor cursor = db.rawQuery(SQL_GET, new String[0]);
        try {
            while (cursor.moveToNext()) {
                JSONObject item = new JSONObject();
                item.put("id", cursor.getString(0));
                item.put("isComplate", cursor.getDouble(1) == 1);
                item.put("status", cursor.getString(2));
                item.put("statusText", cursor.getString(3));
                double downloaded = cursor.getDouble(4), total = cursor.getDouble(5);
                item.put("downloaded", downloaded);
                item.put("total", total);
                item.put("progress", total == 0 ? 0 : Math.round(downloaded / total * 100));
                item.put("speed", "");
                item.put("writeQueue", 0);
                JSONObject metadata = new JSONObject();
                // JSON errors propagate; corrupted rows must never become an empty list.
                metadata.put("musicInfo", new JSONObject(cursor.getString(11)));
                metadata.put("url", cursor.isNull(6) ? JSONObject.NULL : cursor.getString(6));
                metadata.put("quality", cursor.getString(7));
                metadata.put("ext", cursor.getString(8));
                metadata.put("fileName", cursor.getString(9));
                metadata.put("filePath", cursor.getString(10));
                item.put("metadata", metadata);
                result.put(item);
            }
        } finally { cursor.close(); }
        return result;
    }

    private static Object add(RainMusicIpcPlugin plugin, List<Object> args) throws Exception {
        Object raw = first(args);
        if (!(raw instanceof JSONObject)) throw new IllegalArgumentException("Download add requires {list,addMusicLocationType}");
        JSONObject params = (JSONObject) raw;
        List<Task> incoming = tasks(params.opt("list"));
        boolean top = "top".equals(params.opt("addMusicLocationType"));
        synchronized (RainMusicListWriteLock.LOCK) {
            SQLiteDatabase db = open(plugin);
            // Desktop initializes the existing list before add (including parsing every musicInfo).
            JSONArray existing = read(db);
            long offset = top ? 0 : existing.length();
            transaction(db, () -> {
                long position = offset;
                for (Task task : incoming) {
                    db.execSQL(SQL_INSERT, new Object[] { task.id, task.complete, task.status, task.statusText,
                        task.downloaded, task.total, task.url, task.quality, task.ext, task.fileName, task.filePath, task.musicInfo, position++ });
                }
                if (top) {
                    for (int i = 0; i < existing.length(); i++) {
                        db.execSQL(SQL_POSITION, new Object[] { (long) incoming.size() + i, existing.getJSONObject(i).getString("id") });
                    }
                }
            });
        }
        return null;
    }

    private static Object update(RainMusicIpcPlugin plugin, List<Object> args) throws Exception {
        List<Task> incoming = tasks(first(args));
        synchronized (RainMusicListWriteLock.LOCK) {
            SQLiteDatabase db = open(plugin);
            transaction(db, () -> {
                for (Task task : incoming) {
                    db.execSQL(SQL_UPDATE, new Object[] { task.complete, task.status, task.statusText,
                        task.downloaded, task.total, task.url, task.filePath, task.id });
                }
            });
        }
        return null;
    }

    private static Object remove(RainMusicIpcPlugin plugin, List<Object> args) throws Exception {
        Object raw = first(args);
        if (!(raw instanceof JSONArray)) throw new IllegalArgumentException("Download remove requires an array of IDs");
        JSONArray array = (JSONArray) raw;
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            Object id = array.get(i);
            if (!(id instanceof String)) throw new IllegalArgumentException("Download ID must be a string");
            ids.add((String) id);
        }
        synchronized (RainMusicListWriteLock.LOCK) {
            SQLiteDatabase db = open(plugin);
            transaction(db, () -> {
                for (String id : ids) db.execSQL(SQL_REMOVE, new Object[] { id });
            });
        }
        return null;
    }

    private interface Write { void run() throws Exception; }
    private static void transaction(SQLiteDatabase db, Write write) throws Exception {
        db.beginTransaction();
        try {
            write.run();
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    private static Object first(List<Object> args) {
        if (args == null || args.isEmpty()) throw new IllegalArgumentException("Missing download parameters");
        return args.get(0);
    }
    private static List<Task> tasks(Object raw) throws JSONException {
        // JSArray.toList retains nested JSONObject / JSONArray; it does not yield Map / List.
        if (!(raw instanceof JSONArray)) throw new IllegalArgumentException("Download list must be an array");
        JSONArray array = (JSONArray) raw;
        List<Task> result = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            Object item = array.get(i);
            if (!(item instanceof JSONObject)) throw new IllegalArgumentException("Download task must be an object");
            result.add(new Task((JSONObject) item));
        }
        return result;
    }
    private static String string(JSONObject object, String field) {
        Object value = object.opt(field);
        if (!(value instanceof String)) throw new IllegalArgumentException("Invalid download string: " + field);
        return (String) value;
    }
    private static Number number(JSONObject object, String field) {
        Object value = object.opt(field);
        if (!(value instanceof Number) || !Double.isFinite(((Number) value).doubleValue())) {
            throw new IllegalArgumentException("Invalid download number: " + field);
        }
        return (Number) value;
    }
    private static final class Task {
        final String id, status, statusText, url, quality, ext, fileName, filePath, musicInfo;
        final Number downloaded, total;
        final int complete;
        Task(JSONObject object) {
            id = string(object, "id");
            Object completeValue = object.opt("isComplate");
            if (!(completeValue instanceof Boolean)) throw new IllegalArgumentException("isComplate must be a boolean");
            complete = Boolean.TRUE.equals(completeValue) ? 1 : 0;
            status = string(object, "status"); statusText = string(object, "statusText");
            downloaded = number(object, "downloaded"); total = number(object, "total");
            Object rawMetadata = object.opt("metadata");
            if (!(rawMetadata instanceof JSONObject)) throw new IllegalArgumentException("Download metadata must be an object");
            JSONObject metadata = (JSONObject) rawMetadata;
            Object rawUrl = metadata.opt("url");
            if (!metadata.has("url") || (rawUrl != JSONObject.NULL && !(rawUrl instanceof String))) {
                throw new IllegalArgumentException("Download URL must be a string or null");
            }
            url = rawUrl == JSONObject.NULL ? null : (String) rawUrl;
            quality = string(metadata, "quality"); ext = string(metadata, "ext");
            fileName = string(metadata, "fileName"); filePath = string(metadata, "filePath");
            Object info = metadata.opt("musicInfo");
            if (!(info instanceof JSONObject)) throw new IllegalArgumentException("musicInfo must be an object");
            musicInfo = info.toString();
            if (musicInfo == null) throw new IllegalArgumentException("musicInfo cannot be serialized");
        }
    }
}
