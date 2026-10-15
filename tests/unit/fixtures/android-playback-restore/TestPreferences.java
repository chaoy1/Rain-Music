package com.rainmusic.mobile.ipc;
import android.content.SharedPreferences;
public final class TestPreferences implements SharedPreferences {
    public String memory,durable;
    public boolean failCommit;
    public int writes;
    public boolean listLocked,storeLocked;
    public String getString(String key,String fallback){return memory==null?fallback:memory;}
    public Editor edit(){return new Editor(){
      String next;
      public Editor putString(String key,String value){next=value;return this;}
      public boolean commit(){writes++; listLocked=Thread.holdsLock(RainMusicListWriteLock.LOCK);storeLocked=Thread.holdsLock(RainMusicStoreLock.WRITE_LOCK); memory=next;if(failCommit)return false;durable=next;return true;}
    };}
}
