package com.rainmusic.mobile.ipc;

import android.database.sqlite.SQLiteDatabase;
import org.json.JSONObject;
import org.json.JSONArray;
import java.nio.file.*;
import java.util.*;

/** Executes the real channel registry against the desktop schema in SQLite. */
public final class MediaCacheProbe {
    public static void main(String[] args) throws Exception {
        RainMusicMediaCacheChannels.register(new RainMusicIpcPlugin());
        JSONObject cases = org.json.ProbeJson.parse(Files.readString(Paths.get(args[3])));
        JSONArray all = (JSONArray) cases.opt("cases"), results = new JSONArray();
        try (SQLiteDatabase db = new SQLiteDatabase(args[0], args[1], args[2])) {
            RainMusicDatabase.db = db;
            for (int i = 0; i < all.length(); i++) {
                JSONObject scenario = all.getJSONObject(i), result = new JSONObject();
                db.reset();
                JSONArray sql = (JSONArray) scenario.opt("sql");
                if (sql != null) for (int j = 0; j < sql.length(); j++) db.execSQL((String) sql.get(j), new Object[0]);
                JSONArray ops = (JSONArray) scenario.opt("ops"), responses = new JSONArray();
                for (int j = 0; j < ops.length(); j++) {
                    JSONObject op = ops.getJSONObject(j), response = new JSONObject();
                    if (op.opt("failAfter") instanceof Number) db.failAfter = ((Number) op.opt("failAfter")).intValue();
                    try {
                        String channel = "winMain_" + op.getString("channel");
                        RainMusicIpcHandlers.Handler handler = RainMusicIpcHandlers.get(channel);
                        if (handler == null) throw new IllegalStateException("Missing handler: " + channel);
                        Object value = handler.handle(op.has("arg") ? Collections.singletonList(op.opt("arg")) : Collections.emptyList(), new RainMusicIpcHandlers.RequestContext("test", channel));
                        response.put("value", value == null ? JSONObject.NULL : value);
                    } catch (Exception error) { response.put("error", error.toString()); }
                    db.failAfter = 0;
                    responses.put(response);
                }
                result.put("name", scenario.opt("name")); result.put("responses", responses);
                result.put("commits", db.commits); result.put("rollbacks", db.rollbacks);
                results.put(result);
            }
        }
        Files.writeString(Paths.get(args[4]), results.toString());
    }
}
