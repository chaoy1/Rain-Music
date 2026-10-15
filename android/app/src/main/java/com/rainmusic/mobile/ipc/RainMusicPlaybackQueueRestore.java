package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Startup identity mapping. Callers hold list LOCK before the Preferences WRITE_LOCK. */
final class RainMusicPlaybackQueueRestore {
    private RainMusicPlaybackQueueRestore() {}
    private static final String SNAPSHOT = "playback_queue_startup_restore";

    static JSONObject resolve(Context context, JSONObject saved) throws JSONException {
        Object indexValue = saved.opt("index");
        if (!(indexValue instanceof Number) || (Double.isInfinite(((Number) indexValue).doubleValue()) || Double.isNaN(((Number) indexValue).doubleValue())) ||
            ((Number) indexValue).doubleValue() != Math.rint(((Number) indexValue).doubleValue())) {
            throw new IllegalArgumentException("playInfo.index must be an integer");
        }
        double index = ((Number) indexValue).doubleValue();
        SQLiteDatabase db = RainMusicDatabase.open(context, RainMusicDatabase.TABLE_DB_INFO,
            RainMusicDatabase.TABLE_MY_LIST_MUSIC_INFO, "my_list_music_info_order");
        JSONArray original = null;
        Cursor cursor = db.rawQuery(RainMusicListMusicGetChannels.SQL_SELECT_QUEUE_RESTORE_SNAPSHOT, new String[] { SNAPSHOT });
        try {
            if (cursor.moveToFirst()) {
                String text = cursor.getString(0);
                validateJson(text);
                original = new JSONArray(text);
            }
        } finally { cursor.close(); }
        if (original == null) {
            original = new JSONArray();
            cursor = db.rawQuery(RainMusicListMusicGetChannels.SQL_MUSIC_BY_LIST_ID, new String[] { "default", "default" });
            try {
                while (cursor.moveToNext()) original.put(new JSONObject()
                    .put("id", cursor.getString(cursor.getColumnIndexOrThrow("id")))
                    .put("name", cursor.getString(cursor.getColumnIndexOrThrow("name")))
                    .put("singer", cursor.getString(cursor.getColumnIndexOrThrow("singer"))));
            } finally { cursor.close(); }
        }
        for (int i = 0; i < original.length(); i++) validateIdentity(original.getJSONObject(i));
        String musicId = optionalString(saved, "musicId");
        JSONObject target = null;
        if (musicId != null && !musicId.isEmpty()) {
            for (int i = 0; i < original.length(); i++) {
                JSONObject song = original.getJSONObject(i);
                if (musicId.equals(song.getString("id"))) { target = song; break; }
            }
            if (target == null) target = new JSONObject().put("id", musicId)
                .put("name", stringOrEmpty(saved, "musicName")).put("singer", stringOrEmpty(saved, "musicSinger"));
        } else if (index >= 0 && index < original.length()) target = original.getJSONObject((int) index);
        if (target == null) return null;
        JSONArray merged = RainMusicListMusicGetChannels.defaultQueue(context);
        int found = -1;
        for (int i = 0; i < merged.length(); i++) {
            if (target.getString("id").equals(merged.getJSONObject(i).getString("id"))) { found = i; break; }
        }
        if (found < 0) {
            String key = identityKey(target);
            for (int i = 0; i < merged.length(); i++) {
                if (key.equals(identityKey(merged.getJSONObject(i)))) { found = i; break; }
            }
        }
        if (found < 0) return null;
        JSONObject result = new JSONObject(saved.toString());
        JSONObject music = merged.getJSONObject(found);
        return result.put("index", found).put("musicId", music.get("id"))
            .put("musicName", music.get("name")).put("musicSinger", music.get("singer"));
    }

    static void complete(Context context) {
        SQLiteDatabase db = RainMusicDatabase.open(context, RainMusicDatabase.TABLE_DB_INFO);
        db.execSQL("DELETE FROM db_info WHERE field_name=?", new Object[] { SNAPSHOT });
        RainMusicListMusicGetChannels.finishStartupRestore();
    }

