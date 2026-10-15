package com.rainmusic.mobile.ipc;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.CountDownLatch;

public final class MusicAddProbe {
    private static final List<JSONObject> events = Collections.synchronizedList(new ArrayList<>());
    private static volatile boolean delayFirstEvent;
    private static CountDownLatch firstEvent, releaseFirstEvent;
    private static JSONArray rows(SQLiteDatabase db, String sql) throws Exception {
        Cursor cursor = db.rawQuery(sql, new String[0]);
        JSONArray result = new JSONArray();
        try {
            while (cursor.moveToNext()) {
                JSONArray row = new JSONArray();
                for (int i = 0; i < 3; i++) row.put(cursor.getString(i));
                result.put(row);
            }
        } finally { cursor.close(); }
        return result;
    }
    public static void main(String[] args) throws Exception {
        RainMusicIpcPlugin plugin = new RainMusicIpcPlugin();
        RainMusicListMusicGetChannels.register(plugin);
        RainMusicListMusicAddChannels.register(plugin);
        RainMusicIpcHandlers.setEmitter((channel, values) -> {
            try {
                JSONObject event = new JSONObject();
                event.put("channel", channel);
                event.put("payload", values.get(0));
                event.put("locked", Thread.holdsLock(RainMusicListWriteLock.LOCK));
                event.put("commits", RainMusicDatabase.db.commits);
                JSONObject data = (JSONObject) values.get(0);
                JSONArray songs = (JSONArray) data.opt("musicInfos");
                String firstId = songs.length() == 0 ? "" : songs.getJSONObject(0).getString("id");
                if (delayFirstEvent && "a".equals(firstId)) {
                    firstEvent.countDown();
                    if (!releaseFirstEvent.await(5, java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException("Event gate timed out");
                }
                events.add(event);
            } catch (Exception error) { throw new IllegalStateException(error); }
        });
        JSONObject cases = org.json.ProbeJson.parse(Files.readString(Paths.get(args[3]), StandardCharsets.UTF_8));
        JSONArray scenarios = (JSONArray) cases.opt("cases");
        JSONArray results = new JSONArray();
        try (SQLiteDatabase db = new SQLiteDatabase(args[0], args[1], args[2])) {
            RainMusicDatabase.db = db;
            for (int i = 0; i < scenarios.length(); i++) {
                JSONObject scenario = scenarios.getJSONObject(i);
                db.reset(); events.clear();
                JSONArray seed = (JSONArray) scenario.opt("seed");
                for (int j = 0; j < seed.length(); j++) {
                    JSONObject song = seed.getJSONObject(j);
                    db.execSQL("INSERT INTO my_list_music_info VALUES(?,?,?,?,?,?,?)", new Object[] {
                        song.opt("id"), scenario.opt("listId"), song.opt("name"), song.opt("singer"), song.opt("source"), null, song.opt("meta").toString(),
                    });
                    if (song.has("order")) db.execSQL("INSERT INTO my_list_music_info_order VALUES(?,?,?)", new Object[] { scenario.opt("listId"), song.opt("id"), song.opt("order") });
                }
                if (Boolean.TRUE.equals(scenario.opt("orphan"))) db.execSQL("INSERT INTO my_list_music_info_order VALUES(?,?,?)", new Object[] { scenario.opt("listId"), "orphan", 999 });
                if (Boolean.TRUE.equals(scenario.opt("badMeta"))) db.execSQL("UPDATE my_list_music_info SET meta='broken'", new Object[0]);
                if (Boolean.TRUE.equals(scenario.opt("missingTable"))) db.execSQL("DROP TABLE my_list_music_info_order", new Object[0]);
                if (scenario.opt("failAfter") instanceof Number) db.failAfter = ((Number) scenario.opt("failAfter")).intValue();
                JSONObject result = new JSONObject(); result.put("name", scenario.opt("name"));
                try {
                    Object payload = scenario.opt("payload");
                    RainMusicIpcHandlers.Handler handler = RainMusicIpcHandlers.get("player_list_music_add");
                    if (Boolean.TRUE.equals(scenario.opt("concurrent"))) {
                        db.musicReadDelay = 40;
                        delayFirstEvent = Boolean.TRUE.equals(scenario.opt("delayEvent"));
                        firstEvent = new CountDownLatch(1); releaseFirstEvent = new CountDownLatch(1);
                        db.commitGate = delayFirstEvent ? new CountDownLatch(2) : null;
                        CountDownLatch start = new CountDownLatch(1);
                        List<Throwable> failures = Collections.synchronizedList(new ArrayList<>());
                        Thread[] threads = new Thread[2];
                        for (int j = 0; j < 2; j++) {
                            final int index = j;
                            threads[j] = new Thread(() -> {
                                try { start.await(); handler.handle(Collections.singletonList(((JSONArray) payload).get(index)), new RainMusicIpcHandlers.RequestContext("add-" + index, "player_list_music_add")); }
                                catch (Throwable error) { failures.add(error); }
                            });
                        }
                        if (delayFirstEvent) {
                            threads[0].start(); start.countDown();
                            if (!firstEvent.await(5, java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException("First event never reached emitter");
                            threads[1].start();
                            if (!db.commitGate.await(5, java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException("Second commit never arrived");
                            // A delayed publisher must serialize B's publication, even though B can commit.
                            // Joining the worker bounds the wait; no wall-clock timing determines expected order.
                            threads[1].join(200);
                            releaseFirstEvent.countDown();
                        } else {
                            for (Thread thread : threads) thread.start(); start.countDown();
                        }
                        for (Thread thread : threads) thread.join();
                        delayFirstEvent = false; db.commitGate = null;
                        db.musicReadDelay = 0;
                        if (!failures.isEmpty()) throw new IllegalStateException(failures.get(0));
                        result.put("result", JSONObject.NULL);
                    } else {
                        List<Object> values = Boolean.TRUE.equals(scenario.opt("noArgs")) ? Collections.emptyList() : Collections.singletonList(payload);
                        Object returned = handler.handle(values, new RainMusicIpcHandlers.RequestContext("add", "player_list_music_add"));
                        result.put("result", returned == null ? JSONObject.NULL : returned);
                    }
                } catch (Exception error) { result.put("error", error.toString()); }
                result.put("rows", rows(db, "SELECT id, name, meta FROM my_list_music_info ORDER BY rowid"));
                result.put("orders", Boolean.TRUE.equals(scenario.opt("missingTable")) ? new JSONArray() : rows(db, "SELECT listId, musicInfoId, \"order\" FROM my_list_music_info_order ORDER BY \"order\", rowid"));
                result.put("snapshots", rows(db, "SELECT id, field_name, field_value FROM db_info WHERE field_name='playback_queue_startup_restore'"));
                JSONArray emitted = new JSONArray(); for (JSONObject event : events) emitted.put(event);
                result.put("events", emitted); result.put("commits", db.commits); result.put("rollbacks", db.rollbacks);
                results.put(result);
            }
        }
        Files.writeString(Paths.get(args[4]), results.toString(), StandardCharsets.UTF_8);
    }
}
