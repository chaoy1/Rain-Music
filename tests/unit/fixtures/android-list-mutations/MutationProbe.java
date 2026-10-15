package com.rainmusic.mobile.ipc;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.*;
import java.nio.file.*;
import java.util.*;

/** Runs actual handlers against the shared real SQLite test adapter. */
public final class MutationProbe {
    static final List<JSONObject> events = new ArrayList<>();
    static JSONArray query(SQLiteDatabase db, String sql, int columns) throws Exception {
        JSONArray rows = new JSONArray(); Cursor c = db.rawQuery(sql, new String[0]);
        try { while(c.moveToNext()) { JSONArray row = new JSONArray(); for(int i=0;i<columns;i++) row.put(c.isNull(i)?JSONObject.NULL:c.getString(i)); rows.put(row); } }
        finally { c.close(); } return rows;
    }
    public static void main(String[] args) throws Exception {
        RainMusicIpcPlugin plugin = new RainMusicIpcPlugin();
        RainMusicListMusicGetChannels.register(plugin);
        RainMusicListMutationChannels.register(plugin);
        RainMusicIpcHandlers.setEmitter((channel, values) -> {
            try { JSONObject e = new JSONObject(); e.put("channel", channel); e.put("payload", values.get(0)); e.put("locked", Thread.holdsLock(RainMusicListWriteLock.LOCK)); e.put("commits", RainMusicDatabase.db.commits); events.add(e); }
            catch(Exception error) { throw new IllegalStateException(error); }
        });
        JSONArray cases = (JSONArray) org.json.ProbeJson.parse(Files.readString(Paths.get(args[3]))).opt("cases");
        JSONArray results = new JSONArray();
        try(SQLiteDatabase db = new SQLiteDatabase(args[0], args[1], args[2])) {
            RainMusicDatabase.db = db;
            for(int i=0;i<cases.length();i++) {
                JSONObject scenario = cases.getJSONObject(i); db.reset(); events.clear();
                JSONArray seeds = (JSONArray) scenario.opt("seed");
                for(int j=0;j<seeds.length();j++) {
                    JSONObject s=seeds.getJSONObject(j);
                    db.execSQL("INSERT INTO my_list_music_info VALUES(?,?,?,?,?,?,?)",new Object[]{s.opt("id"),s.opt("listId"),s.opt("name"),s.opt("singer"),s.opt("source"),null,s.opt("meta").toString()});
                    db.execSQL("INSERT INTO my_list_music_info_order VALUES(?,?,?)",new Object[]{s.opt("listId"),s.opt("id"),s.opt("order")});
                }
                JSONArray lists=(JSONArray) scenario.opt("lists");
                for(int j=0;j<lists.length();j++) { JSONObject l=lists.getJSONObject(j); db.execSQL("INSERT INTO my_list VALUES(?,?,?,?,?,?)",new Object[]{l.opt("id"),l.opt("name"),null,null,j,null}); }
                if(scenario.has("missing")) db.execSQL("DROP TABLE "+scenario.getString("missing"),new Object[0]);
                if(scenario.has("badMeta")) db.execSQL("UPDATE my_list_music_info SET meta='bad'",new Object[0]);
                if(scenario.has("failAfter")) db.failAfter=((Number)scenario.opt("failAfter")).intValue();
                JSONObject result=new JSONObject(); result.put("name",scenario.opt("name"));
                try { String channel=scenario.getString("channel"); Object returned=RainMusicIpcHandlers.get(channel).handle(Collections.singletonList(scenario.opt("payload")),new RainMusicIpcHandlers.RequestContext("mutation",channel)); result.put("result",returned==null?JSONObject.NULL:returned); }
                catch(Exception error) { result.put("error",error.toString()); }
                result.put("rows",query(db,"SELECT listId,id,name,meta FROM my_list_music_info ORDER BY listId,id",4));
                result.put("orders",scenario.opt("missing")!=null?new JSONArray():query(db,"SELECT listId,musicInfoId,\"order\" FROM my_list_music_info_order ORDER BY listId,\"order\",rowid",3));
                result.put("lists",query(db,"SELECT id,position,locationUpdateTime FROM my_list ORDER BY position",3));
                JSONArray emitted=new JSONArray(); for(JSONObject event:events) emitted.put(event);
                result.put("events",emitted); result.put("commits",db.commits); result.put("rollbacks",db.rollbacks); results.put(result);
            }
        }
        Files.writeString(Paths.get(args[4]),results.toString());
    }
}
