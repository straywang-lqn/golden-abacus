package com.goldenabacus.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/** Capacitor 的原生宿主；页面生命周期与 WebView 桥接由 BridgeActivity 提供。 */
public class MainActivity extends BridgeActivity {
    /** WebView 启动前注册设备专用的 AI 配置桥接。 */
    @Override
    public void onCreate(Bundle state) {
        registerPlugin(AiSecureStorage.class);
        super.onCreate(state);
    }
}
