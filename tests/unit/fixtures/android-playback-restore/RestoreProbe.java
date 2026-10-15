package com.rainmusic.mobile.ipc;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.*;
import java.nio.file.*;
import java.util.*;
public final class RestoreProbe {
  static JSONArray snapshots(SQLiteDatabase db) throws Exception {
    JSONArray rows=new JSONArray();Cursor cursor=db.rawQuery("SELECT field_value FROM db_info WHERE field_name='playback_queue_startup_restore'",new String[0]);
    try {while(cursor.moveToNext())rows.put(cursor.getString(0));}finally{cursor.close();}return rows;
  }
  public static void main(String[] args) throws Exception {
    JSONObject input=new JSONObject(Files.readString(Paths.get(args[3])));JSONArray cases=(JSONArray)input.opt("cases");JSONArray results=new JSONArray();
    try(SQLiteDatabase db=new SQLiteDatabase(args[0],args[1],args[2])) {
      RainMusicDatabase.db=db;
      for(int n=0;n<cases.length();n++) {
        JSONObject scenario=cases.getJSONObject(n);db.reset();
        android.content.Context context=new android.content.Context();RainMusicIpcPlugin plugin=new RainMusicIpcPlugin(context);
        java.lang.reflect.Field pending=RainMusicListMusicGetChannels.class.getDeclaredField("queueStartupRestorePending");pending.setAccessible(true);pending.setBoolean(null,true);
        RainMusicDataChannels.register(plugin);RainMusicListMusicGetChannels.register(plugin);
        JSONArray seed=(JSONArray)scenario.opt("seed");
        for(int i=0;i<seed.length();i++){JSONObject song=seed.getJSONObject(i);db.execSQL("INSERT INTO my_list_music_info VALUES(?,?,?,?,?,?,?)",new Object[]{song.opt("id"),"default",song.opt("name"),song.opt("singer"),"wy",null,"{}"});db.execSQL("INSERT INTO my_list_music_info_order VALUES(?,?,?)",new Object[]{"default",song.opt("id"),i});}
        if(scenario.has("snapshot")) db.execSQL("INSERT INTO db_info(field_name,field_value) VALUES(?,?)",new Object[]{"playback_queue_startup_restore",scenario.opt("snapshot")});
        context.prefs.memory=context.prefs.durable=scenario.isNull("store")?null:scenario.getString("store");context.prefs.failCommit=Boolean.TRUE.equals(scenario.opt("failCommit"));
        if(scenario.has("drop")) db.execSQL("DROP TABLE "+scenario.getString("drop"),new Object[0]);
        if(Boolean.TRUE.equals(scenario.opt("failDelete"))) db.failAfter=1;
        JSONObject result=new JSONObject();result.put("name",scenario.opt("name"));String channel=Boolean.TRUE.equals(scenario.opt("save"))?RainMusicDataChannels.CHANNEL_SAVE_DATA:RainMusicDataChannels.CHANNEL_GET_DATA;
        Object payload=scenario.opt("payload");
        try { Object value=RainMusicIpcHandlers.get(channel).handle(Collections.singletonList(payload),new RainMusicIpcHandlers.RequestContext("restore",channel));result.put("result",value==null?JSONObject.NULL:value); }
        catch(Exception error){result.put("error",error.toString());}
        result.put("memory",context.prefs.memory==null?JSONObject.NULL:context.prefs.memory);result.put("durable",context.prefs.durable==null?JSONObject.NULL:context.prefs.durable);result.put("writes",context.prefs.writes);result.put("listLocked",context.prefs.listLocked);result.put("storeLocked",context.prefs.storeLocked);
        if(!"db_info".equals(scenario.opt("drop")))result.put("snapshots",snapshots(db));
        if(Boolean.TRUE.equals(scenario.opt("retry"))){context.prefs.failCommit=false;db.failAfter=0;try{Object value=RainMusicIpcHandlers.get(channel).handle(Collections.singletonList(payload),new RainMusicIpcHandlers.RequestContext("retry",channel));result.put("retryResult",value==null?JSONObject.NULL:value);}catch(Exception error){result.put("retryError",error.toString());}result.put("retrySnapshots",snapshots(db));result.put("retryDurable",context.prefs.durable);}
        // Completing restoration must disable fresh startup snapshots, while dirty repair still runs.
        if(Boolean.TRUE.equals(scenario.opt("dirtyAfter"))){RainMusicDataChannels.register(plugin);db.execSQL("INSERT INTO my_list_music_info VALUES(?,?,?,?,?,?,?)",new Object[]{"new-duplicate","default","song","Singer","wy",null,"{}"});db.execSQL("INSERT INTO my_list_music_info_order VALUES(?,?,?)",new Object[]{"default","new-duplicate",100});Object rows=RainMusicIpcHandlers.get(RainMusicListMusicGetChannels.CHANNEL_MUSIC_GET).handle(Collections.singletonList("default"),new RainMusicIpcHandlers.RequestContext("again","get"));result.put("againRows",rows);result.put("againSnapshots",snapshots(db));}
        results.put(result);
      }
    }
    Files.writeString(Paths.get(args[4]),results.toString());
  }
}
