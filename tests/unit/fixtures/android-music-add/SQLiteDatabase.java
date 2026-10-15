package android.database.sqlite;

import android.database.Cursor;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;

public final class SQLiteDatabase implements AutoCloseable {
    private final Process process;
    private final BufferedWriter input;
    private final BufferedReader output;
    private boolean successful;
    public int failAfter;
    public volatile int commits;
    public int rollbacks;
    public int musicReadDelay;
    public java.util.concurrent.CountDownLatch commitGate;
    public SQLiteDatabase(String node, String script, String schema) throws Exception {
        process = new ProcessBuilder(node, script, schema).redirectError(ProcessBuilder.Redirect.INHERIT).start();
        input = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
        output = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
    }
    private synchronized JSONObject call(String op, String sql, Object[] params) {
        try {
            JSONObject request = new JSONObject();
            request.put("op", op);
            if (sql != null) request.put("sql", sql);
            JSONArray args = new JSONArray();
            if (params != null) for (Object param : params) args.put(param == null ? JSONObject.NULL : param);
            request.put("params", args);
            input.write(request.toString()); input.newLine(); input.flush();
            String line = output.readLine();
            if (line == null) throw new IllegalStateException("SQLite bridge exited");
            JSONObject response = org.json.ProbeJson.parse(line);
            if (!Boolean.TRUE.equals(response.opt("ok"))) throw new IllegalStateException(String.valueOf(response.opt("error")));
            return response;
        } catch (Exception error) { throw new IllegalStateException(error); }
    }
    public void reset() { call("reset", null, null); failAfter = commits = rollbacks = 0; }
    public Cursor rawQuery(String sql, String[] params) {
        Cursor cursor = new Cursor(call("query", sql, params));
        if (musicReadDelay > 0 && sql.contains("LEFT JOIN")) {
            try { Thread.sleep(musicReadDelay); } catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IllegalStateException(error); }
        }
        return cursor;
    }
    public void execSQL(String sql, Object[] params) {
        if (failAfter > 0 && --failAfter == 0) throw new IllegalStateException("Injected SQL write failure");
        call("exec", sql, params);
    }
    public void beginTransaction() { call("BEGIN", null, null); successful = false; }
    public void setTransactionSuccessful() { successful = true; }
    public void endTransaction() {
        call(successful ? "COMMIT" : "ROLLBACK", null, null);
        if (successful) commits++; else rollbacks++;
        if (successful && commitGate != null) commitGate.countDown();
    }
    public void close() throws Exception { input.close(); process.waitFor(); output.close(); }
}
