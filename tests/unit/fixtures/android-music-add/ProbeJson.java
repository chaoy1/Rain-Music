package org.json;

import java.util.List;
import java.util.Map;

/** Test-only conversion of the existing parser's Map/List nodes to API-shaped values. */
public final class ProbeJson {
    private ProbeJson() {}
    public static JSONObject parse(String text) throws JSONException {
        JSONObject parsed = new JSONObject(text), result = new JSONObject();
        for (String key : parsed.jsonKeySet()) result.put(key, wrap(parsed.opt(key)));
        return result;
    }
    private static Object wrap(Object value) throws JSONException {
        if (value instanceof Map) {
            JSONObject result = new JSONObject();
            for (Object entryObject : ((Map<?, ?>) value).entrySet()) {
                Map.Entry<?, ?> entry = (Map.Entry<?, ?>) entryObject;
                result.put(String.valueOf(entry.getKey()), wrap(entry.getValue()));
            }
            return result;
        }
        if (value instanceof List) {
            JSONArray result = new JSONArray();
            for (Object item : (List<?>) value) result.put(wrap(item));
            return result;
        }
        return value;
    }
}
