package com.rainmusic.mobile.ipc;

import android.content.Context;
import android.system.Os;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;

/** Main-WebView IPC facade's private-directory HTTP executor. No foreground service. */
public final class RainMusicDownloadTaskChannels {
    public static final String PREFIX = "winMain_download_task_";
    public static final String EVENT = PREFIX + "event";
    private static final Pattern RANGE = Pattern.compile("bytes (\\d+)-(\\d+)/(\\d+)");
    private final File root;
    private final Object gate = new Object();
    private final Map<String, Task> tasks = new ConcurrentHashMap<>();
    private final Map<String, Object> pathLocks = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newFixedThreadPool(3, runnable -> {
        Thread thread = new Thread(runnable, "RainMusicDownload"); thread.setDaemon(true); return thread;
    });

    public RainMusicDownloadTaskChannels(Context context) {
        if (context == null) throw new IllegalArgumentException("Android context is required");
        Context app = context.getApplicationContext();
        File base = app.getExternalFilesDir(null);
        if (base == null) base = app.getFilesDir();
        root = new File(base, "downloads");
    }

    public void register() {
        RainMusicIpcHandlers.register(PREFIX + "start", (args, ctx) -> start(params(args), ctx));
        RainMusicIpcHandlers.register(PREFIX + "pause", (args, ctx) -> { cancel(params(args)); return null; });
        RainMusicIpcHandlers.register(PREFIX + "remove", (args, ctx) -> { cancel(params(args)); return null; });
        RainMusicIpcHandlers.register(PREFIX + "update_url", (args, ctx) -> updateUrl(params(args), ctx));
        RainMusicIpcHandlers.register(PREFIX + "save_lyric", (args, ctx) -> { saveLyric(params(args)); return null; });
        RainMusicIpcHandlers.register(PREFIX + "write_meta", (args, ctx) -> { writeMeta(params(args)); return null; });
    }

