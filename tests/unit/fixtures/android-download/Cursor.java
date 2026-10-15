package android.database;

import org.json.JSONArray;
import org.json.JSONObject;

/** SQLite query results; getters follow the Android Cursor API signatures. */
public final class Cursor {
    private final JSONArray columns;
    private final JSONArray rows;
    private int position = -1;
    public Cursor(JSONObject result) {
        columns = (JSONArray) result.opt("columns");
        rows = (JSONArray) result.opt("rows");
    }
    public boolean moveToNext() { return ++position < rows.length(); }
    public boolean moveToFirst() { position = 0; return rows.length() > 0; }
    public int getColumnIndexOrThrow(String name) {
        for (int i = 0; i < columns.length(); i++) {
            try { if (name.equals(columns.get(i))) return i; }
            catch (Exception error) { throw new IllegalStateException(error); }
        }
        throw new IllegalArgumentException("Missing column: " + name);
    }
    private Object value(int index) {
        try { return rows.getJSONObject(position).opt((String) columns.get(index)); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }
    public boolean isNull(int index) { Object value = value(index); return value == null || value == JSONObject.NULL; }
    public String getString(int index) { return isNull(index) ? null : String.valueOf(value(index)); }
    public long getLong(int index) { return ((Number) value(index)).longValue(); }
    public double getDouble(int index) { return ((Number) value(index)).doubleValue(); }
    public int getInt(int index) { return ((Number) value(index)).intValue(); }
    public void close() {}
}
