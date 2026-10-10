package com.rainmusic.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.rainmusic.mobile.ipc.RainMusicIpcPlugin;

/**
 * Android 主 Activity（Capacitor 桥宿主）。
 *
 * <p>唯一的本地改动：注册渲染层 IPC 的原生传输桥 {@link RainMusicIpcPlugin}
 * （Android 移植 · P0-1，JS 侧对应 {@code src/common/platform/ipcBridge/capacitor.js}）。
 *
 * <p>⚠️ {@code registerPlugin(...)} **必须**在 {@code super.onCreate()} **之前**调用。
 * 原因（本机读到的 {@code @capacitor/android@8.5.2} 源码）：
 * {@code BridgeActivity.onCreate()} 第一步就是 {@code super.onCreate()}，随后在
 * {@code :34-42} 读 {@code capacitor.plugins.json} 并调用 {@code this.load()}，
 * 而 {@code load()}（{@code :45-48}）会执行
 * {@code bridgeBuilder.addPlugins(initialPlugins).setConfig(config).create()} ——
 * 那一刻插件集合就已经定下来了。{@code registerPlugin()} 只是
 * {@code bridgeBuilder.addPlugin(...)}（{@code :54-56}），放在 {@code super.onCreate()} 之后
 * 添加的插件不会出现在已创建的 Bridge 里（页面上就是"插件不存在"，JS 侧报
 * {@code IPC_BRIDGE_UNAVAILABLE}）。
 *
 * <p>这样做**不需要**改 {@code app/build.gradle}：本插件只用到
 * {@code :capacitor-android}（{@code com.getcapacitor.*}）、Android 框架自带的
 * {@code org.json} 与 JDK 的 {@code java.util.concurrent}，没有任何新增依赖，
 * 也没有引入 Kotlin（生成工程是纯 Java 模块）。
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 见类注释：必须在 super.onCreate() 之前。
        registerPlugin(RainMusicIpcPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
