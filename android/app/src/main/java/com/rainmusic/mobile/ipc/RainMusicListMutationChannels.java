package com.rainmusic.mobile.ipc;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.*;

/** Remaining list writes. Each mutation commits atomically, then publishes through
 * the same FIFO as add/update/remove. Invalid input never becomes a success event. */
public final class RainMusicListMutationChannels {
    private RainMusicListMutationChannels() {}
    private static final String INFO = "my_list_music_info";
    private static final String ORDER = "my_list_music_info_order";
    private static final String[] OPERATIONS = { "music_remove", "music_clear", "music_overwrite", "music_update", "music_move", "music_update_position", "update_position", "data_overwire" };

    public static void register(RainMusicIpcPlugin plugin) {
        if (plugin == null) throw new IllegalArgumentException("Plugin is required");
        for (String operation : OPERATIONS) {
            String channel = "player_list_" + operation;
            RainMusicIpcHandlers.register(channel, (args, ctx) -> {
                if (args == null || args.size() != 1) throw new IllegalArgumentException(channel + " requires one payload");
                Object payload = args.get(0);
                RainMusicListWriteLock.Broadcast ticket;
                synchronized (RainMusicListWriteLock.LOCK) {
                    SQLiteDatabase db = RainMusicDatabase.open(plugin.getContext(), "my_list", INFO, ORDER);
                    // Reads and default repair precede the write transaction, as on desktop.
                    Runnable write = prepare(operation, payload, db, ctx);
                    db.beginTransaction();
                    try { write.run(); db.setTransactionSuccessful(); }
                    finally { db.endTransaction(); }
                    ticket = RainMusicListWriteLock.enqueueBroadcast(() -> ctx.emitTo(channel, payload));
                }
                RainMusicListWriteLock.drainBroadcasts(ticket);
                return null;
            });
        }
    }

    private static Runnable prepare(String operation, Object payload, SQLiteDatabase db, RainMusicIpcHandlers.RequestContext ctx) throws Exception {
        switch (operation) {
            case "music_clear": {
                List<String> ids = strings(array(payload));
                return () -> { for (String id : ids) clear(db, id); };
            }
            case "music_update": {
                JSONArray rows = array(payload); List<Song> songs = new ArrayList<>(); List<String> lists = new ArrayList<>();
                for (int i = 0; i < rows.length(); i++) { JSONObject row = object(rows.get(i)); lists.add(string(row, "id", true)); songs.add(new Song(object(row.opt("musicInfo")))); }
                return () -> { for (int i = 0; i < songs.size(); i++) { Song s = songs.get(i); db.execSQL("UPDATE my_list_music_info SET name=?,singer=?,source=?,interval=?,meta=? WHERE listId=? AND id=?", new Object[] { s.name, s.singer, s.source, s.interval, s.meta, lists.get(i), s.id }); } };
            }
            case "update_position": return listPosition(db, object(payload));
            case "data_overwire": return overwriteAll(db, object(payload), ctx);
            default: break;
        }
        JSONObject params = object(payload);
        if ("music_move".equals(operation)) {
            String from = string(params, "fromId", true), to = string(params, "toId", true);
            if (from.equals(to)) throw new IllegalArgumentException("Cannot move songs into the same list");
            List<Song> incoming = songs(array(params.opt("musicInfos")));
            read(from, ctx); JSONArray existing = read(to, ctx);
            List<Song> accepted = dedupe(to, incoming, songs(existing));
            boolean top = "top".equals(params.opt("addMusicLocationType"));
            long offset = top ? 0 : appendOrder(db, to, existing);
            List<Song> previous = songs(existing);
            return () -> {
                for (Song s : incoming) remove(db, from, s.id);
                if (top) deleteOrder(db, to);
                long n = offset;
                for (Song s : accepted) { insert(db, to, s, n); n = Math.addExact(n, 1); }
                if (top) for (Song s : previous) { insertOrder(db, to, s.id, n); n = Math.addExact(n, 1); }
            };
        }
        String id = string(params, "listId", true);
        // Parse shape before read(): a default-list read can independently repair
        // duplicates and save the startup identity snapshot, matching desktop.
        List<String> selectedIds = ("music_remove".equals(operation) || "music_update_position".equals(operation)) ? strings(array(params.opt("ids"))) : null;
        List<Song> incomingSongs = "music_overwrite".equals(operation) ? songs(array(params.opt("musicInfos"))) : null;
        int requestedPosition = "music_update_position".equals(operation) ? position(params) : 0;
        JSONArray existing = read(id, ctx);
        switch (operation) {
            case "music_remove": {
                List<String> ids = selectedIds;
                return () -> { if (existing.length() > 0) for (String songId : ids) remove(db, id, songId); };
            }
            case "music_overwrite": {
                List<Song> incoming = incomingSongs;
                List<Song> rows = "default".equals(id) ? dedupe(id, incoming, Collections.emptyList()) : incoming;
                return () -> { clear(db, id); long n = 0; for (Song s : rows) insert(db, id, s, n++); };
            }
            case "music_update_position": {
                List<String> ids = selectedIds; int position = requestedPosition;
                LinkedHashMap<String, Song> remaining = new LinkedHashMap<>(); for (Song s : songs(existing)) remaining.put(s.id, s);
                List<Song> moved = new ArrayList<>();
                for (String songId : ids) { Song s = remaining.remove(songId); if (s == null) throw new IllegalArgumentException("Unknown or duplicate song id: " + songId); moved.add(s); }
                List<Song> ordered = new ArrayList<>(remaining.values()); ordered.addAll(index(position, ordered.size()), moved);
                return () -> { if (existing.length() == 0) return; deleteOrder(db, id); long n = 0; for (Song s : ordered) insertOrder(db, id, s.id, n++); };
            }
            default: throw new IllegalArgumentException("Unknown list operation: " + operation);
        }
    }

