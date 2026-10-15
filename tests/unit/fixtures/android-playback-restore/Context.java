package android.content;
import com.rainmusic.mobile.ipc.TestPreferences;
public class Context {
    public static final int MODE_PRIVATE = 0;
    public final TestPreferences prefs = new TestPreferences();
    public Context getApplicationContext(){return this;}
    public SharedPreferences getSharedPreferences(String name,int mode){return prefs;}
}
