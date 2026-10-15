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
    static volatile String coverQuery;
    /** 每个路由收到的请求数：用来断言"重试真的重发了请求"，而不只是断言最终状态。 */
    static final Map<String,Integer> requests=new ConcurrentHashMap<>();
    /** `/flaky` 还要失败几次（用来测"失败两次后重试成功"）。 */
    static volatile int flakyFailures;
    static int requestCount(String route){ return requests.getOrDefault(route,0); }
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
    /** 某个任务某个动作**发了几条** —— 用来钉"重试不能让 error 变多条"。 */
    static int count(String id,String action) { int n=0; for(JSONObject e:events.getOrDefault(id,Collections.emptyList())) if(action.equals(((JSONObject)e.opt("action")).opt("action"))) n++; return n; }
    /**
     * 等到某个任务**安静下来**（1.3 s 内没有新事件）。
     * 有重试延时时不能"看到 error 就数" —— 那时候后面几次尝试还没发生，
     * 把中间态当终态会**让断言失效**（它不是变红，而是变成一条测不到东西的断言）。
     * 1.3 s 的静默窗口必须**长于** `RETRY_DELAY_MS`（1 s），否则会把"正在等待重试"误判成结束。
     */
    static void settle(String id) throws Exception {
        long stableSince=System.nanoTime();int last=-1;long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(30);
        while(System.nanoTime()<deadline) {
            int size=events.getOrDefault(id,Collections.emptyList()).size();
            if(size!=last){last=size;stableSince=System.nanoTime();}
            else if(System.nanoTime()-stableSince>TimeUnit.MILLISECONDS.toNanos(1300)) return;
            Thread.sleep(50);
        }
        throw new AssertionError(id+" never settled");
    }
    public static void main(String[] args) throws Exception {
        root=new File(args[0]); root.mkdirs(); new Random(7).nextBytes(DATA);
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.setExecutor(Executors.newCachedThreadPool(r->{Thread t=new Thread(r); t.setDaemon(true); return t;}));
        server.createContext("/",exchange->{
            String route=exchange.getRequestURI().getPath();
            requests.merge(route,1,Integer::sum);
            try {
                if(route.equals("/expired")){exchange.sendResponseHeaders(403,-1);return;}
                if(route.equals("/error")){exchange.sendResponseHeaders(500,-1);return;}
                // 前 N 次 500，之后正常：用来验证"重试"而不是"一次就放弃"。
                if(route.equals("/flaky")&&flakyFailures>0){synchronized(DownloadRuntimeProbe.class){if(flakyFailures>0)flakyFailures--;}exchange.sendResponseHeaders(500,-1);return;}
                // 续传时给一个对不上的 Content-Range（触发"被拒的续传"），而**从头**请求时直接 500：
                // 这样三次尝试都会失败，于是可以观察到"部分文件确实被丢掉了"。
                if(route.equals("/bad-range-fail")&&exchange.getRequestHeaders().getFirst("Range")==null){exchange.sendResponseHeaders(500,-1);return;}
                if(route.equals("/redirect")){exchange.getResponseHeaders().set("Location",redirectChanged?"/other":"/slow");exchange.sendResponseHeaders(302,-1);return;}
                if(route.equals("/cover126")){coverQuery=exchange.getRequestURI().getQuery();}
                if(route.equals("/cover")||route.equals("/cover126")){byte[] image={(byte)0xff,(byte)0xd8,(byte)0xff,(byte)0xd9};exchange.sendResponseHeaders(200,image.length);exchange.getResponseBody().write(image);return;}
                int offset=0; String range=exchange.getRequestHeaders().getFirst("Range");
                if(range!=null){offset=Integer.parseInt(range.substring(6,range.length()-1));ranged=true;}
                if(!route.equals("/no-validator"))exchange.getResponseHeaders().set("ETag",route.equals("/changed-etag")&&changedValidator?"\"changed\"":"\"stable\"");
                if(offset>0 && !route.equals("/ignore")) exchange.getResponseHeaders().set("Content-Range","bytes "+((route.equals("/bad-range")||route.equals("/bad-range-fail"))?offset+1:offset)+"-"+(DATA.length-1)+"/"+DATA.length);
                if(route.equals("/ignore")) offset=0;
                exchange.sendResponseHeaders(offset>0?206:200,route.equals("/chunked")?0:DATA.length-offset);
                OutputStream out=exchange.getResponseBody();
                int end=route.equals("/short")?DATA.length/2:DATA.length;
                for(int i=offset;i<end;i+=1024){byte[] bytes=DATA;if(route.equals("/other")){bytes=new byte[DATA.length];Arrays.fill(bytes,(byte)42);}out.write(bytes,i,Math.min(1024,end-i));out.flush();if(Arrays.asList("/slow","/ack","/bad-range","/bad-range-fail","/ignore","/changed-etag").contains(route))try{Thread.sleep(route.equals("/ack")?10:4);}catch(InterruptedException ignored){}}
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
            // 桌面口径：瞬时失败要重试（`download.ts:130-143`，`retryNum > 2`），但 `error` **只发一次**。
            // 所以既断言最终状态，也断言"服务端确实收到了 3 次请求"。
            start("error","/error","error.mp3");waitFor("error","error");check(!has("error","complete"),"HTTP error cannot complete");
            settle("error");
            check(count("error","error")==1,"a failing task must emit exactly one error, not one per attempt");
            check(requestCount("/error")==3,"a transient failure must be retried up to three attempts (desktop download.ts:130-143)");
            // 前两次 500、第三次成功 ⇒ 必须自愈，且**一条 error 都不发**。
            flakyFailures=2;start("flaky","/flaky","flaky.mp3");waitFor("flaky","complete");
            check(Arrays.equals(DATA,Files.readAllBytes(new File(root,"downloads/flaky.mp3").toPath())),"a flaky transfer must recover and produce the exact bytes");
            check(!has("flaky","error"),"a recovered transfer must not report an error");
            check(requestCount("/flaky")==3,"the flaky route must have been attempted three times");
            start("short","/short","short.mp3");waitFor("short","error");check(!new File(root,"downloads/short.mp3").exists(),"short body cannot commit");
            start("chunked","/chunked","chunked.mp3");waitFor("chunked","error");check(!has("chunked","complete"),"unverifiable body cannot complete");
            start("slow","/slow","slow.mp3");waitFor("slow","progress");invoke("pause",json("id","slow"));Thread.sleep(100);check(!has("slow","complete"),"paused token cannot complete");
            new RainMusicDownloadTaskChannels(new Context(root)).register();
            start("slow","/slow","slow.mp3");waitFor("slow","complete");check(ranged,"paused part resumed with Range after executor restart");check(Arrays.equals(DATA,Files.readAllBytes(new File(root,"downloads/slow.mp3").toPath())),"resume bytes");
            // 被拒的续传：桌面是"先删掉再接不上就重启"（`download.ts:145-155`）。现在原生靠重试
            // **自动**完成这一步 —— 第一次被拒 ⇒ 丢掉接不上的部分 ⇒ 第二次从头下成功。
            start("bad","/bad-range","bad.mp3");waitFor("bad","progress");invoke("pause",json("id","bad"));Thread.sleep(100);
            start("bad","/bad-range","bad.mp3");waitFor("bad","complete");
            check(Arrays.equals(DATA,Files.readAllBytes(new File(root,"downloads/bad.mp3").toPath())),"a rejected resume must restart from zero and still produce the exact bytes");
            check(!has("bad","error"),"a self-healed resume rejection must not surface an error");
            // 丢弃本身要能**单独观察到**：让三次尝试都失败，于是"部分文件还在不在"成为直接证据。
            // 部分文件**直接种在磁盘上**（而不是靠"暂停一个下载"）—— 因为 `/bad-range-fail`
            // 在**不带 Range** 时就要 500（那样才保证重试也失败），而"暂停"那一步恰恰是不带 Range 的请求。
            File discardPart=new File(root,"downloads/discard.mp3.part");
            File discardManifest=new File(root,"downloads/discard.mp3.resume");
            Files.write(discardPart.toPath(),Arrays.copyOf(DATA,4096));
            Properties seed=new Properties();
            seed.setProperty("total",String.valueOf(DATA.length));
            seed.setProperty("validator","\"stable\"");
            seed.setProperty("id","discard");
            seed.setProperty("url",base+"/bad-range-fail");
            seed.setProperty("responseUrl",base+"/bad-range-fail");
            try(FileOutputStream out=new FileOutputStream(discardManifest)){seed.store(out,"seeded partial");}
            start("discard","/bad-range-fail","discard.mp3");waitFor("discard","error");
            settle("discard");
            check(!has("discard","complete"),"a permanently rejected resume cannot complete");
            check(!new File(root,"downloads/discard.mp3.part").exists(),"a rejected resume must discard the unusable partial");
            check(!new File(root,"downloads/discard.mp3.resume").exists(),"a rejected resume must discard the resume manifest");
            check(count("discard","error")==1,"three failed attempts must still emit exactly one error");
            check(requestCount("/bad-range-fail")==3,"all three attempts must reach the server");
            start("ignored","/ignore","ignored.mp3");waitFor("ignored","progress");invoke("pause",json("id","ignored"));Thread.sleep(100);
            start("ignored","/ignore","ignored.mp3");waitFor("ignored","complete");check(Arrays.equals(DATA,Files.readAllBytes(new File(root,"downloads/ignored.mp3").toPath())),"200 after Range must restart");
            start("changed","/changed-etag","changed.mp3");waitFor("changed","progress");invoke("pause",json("id","changed"));Thread.sleep(100);changedValidator=true;
            // 校验子变了 ⇒ 丢掉旧的部分、从头下。能 `complete` **且** 字节数正好等于 DATA，
            // 本身就证明"没有把旧字节接上新字节"（接上就会超长 ⇒ 不会被判成完成）。
            start("changed","/changed-etag","changed.mp3");waitFor("changed","complete");
            check(Arrays.equals(DATA,Files.readAllBytes(new File(root,"downloads/changed.mp3").toPath())),"a changed validator must restart from zero instead of appending");
            check(!new File(root,"downloads/changed.mp3.resume").exists(),"a completed transfer must remove the resume manifest");
            start("cross","/slow","cross.mp3");waitFor("cross","progress");invoke("pause",json("id","cross"));Thread.sleep(100);
            start("cross","/other","cross.mp3");waitFor("cross","complete");byte[] expectedCross=new byte[DATA.length];Arrays.fill(expectedCross,(byte)42);check(Arrays.equals(expectedCross,Files.readAllBytes(new File(root,"downloads/cross.mp3").toPath())),"cross-resource ETag must not mix bytes");
            start("redirect","/redirect","redirect.mp3");waitFor("redirect","progress");invoke("pause",json("id","redirect"));Thread.sleep(100);redirectChanged=true;
            // 重定向目标变了 ⇒ 丢掉旧的部分、从头下 **新目标** 的内容。
            // 断言"整份都是 42"是最强的形式：混进任何一个旧字节都会让它失败。
            start("redirect","/redirect","redirect.mp3");waitFor("redirect","complete");
            byte[] expectedRedirect=new byte[DATA.length];Arrays.fill(expectedRedirect,(byte)42);
            check(Arrays.equals(expectedRedirect,Files.readAllBytes(new File(root,"downloads/redirect.mp3").toPath())),"a changed redirect target must restart from zero and never mix the two resources' bytes");
            start("generation","/slow","generation.mp3");waitFor("generation","start");invoke("pause",json("id","generation","token","stale"));invoke("update_url",json("id","generation","token","stale","url",base+"/expired"));waitFor("generation","complete");check(!has("generation","refreshUrl"),"stale command must not affect live generation");
            try{start("escape","/ok","../escape.mp3");throw new AssertionError("traversal accepted");}catch(IllegalArgumentException expected){}
            File lyric=new File(root,"downloads/good.lrc");invoke("save_lyric",json("filePath",lyric.getPath(),"text","中文歌词","format","utf8"));check(Files.readString(lyric.toPath()).equals("\ufeff中文歌词"),"real UTF8 lyric");
            invoke("save_lyric",json("filePath",lyric.getPath(),"text","中文歌词","format","gbk"));check(Arrays.equals("中文歌词".getBytes(java.nio.charset.Charset.forName("GBK")),Files.readAllBytes(lyric.toPath())),"real GBK lyric");
            invoke("write_meta",json("filePath",good.getPath(),"title","标题","artist","Artist","album","Album","lyrics","歌词"));byte[] tagged=Files.readAllBytes(good.toPath());check(tagged[0]=='I'&&tagged[1]=='D'&&tagged[2]=='3',"real ID3 header");check(Arrays.equals(DATA,Arrays.copyOfRange(tagged,tagged.length-DATA.length,tagged.length)),"metadata preserves audio bytes");
            int tagSize=0;for(int i=6;i<10;i++)tagSize=(tagSize<<7)|(tagged[i]&0x7f);
            String tagRegion=new String(tagged,0,10+tagSize,StandardCharsets.ISO_8859_1);
            check(tagRegion.contains("USLT"),"lyric frame written");
            check(tagRegion.contains("\u0001zho\u0000\u0000"),"USLT language must match the desktop (zho, not eng)");
            invoke("write_meta",json("filePath",good.getPath(),"title","网易","APIC",base+"/cover126?src=music.126.net"));tagged=Files.readAllBytes(good.toPath());
            check("src=music.126.net&param=500y500".equals(coverQuery),"a music.126.net cover must get the desktop's param=500y500 rewrite");
            invoke("write_meta",json("filePath",good.getPath(),"title","标题","APIC",base+"/cover"));tagged=Files.readAllBytes(good.toPath());check(new String(tagged,StandardCharsets.ISO_8859_1).contains("APIC"),"cover is embedded as APIC");check(Arrays.equals(DATA,Arrays.copyOfRange(tagged,tagged.length-DATA.length,tagged.length)),"rewriting tags preserves audio bytes");
            // 封面失败**不能**让整条 write_meta 作废：桌面 `mp3Meta.js:29-36` 是丢掉 APIC 继续写。
            invoke("write_meta",json("filePath",good.getPath(),"title","Changed","APIC",base+"/expired"));tagged=Files.readAllBytes(good.toPath());
            check(Arrays.equals(DATA,Arrays.copyOfRange(tagged,tagged.length-DATA.length,tagged.length)),"a failed cover must still preserve audio bytes");
            tagSize=0;for(int i=6;i<10;i++)tagSize=(tagSize<<7)|(tagged[i]&0x7f);
            tagRegion=new String(tagged,0,10+tagSize,StandardCharsets.ISO_8859_1);
            check(tagRegion.contains("TIT2"),"a failed cover must not drop the other frames");
            check(!tagRegion.contains("APIC"),"a failed cover must be dropped, not embedded");
            try{invoke("save_lyric",json("filePath",new File(good,"x.lrc").getPath(),"text","lyric","format","utf8"));throw new AssertionError("write failure ignored");}catch(IOException expected){}
            // 桌面契约（download.ts:73-84）："跳过已存在文件"只在 downloaded == 0 时生效，
            // 并且只有**大于 100 字节**的残留才算"已存在"。
            File tiny=new File(root,"downloads/tiny.mp3");Files.write(tiny.toPath(),new byte[]{1,2,3});
            invoke("start",json("token","tiny","downloadInfo",json("id","tiny","downloaded",0,"metadata",json("url",base+"/ok","fileName","tiny.mp3")),"savePath","","skipExistFile",true));waitFor("tiny","complete");check(Arrays.equals(DATA,Files.readAllBytes(tiny.toPath())),"a leftover of 100 bytes or less must not block the download");
            File existing=new File(root,"downloads/existing.mp3");Files.write(existing.toPath(),new byte[200]);
            invoke("start",json("token","existing","downloadInfo",json("id","existing","downloaded",0,"metadata",json("url",base+"/ok","fileName","existing.mp3")),"savePath","","skipExistFile",true));waitFor("existing","error");check(Files.readAllBytes(existing.toPath()).length==200,"a real existing file must be preserved when skipping");
            File resumed=new File(root,"downloads/resumed.mp3");Files.write(resumed.toPath(),new byte[200]);
            invoke("start",json("token","resumed","downloadInfo",json("id","resumed","downloaded",1024,"metadata",json("url",base+"/ok","fileName","resumed.mp3")),"savePath","","skipExistFile",true));waitFor("resumed","complete");check(Arrays.equals(DATA,Files.readAllBytes(resumed.toPath())),"a task that already downloaded bytes must not be blocked by its own file");
            try{invoke("write_meta",json("filePath",new File(root,"downloads/x.flac").getPath()));throw new AssertionError("unsupported tag accepted");}catch(UnsupportedOperationException expected){}
            try{invoke("save_lyric",json("filePath",new File(root,"../escape.lrc").getPath(),"text","escape","format","utf8"));throw new AssertionError("outside write accepted");}catch(IllegalArgumentException expected){}
            System.out.println("DOWNLOAD_RUNTIME_OK");
        } finally {server.stop(0);}
    }
}
