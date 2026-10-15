package com.rainmusic.mobile.ipc;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.CountDownLatch;

/** Executes the real registered handler, replacing only Android DB connection hosting. */
public final class DownloadProbe {
    private static final String PREFIX = "winMain_download_list_";
    private static Object invoke(JSONObject operation) throws Exception {
        String channel = PREFIX + operation.getString("op");
        RainMusicIpcHandlers.Handler handler = RainMusicIpcHandlers.get(channel);
        if (handler == null) throw new IllegalStateException("Missing download handler: " + channel);
        List<Object> values = operation.has("payload") ? Collections.singletonList(operation.opt("payload")) : Collections.emptyList();
        return handler.handle(values, new RainMusicIpcHandlers.RequestContext("probe", channel));
    }
    private static JSONArray rows(SQLiteDatabase db) throws Exception {
        JSONArray rows = new JSONArray();
        Cursor cursor = db.rawQuery("SELECT * FROM download_list ORDER BY position, rowid", new String[0]);
        try {
            while (cursor.moveToNext()) {
                JSONArray row = new JSONArray();
                for (int i = 0; i < 13; i++) {
                    if (cursor.isNull(i)) row.put(JSONObject.NULL);
                    else if (i == 1 || i == 4 || i == 5 || i == 12) row.put(cursor.getDouble(i));
                    else row.put(cursor.getString(i));
                }
                rows.put(row);
            }
        } finally { cursor.close(); }
        return rows;
    }
    public static void main(String[] args) throws Exception {
        RainMusicDownloadChannels.register(new RainMusicIpcPlugin());
        List<String> events = Collections.synchronizedList(new ArrayList<>());
        RainMusicIpcHandlers.setEmitter((channel, values) -> events.add(channel));
        JSONObject input = org.json.ProbeJson.parse(Files.readString(Paths.get(args[3]), StandardCharsets.UTF_8));
        JSONArray scenarios = (JSONArray) input.opt("cases");
        JSONArray results = new JSONArray();
        try (SQLiteDatabase db = new SQLiteDatabase(args[0], args[1], args[2])) {
            RainMusicDatabase.db = db;
            for (int i = 0; i < scenarios.length(); i++) {
                JSONObject scenario = scenarios.getJSONObject(i);
                db.reset(); events.clear(); RainMusicDatabase.unlockedOpens.set(0);
                JSONArray seed = (JSONArray) scenario.opt("seed");
                Path sentinel = Boolean.TRUE.equals(scenario.opt("sentinel")) ? Files.createTempFile("rain-download-audio-", ".mp3") : null;
                if (sentinel != null) Files.writeString(sentinel, "download sentinel", StandardCharsets.UTF_8);
                for (int j = 0; j < seed.length(); j++) {
                    JSONArray row = (JSONArray) seed.get(j);
                    Object[] bindings = new Object[13];
                    for (int k = 0; k < bindings.length; k++) bindings[k] = row.get(k) == JSONObject.NULL ? null : row.get(k);
                    if (sentinel != null) bindings[10] = sentinel.toString();
                    db.execSQL("INSERT INTO download_list VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", bindings);
                }
                if (Boolean.TRUE.equals(scenario.opt("missingTable"))) db.execSQL("DROP TABLE download_list", new Object[0]);
                if (scenario.opt("failAfter") instanceof Number) db.failAfter = ((Number) scenario.opt("failAfter")).intValue();
                JSONObject result = new JSONObject(); result.put("name", scenario.opt("name"));
                JSONArray returned = new JSONArray();
                try {
                    JSONArray operations = (JSONArray) scenario.opt("operations");
                    if (Boolean.TRUE.equals(scenario.opt("concurrent"))) {
                        CountDownLatch start = new CountDownLatch(1);
                        List<Throwable> errors = Collections.synchronizedList(new ArrayList<>());
                        Thread[] threads = new Thread[operations.length()];
                        for (int j = 0; j < threads.length; j++) {
                            JSONObject operation = operations.getJSONObject(j);
                            threads[j] = new Thread(() -> {
                                try { start.await(); invoke(operation); }
                                catch (Throwable error) { errors.add(error); }
                            });
                            threads[j].start();
                        }
                        start.countDown();
                        for (Thread thread : threads) thread.join();
                        if (!errors.isEmpty()) throw new IllegalStateException(errors.get(0));
                    } else {
                        for (int j = 0; j < operations.length(); j++) {
                            Object value = invoke(operations.getJSONObject(j));
                            returned.put(value == null ? JSONObject.NULL : value);
                        }
                    }
                } catch (Exception error) { result.put("error", error.toString()); }
                result.put("returned", returned);
                result.put("rows", Boolean.TRUE.equals(scenario.opt("missingTable")) ? new JSONArray() : rows(db));
                JSONArray emitted = new JSONArray(); for (String event : events) emitted.put(event);
                result.put("events", emitted); result.put("commits", db.commits); result.put("rollbacks", db.rollbacks);
                result.put("unlockedOpens", RainMusicDatabase.unlockedOpens.get());
                if (sentinel != null) {
                    result.put("filePreserved", Files.exists(sentinel) && "download sentinel".equals(Files.readString(sentinel, StandardCharsets.UTF_8)));
                    Files.deleteIfExists(sentinel);
                }
                results.put(result);
            }
        }
        Files.writeString(Paths.get(args[4]), results.toString(), StandardCharsets.UTF_8);
    }
}