    private static Runnable listPosition(SQLiteDatabase db, JSONObject params) throws JSONException {
        Set<String> selected = new HashSet<>(strings(array(params.opt("ids")))); int position = position(params);
        List<ListRow> rows = new ArrayList<>();
        Cursor cursor = db.rawQuery("SELECT id,name,source,sourceListId,locationUpdateTime FROM my_list ORDER BY position", new String[0]);
        try { while (cursor.moveToNext()) rows.add(new ListRow(cursor)); } finally { cursor.close(); }
        List<ListRow> moved = new ArrayList<>(); long now = System.currentTimeMillis();
        for (int i = rows.size() - 1; i >= 0; i--) if (selected.contains(rows.get(i).id)) { ListRow row = rows.remove(i); row.time = now; moved.add(row); }
        rows.addAll(index(position, rows.size()), moved);
        return () -> { for (int i = 0; i < rows.size(); i++) { ListRow row = rows.get(i); db.execSQL("UPDATE my_list SET position=?,locationUpdateTime=? WHERE id=?", new Object[] { i, row.time, row.id }); } };
    }

    private static Runnable overwriteAll(SQLiteDatabase db, JSONObject params, RainMusicIpcHandlers.RequestContext ctx) throws Exception {
        LinkedHashMap<String, List<Song>> groups = new LinkedHashMap<>();
        groups.put("default", dedupe("default", songs(array(params.opt("defaultList"))), Collections.emptyList()));
        groups.put("temp", songs(params.has("tempList") ? array(params.opt("tempList")) : read("temp", ctx)));
        JSONArray users = array(params.opt("userList")); List<ListRow> lists = new ArrayList<>();
        for (int i = 0; i < users.length(); i++) {
            JSONObject user = object(users.get(i)); ListRow row = new ListRow(user);
            if (groups.containsKey(row.id)) throw new IllegalArgumentException("Duplicate or reserved list id: " + row.id);
            lists.add(row); groups.put(row.id, songs(array(user.opt("list"))));
        }
        return () -> {
            db.execSQL("DELETE FROM my_list", new Object[0]);
            for (int i = 0; i < lists.size(); i++) { ListRow row = lists.get(i); db.execSQL("INSERT INTO my_list(id,name,source,sourceListId,position,locationUpdateTime) VALUES(?,?,?,?,?,?)", new Object[] { row.id,row.name,row.source,row.sourceId,i,row.time }); }
            db.execSQL("DELETE FROM my_list_music_info", new Object[0]); db.execSQL("DELETE FROM my_list_music_info_order", new Object[0]);
            for (Map.Entry<String,List<Song>> group : groups.entrySet()) { long n = 0; for (Song song : group.getValue()) insert(db, group.getKey(), song, n++); }
        };
    }