    private static void validateIdentity(JSONObject song) throws JSONException {
        if (!(song.opt("id") instanceof String) || !(song.opt("name") instanceof String) ||
            !(song.opt("singer") instanceof String)) throw new JSONException("Invalid queue restore identity");
    }
    private static String optionalString(JSONObject object, String field) throws JSONException {
        Object value = object.opt(field);
        if (value == null || value == JSONObject.NULL) return null;
        if (!(value instanceof String)) throw new JSONException("Expected string: " + field);
        return (String) value;
    }
    private static String stringOrEmpty(JSONObject object, String field) throws JSONException {
        String value = optionalString(object, field); return value == null ? "" : value;
    }
    private static String identityKey(JSONObject song) throws JSONException {
        return RainMusicPlaybackQueueKey.musicKey(song.getString("id"), optionalString(song, "name"), optionalString(song, "singer"));
    }

    /** org.json accepts trailing garbage and JavaScript extensions; persistent data must be JSON. */
    static void validateJson(String text) throws JSONException { new JsonSyntax(text).validate(); }
    private static final class JsonSyntax {
        final String text; int offset;
        JsonSyntax(String text) { this.text = text; }
        void validate() throws JSONException {
            if (text == null) fail();
            value(0); whitespace(); if (offset != text.length()) fail();
        }
        void whitespace() { while (offset < text.length() && " \n\r\t".indexOf(text.charAt(offset)) >= 0) offset++; }
        void fail() throws JSONException { throw new JSONException("Invalid JSON at offset " + offset); }
        boolean eat(char ch) { whitespace(); if (offset < text.length() && text.charAt(offset) == ch) { offset++; return true; } return false; }
        void value(int depth) throws JSONException {
            if (depth > 128) fail(); whitespace(); if (offset >= text.length()) fail();
            char ch = text.charAt(offset);
            if (ch == '"') { string(); return; }
            if (ch == '{') {
                offset++; if (eat('}')) return;
                do { whitespace(); string(); if (!eat(':')) fail(); value(depth + 1); } while (eat(','));
                if (!eat('}')) fail(); return;
            }
            if (ch == '[') {
                offset++; if (eat(']')) return;
                do { value(depth + 1); } while (eat(','));
                if (!eat(']')) fail(); return;
            }
            for (String literal : new String[] { "true", "false", "null" }) {
                if (text.startsWith(literal, offset)) { offset += literal.length(); return; }
            }
            int start = offset;
            if (ch == '-') offset++;
            if (offset >= text.length()) fail();
            if (text.charAt(offset) == '0') offset++;
            else { if (text.charAt(offset) < '1' || text.charAt(offset) > '9') fail(); digits(); }
            if (offset < text.length() && text.charAt(offset) == '.') { offset++; int from = offset; digits(); if (from == offset) fail(); }
            if (offset < text.length() && "eE".indexOf(text.charAt(offset)) >= 0) {
                offset++; if (offset < text.length() && "+-".indexOf(text.charAt(offset)) >= 0) offset++;
                int from = offset; digits(); if (from == offset) fail();
            }
            if (offset == start) fail();
        }
        void digits() { while (offset < text.length() && text.charAt(offset) >= '0' && text.charAt(offset) <= '9') offset++; }
        void string() throws JSONException {
            if (offset >= text.length() || text.charAt(offset++) != '"') fail();
            while (offset < text.length()) {
                char ch = text.charAt(offset++); if (ch == '"') return; if (ch < 32) fail();
                if (ch == '\\') {
                    if (offset >= text.length()) fail(); char escape = text.charAt(offset++);
                    if (escape == 'u') { for (int i = 0; i < 4; i++) { if (offset >= text.length() || "0123456789abcdefABCDEF".indexOf(text.charAt(offset++)) < 0) fail(); } }
                    else if ("\"\\/bfnrt".indexOf(escape) < 0) fail();
                }
            }
            fail();
        }
    }
}