    private static JSONObject params(List<Object> args) {
        if (args == null || args.size() != 1 || !(args.get(0) instanceof JSONObject)) throw new IllegalArgumentException("Download IPC requires one object");
        return (JSONObject)args.get(0);
    }
    private static String string(JSONObject object, String name) {
        Object value = object.opt(name);
        if (!(value instanceof String) || ((String)value).isEmpty()) throw new IllegalArgumentException(name + " must be a nonempty string");
        return (String)value;
    }
    private static JSONObject object(JSONObject params, String name) {
        Object value = params.opt(name);
        if (!(value instanceof JSONObject)) throw new IllegalArgumentException(name + " must be an object");
        return (JSONObject)value;
    }
    private static JSONObject json(Object... pairs) throws Exception {
        JSONObject value = new JSONObject();
        for(int i=0; i<pairs.length; i+=2) value.put((String)pairs[i], pairs[i+1]);
        return value;
    }
    private File safeFile(String path) throws IOException {
        if (File.separatorChar == '\\') path = path.replace('\\', '/'); // JVM probe on Windows; Android paths use '/'.
        if (path.indexOf('\0') >= 0 || path.indexOf('\\') >= 0) throw new IllegalArgumentException("Invalid download path");
        for (String segment : path.split("/")) if (segment.equals("..")) throw new IllegalArgumentException("Path traversal is forbidden");
        File file = new File(path);
        if (!file.isAbsolute()) file = new File(root, path);
        File canonical = file.getCanonicalFile();
        String prefix = root.getCanonicalPath() + File.separator;
        if (!canonical.getPath().startsWith(prefix)) throw new IllegalArgumentException("Only the app-private downloads directory is writable");
        return canonical;
    }
    private File target(JSONObject info, JSONObject params) throws Exception {
        String name = string(info, "fileName");
        if (name.contains("/") || name.contains("\\") || name.equals(".") || name.equals("..") || name.endsWith(".part") || name.endsWith(".resume")) throw new IllegalArgumentException("fileName must be a plain media filename");
        Object rawPath = params.opt("savePath");
        if (rawPath != null && rawPath != JSONObject.NULL && !(rawPath instanceof String)) throw new IllegalArgumentException("savePath must be a string");
        String path = rawPath instanceof String ? (String)rawPath : "";
        // Empty/default directory maps to the private root. External desktop paths are rejected.
        return safeFile(path.isEmpty() ? name : path + "/" + name);
    }
    private static URL url(String raw) throws Exception {
        URL value = new URL(raw);
        if (!(value.getProtocol().equals("http") || value.getProtocol().equals("https")) || value.getHost().isEmpty() || value.getUserInfo() != null) throw new IllegalArgumentException("Only HTTP(S) URLs without credentials are supported");
        return value;
    }
    private static Proxy proxy(JSONObject params) {
        Object raw = params.opt("proxy");
        if (raw == null || raw == JSONObject.NULL) return Proxy.NO_PROXY;
        if (!(raw instanceof JSONObject)) throw new IllegalArgumentException("proxy must be an object");
        JSONObject value = (JSONObject)raw;
        Object port = value.opt("port");
        if (!(port instanceof Number) || ((Number)port).intValue() < 1 || ((Number)port).intValue() > 65535) throw new IllegalArgumentException("Invalid proxy port");
        return new Proxy(Proxy.Type.HTTP, new InetSocketAddress(string(value, "host"), ((Number)port).intValue()));
    }
    private Object start(JSONObject params, RainMusicIpcHandlers.RequestContext ctx) throws Exception {
        JSONObject info = object(params, "downloadInfo");
        JSONObject metadata = object(info, "metadata");
        String id = string(info, "id");
        File file = target(metadata, params);
        Task task = new Task(id, string(params, "token"), url(string(metadata, "url")), file, proxy(params), Boolean.TRUE.equals(params.opt("skipExistFile")), ctx);
        synchronized(gate) {
            for (Task active : tasks.values()) if (!active.cancelled && !active.id.equals(id) && active.file.equals(file)) throw new IllegalStateException("Another task already owns this download path");
            Task previous = tasks.put(id, task);
            if (previous != null) previous.stop();
            executor.execute(() -> transfer(task));
        }
        // Never wait for HTTP here: bridge invoke has a 15s request timeout.
        return json("filePath", file.getPath(), "savePath", file.getParent());
    }
    private Object updateUrl(JSONObject params, RainMusicIpcHandlers.RequestContext ctx) throws Exception {
        String id = string(params, "id"); URL url = url(string(params, "url"));
        synchronized(gate) {
            Task old = tasks.get(id);
            if (old == null || old.cancelled) throw new IllegalStateException("No live download task for " + id);
            if (params.opt("token") instanceof String && !old.token.equals(params.opt("token"))) return null;
            Task next = new Task(id, old.token, url, old.file, old.proxy, old.skip, ctx);
            old.stop(); tasks.put(id, next); executor.execute(() -> transfer(next));
        }
        return null;
    }
    private void cancel(JSONObject params) {
        String id = string(params, "id");
        synchronized(gate) {
            Task task = tasks.get(id);
            if (task != null && (!(params.opt("token") instanceof String) || task.token.equals(params.opt("token")))) {
                tasks.remove(id); task.stop();
            }
        }
        // Removing a queue item never deletes a completed media file. A .part
        // is retained too, so deleting/recreating the record can safely resume.
    }
    private boolean live(Task task) { return tasks.get(task.id) == task && !task.cancelled; }
    private Object lock(File path) { return pathLocks.computeIfAbsent(path.getPath(), key -> new Object()); }
    private void emit(Task task, String action, Object data) throws Exception {
        synchronized(gate) {
            if (!live(task)) return;
            JSONObject value = json("action", action);
            if (data != null) value.put("data", data);
            task.ctx.emitTo(EVENT, json("id", task.id, "token", task.token, "action", value));
        }
    }
    private void transfer(Task task) {
        synchronized(lock(task.file)) {
            HttpURLConnection connection = null;
            try {
                if (!live(task)) return;
                File parent = task.file.getParentFile();
                if (!parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot create private download directory");
                if (task.skip && task.file.exists()) throw new IOException("Destination already exists");
                File part = new File(task.file.getPath() + ".part");
                File manifest = new File(task.file.getPath() + ".resume");
                Properties saved = new Properties();
                if (part.isFile() && manifest.isFile()) try(InputStream input = new FileInputStream(manifest)) { saved.load(input); }
                String validator = saved.getProperty("validator", "");
                long offset = part.isFile() && !validator.isEmpty() ? part.length() : 0;
                long savedTotal = parseLong(saved.getProperty("total"), -1);
                // ETags are scoped to a resource. Equal ETags from a different
                // URL do not establish byte identity (including signed queries).
                if (offset >= savedTotal || savedTotal < 1 || !task.id.equals(saved.getProperty("id")) || !task.url.toExternalForm().equals(saved.getProperty("url")) || saved.getProperty("responseUrl", "").isEmpty()) offset = 0;
                connection = (HttpURLConnection)task.url.openConnection(task.proxy);
                task.connection = connection;
                connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("Accept-Encoding", "identity");
                if (offset > 0) { connection.setRequestProperty("Range", "bytes=" + offset + "-"); connection.setRequestProperty("If-Range", validator); }
                int status = connection.getResponseCode();
                if (!live(task)) return;
                if (status == 401 || status == 403 || status == 410) { emit(task, "refreshUrl", null); return; }
                if (status != 200 && status != 206) throw new IOException("HTTP " + status);
                String encoding = connection.getHeaderField("Content-Encoding");
                if (encoding != null && !encoding.equalsIgnoreCase("identity")) throw new IOException("Encoded response cannot be resumed safely");
                long length = parseLong(connection.getHeaderField("Content-Length"), -1);
                if (length < 1) throw new IOException("A positive Content-Length is required to verify download completeness");
                long total = length;
                String responseUrl = connection.getURL().toExternalForm();
                String currentValidator = connection.getHeaderField("ETag");
                if (currentValidator == null || currentValidator.startsWith("W/")) currentValidator = connection.getHeaderField("Last-Modified");
                if (status == 206) {
                    // Redirect destinations are resource identities too: equal
                    // validators at distinct targets cannot authorize append.
                    if (offset > 0 && !responseUrl.equals(saved.getProperty("responseUrl"))) throw new IOException("Resume redirect target changed");
                    Matcher match = RANGE.matcher(Objects.toString(connection.getHeaderField("Content-Range"), ""));
                    if (!match.matches()) throw new IOException("Invalid Content-Range");
                    long begin = Long.parseLong(match.group(1)), end = Long.parseLong(match.group(2));
                    total = Long.parseLong(match.group(3));
                    if (begin != offset || end < begin || end != total - 1 || end - begin + 1 != length || (offset > 0 && (savedTotal != total || !validator.equals(currentValidator)))) throw new IOException("Resume validation failed");
                } else offset = 0; // Server ignored Range/If-Range: replace the partial body.
                Properties resume = new Properties();
                resume.setProperty("total", Long.toString(total));
                resume.setProperty("validator", currentValidator == null ? "" : currentValidator);
                resume.setProperty("id", task.id);
                resume.setProperty("url", task.url.toExternalForm());
                resume.setProperty("responseUrl", responseUrl);
                atomicProperties(manifest, resume);
                emit(task, "start", null);
                long downloaded = offset, start = System.nanoTime(), initial = offset, lastEmit = 0;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(part, offset > 0)) {
                    byte[] buffer = new byte[32768]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (!live(task)) return;
                        if (downloaded > total - count) throw new IOException("Response body exceeds declared length");
                        output.write(buffer, 0, count); downloaded += count;
                        long now = System.nanoTime();
                        if (now - lastEmit > TimeUnit.MILLISECONDS.toNanos(200) || downloaded == total) {
                            double seconds = Math.max((now-start)/1e9, 0.001);
                            emit(task, "progress", json("downloaded", downloaded, "total", total, "progress", 100.0 * downloaded / total, "speed", String.format(Locale.ROOT, "%.1f KiB/s", (downloaded-initial)/seconds/1024), "writeQueue", 0));
                            lastEmit = now;
                        }
                    }
                    if (downloaded != total) throw new EOFException("Truncated response: " + downloaded + "/" + total);
                    output.flush(); output.getFD().sync();
                }
                synchronized(gate) {
                    if (!live(task)) return;
                    move(part, task.file);
                    if (manifest.exists() && !manifest.delete()) throw new IOException("Cannot remove resume manifest");
                    emit(task, "complete", null);
                }
            } catch(Exception error) {
                try { emit(task, "error", json("error", "download_status_error_response", "message", error.getMessage() == null ? error.toString() : error.getMessage())); }
                catch(Exception reportError) { reportError.printStackTrace(); }
            } finally {
                if (connection != null) connection.disconnect();
                task.connection = null;
            }
        }
    }
    private static long parseLong(String text, long fallback) { try {return Long.parseLong(text);} catch(Exception ignored) {return fallback;} }
    private static void move(File from, File to) throws Exception { Os.rename(from.getPath(), to.getPath()); }
    private static void atomicProperties(File file, Properties properties) throws Exception {
        File temp = new File(file.getPath()+".part");
        try(FileOutputStream stream = new FileOutputStream(temp)) { properties.store(stream, "Rain Music resumable HTTP"); stream.getFD().sync(); }
        move(temp,file);
    }
    private void saveLyric(JSONObject params) throws Exception {
        File file = safeFile(string(params, "filePath"));
        String format = string(params, "format");
        Charset charset;
        if (format.equals("utf8")) charset = StandardCharsets.UTF_8;
        else if (format.equals("gbk")) charset = Charset.forName("GBK");
        else throw new UnsupportedOperationException("Unsupported lyric encoding: " + format);
        String text = string(params, "text");
        if (!charset.newEncoder().canEncode(text)) throw new IOException("Lyric contains characters not representable in " + format);
        synchronized(lock(file)) {
            File temp = new File(file.getPath()+".part");
            try(FileOutputStream output = new FileOutputStream(temp)) {
                if (format.equals("utf8")) output.write(new byte[]{(byte)0xef,(byte)0xbb,(byte)0xbf});
                output.write(text.getBytes(charset)); output.getFD().sync();
            }
            move(temp,file);
        }
    }
    private void writeMeta(JSONObject params) throws Exception {
        File file = safeFile(string(params, "filePath"));
        if (!file.getName().toLowerCase(Locale.ROOT).endsWith(".mp3")) throw new UnsupportedOperationException("Android metadata currently supports MP3 ID3v2.3 only");
        synchronized(lock(file)) {
            if (!file.isFile()) throw new FileNotFoundException(file.getPath());
            ByteArrayOutputStream frames = new ByteArrayOutputStream();
            frame(frames,"TIT2",textFrame(params.opt("title")));
            frame(frames,"TPE1",textFrame(params.opt("artist")));
            frame(frames,"TALB",textFrame(params.opt("album")));
            Object lyric = params.opt("lyrics");
            if (lyric instanceof String && !((String)lyric).isEmpty()) {
                ByteArrayOutputStream content=new ByteArrayOutputStream();content.write(new byte[]{1,'e','n','g',0,0});content.write(((String)lyric).getBytes(StandardCharsets.UTF_16));frame(frames,"USLT",content.toByteArray());
            }
            Object picture=params.opt("APIC");
            if (picture != null && picture != JSONObject.NULL && !"".equals(picture)) {
                if (!(picture instanceof String)) throw new IllegalArgumentException("APIC must be an HTTP(S) URL");
                byte[] image=cover(url((String)picture),proxy(params));
                String mime=image.length>=8 && image[0]==(byte)0x89 && image[1]=='P' && image[2]=='N' && image[3]=='G'?"image/png":image.length>=3 && image[0]==(byte)0xff && image[1]==(byte)0xd8 && image[2]==(byte)0xff?"image/jpeg":null;
                if(mime==null) throw new IOException("Cover must be a PNG or JPEG image");
                ByteArrayOutputStream content=new ByteArrayOutputStream();content.write(0);content.write(mime.getBytes(StandardCharsets.ISO_8859_1));content.write(new byte[]{0,3,0});content.write(image);frame(frames,"APIC",content.toByteArray());
            }
            byte[] tag=frames.toByteArray();
            if(tag.length>0x0fffffff)throw new IOException("ID3 tag too large");
            File temp=new File(file.getPath()+".meta.part");
            try(RandomAccessFile input=new RandomAccessFile(file,"r"); FileOutputStream output=new FileOutputStream(temp)) {
                long skip=0;
                if(input.length()>=10) {
                    byte[] header=new byte[10];input.readFully(header);
                    if(header[0]=='I'&&header[1]=='D'&&header[2]=='3') {
                        if(header[3]<2||header[3]>4)throw new IOException("Unsupported existing ID3 version");
                        int size=0;for(int i=6;i<10;i++){if((header[i]&0x80)!=0)throw new IOException("Invalid ID3 header");size=(size<<7)|(header[i]&0x7f);}
                        skip=10L+size+(header[3]==4&&(header[5]&0x10)!=0?10:0);
                        if(skip>input.length())throw new IOException("Truncated existing ID3 tag");
                    }
                }
                input.seek(skip);
                output.write(new byte[]{'I','D','3',3,0,0,(byte)((tag.length>>21)&127),(byte)((tag.length>>14)&127),(byte)((tag.length>>7)&127),(byte)(tag.length&127)});output.write(tag);
                byte[] buffer=new byte[32768];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);output.getFD().sync();
            } catch(Exception error) { if(temp.exists())temp.delete();throw error; }
            move(temp,file);
        }
    }
    private static byte[] textFrame(Object text) throws Exception {
        if(text==null||text==JSONObject.NULL)return new byte[0];
        if(!(text instanceof String))throw new IllegalArgumentException("Metadata text must be a string");
        ByteArrayOutputStream output=new ByteArrayOutputStream();output.write(1);output.write(((String)text).getBytes(StandardCharsets.UTF_16));return output.toByteArray();
    }
    private static void frame(OutputStream output,String name,byte[] content) throws Exception {
        if(content.length==0)return;
        output.write(name.getBytes(StandardCharsets.ISO_8859_1));int size=content.length;output.write(new byte[]{(byte)(size>>24),(byte)(size>>16),(byte)(size>>8),(byte)size,0,0});output.write(content);
    }
    private static byte[] cover(URL url,Proxy proxy) throws Exception {
        HttpURLConnection connection=(HttpURLConnection)url.openConnection(proxy);
        connection.setConnectTimeout(3000);connection.setReadTimeout(3000);
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(8);
        try {
            int status=connection.getResponseCode();if(status!=200)throw new IOException("Cover HTTP "+status);
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()) {
                byte[] buffer=new byte[8192];int count;
                while((count=input.read(buffer))!=-1){if(output.size()+count>8*1024*1024||System.nanoTime()>deadline)throw new IOException("Cover exceeds size/time limit");output.write(buffer,0,count);}return output.toByteArray();
            }
        } finally {connection.disconnect();}
    }
    private static final class Task {
        final String id,token;final URL url;final File file;final Proxy proxy;final boolean skip;final RainMusicIpcHandlers.RequestContext ctx;
        volatile boolean cancelled;volatile HttpURLConnection connection;
        Task(String id,String token,URL url,File file,Proxy proxy,boolean skip,RainMusicIpcHandlers.RequestContext ctx){this.id=id;this.token=token;this.url=url;this.file=file;this.proxy=proxy;this.skip=skip;this.ctx=ctx;}
        void stop(){cancelled=true;HttpURLConnection current=connection;if(current!=null)current.disconnect();}
    }
}
