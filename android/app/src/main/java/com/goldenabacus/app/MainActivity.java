package com.goldenabacus.app;

import android.content.Intent;
import android.os.Bundle;
import androidx.core.content.IntentCompat;
import com.getcapacitor.BridgeActivity;

/** Capacitor 原生宿主；外部分享页单独入栈，避免微信页面占用金算盘任务。 */
public class MainActivity extends BridgeActivity {

    /** 仅调整分享目标，分享面板本身继续留在当前任务以保留取消结果。 */
    static void separateShareTask(Intent intent) {
        if (!Intent.ACTION_CHOOSER.equals(intent.getAction())) return;
        // 兼容最低 Android 版本读取嵌套 Intent，文件选择等其他面板保持原行为。
        Intent target = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent.class);
        if (target != null && (Intent.ACTION_SEND.equals(target.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(target.getAction()))) {
            // 追加任务标志，保留 FileProvider 的临时读取授权和全部分享内容。
            target.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
    }

    /** Capacitor 的 Activity Result 启动器最终经此入口打开原生分享面板。 */
    @Override
    public void startActivityForResult(Intent intent, int requestCode, Bundle options) {
        separateShareTask(intent);
        super.startActivityForResult(intent, requestCode, options);
    }
}
