package com.rainmusic.mobile.ipc;

import android.content.Context;
import com.sun.net.httpserver.HttpServer;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;

/** Real JVM HttpURLConnection + local HTTP + filesystem. No Android/device claim. */
public final class DownloadRuntimeProbe {
    static final Map<String, List<JSONObject>> events = new ConcurrentHashMap<>();
    static String base;
    static File root;
    static final byte[] DATA = new byte[256 * 1024];
    static volatile boolean ranged;
    static volatile boolean changedValidator;
    static volatile boolean redirectChanged;
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    static JSONObject json(Object... values) throws Exception { JSONObject object = new JSONObject(); for (int i=0;i<values.length;i+=2) object.put((String)values[i],values[i+1]); return object; }
    static Object invoke(String name, JSONObject value) throws Exception { return RainMusicIpcHandlers.get("winMain_download_task_"+name).handle(Collections.singletonList(value),new RainMusicIpcHandlers.RequestContext("p", name)); }
    static JSONObject start(String id, String endpoint, String file) throws Exception { return (JSONObject) invoke("start",json("token",id,"downloadInfo",json("id",id,"metadata",json("url",base+endpoint,"fileName",file)),"savePath","","skipExistFile",false)); }
    static void waitFor(String id, String action) throws Exception {
        long deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(Long.getLong("rain.probe.timeoutMs",10000L));
        while(System.nanoTime()<deadline) {
            for(JSONObject item:events.getOrDefault(id,Collections.emptyList())) if(action.equals(((JSONObject)item.opt("action")).opt("action"))) return;
            Thread.sleep(10);
        }
        throw new AssertionError(id+" missing "+action+" events="+events.get(id));
    }
    static boolean has(String id,String action) { for(JSONObject e:events.getOrDefault(id,Collections.emptyList())) if(action.equals(((JSONObject)e.opt("action")).opt("action"))) return true; return false; }
    public static void main(String[] args) throws Exception {
        root=new File(args[0]); root.mkdirs(); new Random(7).nextBytes(DATA);
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.setExecutor(Executors.newCachedThreadPool(r->{Thread t=new Thread(r); t.setDaemon(true); return t;}));
        server.createContext("/",exchange->{
            String route=exchange.getRequestURI().getPath();
            try {
                if(route.equals("/expired")){exchange.sendResponseHeaders(403,-1);return;}
                if(route.equals("/error")){exchange.sendResponseHeaders(500,-1);return;}
                if(route.equals("/redirect")){exchange.getResponseHeaders().set("Location",redirectChanged?"/other":"/slow");exchange.sendResponseHeaders(302,-1);return;}
                if(route.equals("/cover")){byte[] image={(byte)0xff,(byte)0xd8,(byte)0xff,(byte)0xd9};exchange.sendResponseHeaders(200,image.length);exchange.getResponseBody().write(image);return;}
                int offset=0; String range=exchange.getRequestHeaders().getFirst("Range");
                if(range!=null){offset=Integer.parseInt(range.substring(6,range.length()-1));ranged=true;}
                if(!route.equals("/no-validator"))exchange.getResponseHeaders().set("ETag",route.equals("/changed-etag")&&changedValidator?"\"changed\"":"\"stable\"");
                if(offset>0 && !route.equals("/ignore")) exchange.getResponseHeaders().set("Content-Range","bytes "+(route.equals("/bad-range")?offset+1:offset)+"-"+(DATA.length-1)+"/"+DATA.length);
                if(route.equals("/ignore")) offset=0;
                exchange.sendResponseHeaders(offset>0?206:200,route.equals("/chunked")?0:DATA.length-offset);
                OutputStream out=exchange.getResponseBody();
                int end=route.equals("/short")?DATA.length/2:DATA.length;
                for(int i=offset;i<end;i+=1024){byte[] bytes=DATA;if(route.equals("/other")){bytes=new byte[DATA.length];Arrays.fill(bytes,(byte)42);}out.write(bytes,i,Math.min(1024,end-i));out.flush();if(Arrays.asList("/slow","/ack","/bad-range","/ignore","/changed-etag").contains(route))try{Thread.sleep(route.equals("/ack")?10:4);}catch(InterruptedException ignored){}}
            } catch(IOException ignored) {} finally { exchange.close(); }
        });server.start();base="http://127.0.0.1:"+server.getAddress().getPort();
        try {
            RainMusicIpcHandlers.setEmitter((channel,payload)->{JSONObject event=(JSONObject)payload.get(0);events.computeIfAbsent((String)event.opt("id"),k->new CopyOnWriteArrayList<>()).add(event);});
            new RainMusicDownloadTaskChannels(new Context(root)).register();
            long acknowledgement=System.nanoTime();start("ack","/ack","ack.mp3");check(System.nanoTime()-acknowledgement<TimeUnit.SECONDS.toNanos(1),"start must not wait for slow HTTP");invoke("pause",json("id","ack"));
            long before=System.nanoTime(); JSONObject result=start("good","/ok","good.mp3"); check(System.nanoTime()-before<TimeUnit.SECONDS.toNanos(1),"start must acknowledge quickly");
            waitFor("good","complete");File good=new File((String)result.opt("filePath"));check(Arrays.equals(DATA,Files.readAllBytes(good.toPath())),"exact bytes");
            invoke("remove",json("id","good"));check(good.exists(),"remove must preserve completed file");
            start("expired","/expired","expired.mp3");waitFor("expired","refreshUrl");invoke("update_url",json("id","expired","url",base+"/ok"));waitFor("expired","complete");
            start("error","/error","error.mp3");waitFor("error","error");check(!has("error","complete"),"HTTP error cannot complete");
            start("short","/short","short.mp3");waitFor("short","error");check(!new File(root,"downloads/short.mp3").exists(),"short body cannot commit");
            start("chunked","/chunked","chunked.mp3");waitFor("chunked","error");check(!has("chunked","complete"),"unverifiable body cannot complete");
            start("slow","/slow","slow.mp3");waitFor("slow","progress");invoke("pause",json("id","slow"));Thread.sleep(100);check(!has("slow","complete"),"paused token cannot complete");
            new RainMusicDownloadTaskChannels(new Context(root)).register();
            start("slow","/slow","slow.mp3");waitFor("slow","complete");check(ranged,"paused part resumed with Range after executor restart");check(Arrays.equals(DATA,Files.readAllBytes(new File(root,"downloads/slow.mp3").toPath())),"resume bytes");
            start("bad","/bad-range","bad.mp3");waitFor("bad","progress");invoke("pause",json("id","bad"));Thread.sleep(100);
            start("bad","/bad-range","bad.mp3");waitFor("bad","error");check(!has("bad","complete"),"invalid Content-Range cannot complete");
            start("ignored","/ignore","ignored.mp3");waitFor("ignored","progress");invoke("pause",json("id","ignored"));Thread.sleep(100);
            start("ignored","/ignore","ignored.mp3");waitFor("ignored","complete");check(Arrays.equals(DATA,Files.readAllBytes(new File(root,"downloads/ignored.mp3").toPath())),"200 after Range must restart");
            start("changed","/changed-etag","changed.mp3");waitFor("changed","progress");invoke("pause",json("id","changed"));Thread.sleep(100);changedValidator=true;
            start("changed","/changed-etag","changed.mp3");waitFor("changed","error");check(!has("changed","complete"),"changed validator must never append");
            start("cross","/slow","cross.mp3");waitFor("cross","progress");invoke("pause",json("id","cross"));Thread.sleep(100);
            start("cross","/other","cross.mp3");waitFor("cross","complete");byte[] expectedCross=new byte[DATA.length];Arrays.fill(expectedCross,(byte)42);check(Arrays.equals(expectedCross,Files.readAllBytes(new File(root,"downloads/cross.mp3").toPath())),"cross-resource ETag must not mix bytes");
            start("redirect","/redirect","redirect.mp3");waitFor("redirect","progress");invoke("pause",json("id","redirect"));Thread.sleep(100);redirectChanged=true;
            start("redirect","/redirect","redirect.mp3");waitFor("redirect","error");check(!has("redirect","complete"),"redirect target change must not mix bytes");
            start("generation","/slow","generation.mp3");waitFor("generation","start");invoke("pause",json("id","generation","token","stale"));invoke("update_url",json("id","generation","token","stale","url",base+"/expired"));waitFor("generation","complete");check(!has("generation","refreshUrl"),"stale command must not affect live generation");
            try{start("escape","/ok","../escape.mp3");throw new AssertionError("traversal accepted");}catch(IllegalArgumentException expected){}
            File lyric=new File(root,"downloads/good.lrc");invoke("save_lyric",json("filePath",lyric.getPath(),"text","中文歌词","format","utf8"));check(Files.readString(lyric.toPath()).equals("\ufeff中文歌词"),"real UTF8 lyric");
            invoke("save_lyric",json("filePath",lyric.getPath(),"text","中文歌词","format","gbk"));check(Arrays.equals("中文歌词".getBytes(java.nio.charset.Charset.forName("GBK")),Files.readAllBytes(lyric.toPath())),"real GBK lyric");
            invoke("write_meta",json("filePath",good.getPath(),"title","标题","artist","Artist","album","Album","lyrics","歌词"));byte[] tagged=Files.readAllBytes(good.toPath());check(tagged[0]=='I'&&tagged[1]=='D'&&tagged[2]=='3',"real ID3 header");check(Arrays.equals(DATA,Arrays.copyOfRange(tagged,tagged.length-DATA.length,tagged.length)),"metadata preserves audio bytes");
            invoke("write_meta",json("filePath",good.getPath(),"title","标题","APIC",base+"/cover"));tagged=Files.readAllBytes(good.toPath());check(new String(tagged,StandardCharsets.ISO_8859_1).contains("APIC"),"cover is embedded as APIC");check(Arrays.equals(DATA,Arrays.copyOfRange(tagged,tagged.length-DATA.length,tagged.length)),"rewriting tags preserves audio bytes");
            byte[] unchanged=tagged;
            try{invoke("write_meta",json("filePath",good.getPath(),"title","Changed","APIC",base+"/expired"));throw new AssertionError("cover failure ignored");}catch(IOException expected){}
            check(Arrays.equals(unchanged,Files.readAllBytes(good.toPath())),"failed metadata write preserves original");
            try{invoke("save_lyric",json("filePath",new File(good,"x.lrc").getPath(),"text","lyric","format","utf8"));throw new AssertionError("write failure ignored");}catch(IOException expected){}
            File skip=new File(root,"downloads/skip.mp3");Files.write(skip.toPath(),new byte[]{1,2,3});
            invoke("start",json("token","skip","downloadInfo",json("id","skip","metadata",json("url",base+"/ok","fileName","skip.mp3")),"savePath","","skipExistFile",true));waitFor("skip","error");check(Arrays.equals(Files.readAllBytes(skip.toPath()),new byte[]{1,2,3}),"skip existing preserves original");
            try{invoke("write_meta",json("filePath",new File(root,"downloads/x.flac").getPath()));throw new AssertionError("unsupported tag accepted");}catch(UnsupportedOperationException expected){}
            try{invoke("save_lyric",json("filePath",new File(root,"../escape.lrc").getPath(),"text","escape","format","utf8"));throw new AssertionError("outside write accepted");}catch(IllegalArgumentException expected){}
            System.out.println("DOWNLOAD_RUNTIME_OK");
        } finally {server.stop(0);}
    }
}