    private static JSONArray read(String id, RainMusicIpcHandlers.RequestContext ctx) throws Exception {
        RainMusicIpcHandlers.Handler reader = RainMusicIpcHandlers.get(RainMusicListMusicGetChannels.CHANNEL_MUSIC_GET);
        if (reader == null) throw new IllegalStateException("Song read channel is not registered");
        return (JSONArray) reader.handle(Collections.singletonList(id), ctx);
    }
    private static List<Song> dedupe(String id, List<Song> incoming, List<Song> existing) {
        Set<String> ids = new HashSet<>(), keys = new HashSet<>();
        for (Song s : existing) { ids.add(s.id); keys.add(s.key()); }
        List<Song> result = new ArrayList<>();
        for (Song s : incoming) { if (ids.contains(s.id) || ("default".equals(id) && keys.contains(s.key()))) continue; ids.add(s.id); keys.add(s.key()); result.add(s); }
        return result;
    }
    private static long appendOrder(SQLiteDatabase db, String id, JSONArray existing) throws JSONException {
        if (existing.length() == 0) return 0;
        Cursor c = db.rawQuery(RainMusicListMusicAddChannels.SQL_GET_ORDER, new String[] { id, existing.getJSONObject(existing.length() - 1).getString("id") });
        try { int col = c.getColumnIndexOrThrow("order"); return Math.addExact(c.moveToFirst() && !c.isNull(col) ? c.getLong(col) : existing.length(), 1); } finally { c.close(); }
    }
    private static void clear(SQLiteDatabase db, String id) { db.execSQL("DELETE FROM my_list_music_info WHERE listId=?", new Object[] {id}); deleteOrder(db,id); }
    private static void deleteOrder(SQLiteDatabase db, String id) { db.execSQL(RainMusicListMusicAddChannels.SQL_DELETE_ORDER,new Object[] {id}); }
    private static void remove(SQLiteDatabase db, String listId, String id) { db.execSQL("DELETE FROM my_list_music_info WHERE listId=? AND id=?",new Object[] {listId,id}); db.execSQL("DELETE FROM my_list_music_info_order WHERE listId=? AND musicInfoId=?",new Object[] {listId,id}); }
    private static void insert(SQLiteDatabase db, String listId, Song s, long n) { db.execSQL(RainMusicListMusicAddChannels.SQL_INSERT_INFO,new Object[] {s.id,listId,s.name,s.singer,s.source,s.interval,s.meta}); insertOrder(db,listId,s.id,n); }
    private static void insertOrder(SQLiteDatabase db, String listId, String id, long n) { db.execSQL(RainMusicListMusicAddChannels.SQL_INSERT_ORDER,new Object[] {listId,id,n}); }
    private static int index(int position, int length) { return position < 0 ? Math.max(length + position, 0) : Math.min(position,length); }
    private static int position(JSONObject params) { Object p=params.opt("position"); if (!(p instanceof Number) || !Double.isFinite(((Number)p).doubleValue()) || ((Number)p).doubleValue()!=((Number)p).intValue()) throw new IllegalArgumentException("position must be an integer"); return ((Number)p).intValue(); }
    private static JSONObject object(Object raw) { if (!(raw instanceof JSONObject)) throw new IllegalArgumentException("Expected object"); return (JSONObject)raw; }
    private static JSONArray array(Object raw) { if (!(raw instanceof JSONArray)) throw new IllegalArgumentException("Expected array"); return (JSONArray)raw; }
    private static String string(JSONObject object,String field,boolean nonempty) { Object value=object.opt(field); if (!(value instanceof String) || (nonempty && ((String)value).isEmpty())) throw new IllegalArgumentException("Invalid string: "+field); return (String)value; }
    private static String nullableString(JSONObject o,String key) { Object value=o.opt(key); if(value==null||value==JSONObject.NULL) return null; return string(o,key,false); }
    private static List<String> strings(JSONArray array) throws JSONException { List<String> result=new ArrayList<>(); for(int i=0;i<array.length();i++) { Object v=array.get(i); if(!(v instanceof String)||((String)v).isEmpty()) throw new IllegalArgumentException("Expected nonempty string id"); result.add((String)v); } return result; }
    private static List<Song> songs(JSONArray array) throws JSONException { List<Song> result=new ArrayList<>(); for(int i=0;i<array.length();i++) result.add(new Song(object(array.get(i)))); return result; }
    private static final class Song {
        final String id,name,singer,source,interval,meta;
        Song(JSONObject o) { id=string(o,"id",true); name=string(o,"name",false); singer=string(o,"singer",false); source=string(o,"source",false); if(!o.has("interval")) throw new IllegalArgumentException("Missing interval"); interval=nullableString(o,"interval"); meta=object(o.opt("meta")).toString(); if(meta==null) throw new IllegalArgumentException("Unserializable meta"); }
        String key() { return RainMusicPlaybackQueueKey.musicKey(id,name,singer); }
    }
    private static final class ListRow {
        final String id,name,source,sourceId; Object time;
        ListRow(Cursor c) { id=c.getString(0); name=c.getString(1); source=c.getString(2); sourceId=c.getString(3); time=c.isNull(4)?null:c.getLong(4); }
        ListRow(JSONObject o) { id=string(o,"id",true); name=string(o,"name",false); source=nullableString(o,"source"); sourceId=nullableString(o,"sourceListId"); Object value=o.opt("locationUpdateTime"); if(value!=null&&value!=JSONObject.NULL&&(!(value instanceof Number)||!Double.isFinite(((Number)value).doubleValue()))) throw new IllegalArgumentException("Invalid locationUpdateTime"); time=value==JSONObject.NULL?null:value; }
    }
}
