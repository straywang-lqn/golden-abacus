package com.goldenabacus.app;

import static org.junit.Assert.*;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.IntentCompat;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.ArrayList;
import java.util.Arrays;
import org.junit.Test;
import org.junit.runner.RunWith;

/** 验证分享任务隔离不破坏文件授权、系统回调和文件选择流程。 */
@RunWith(AndroidJUnit4.class)
public class ShareTaskTest {

    /** 单文件接收方独立入栈；面板自身不能带新任务标志以免过早收到取消结果。 */
    @Test
    public void singleFileKeepsPermissionsAndChooserTask() {
        // 使用虚拟 content URI，仅检查 Intent，不向外部应用发送任何账目。
        Uri uri = Uri.parse("content://com.goldenabacus.app.fileprovider/backup.json");
        Intent target = new Intent(Intent.ACTION_SEND)
            .setType("application/json")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        target.setClipData(ClipData.newRawUri("backup", uri));
        Intent chooser = Intent.createChooser(target, "导出金算盘备份");

        MainActivity.separateShareTask(chooser);

        assertEquals(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION, target.getFlags());
        assertEquals("application/json", target.getType());
        assertEquals(uri, IntentCompat.getParcelableExtra(target, Intent.EXTRA_STREAM, Uri.class));
        assertEquals(uri, target.getClipData().getItemAt(0).getUri());
        assertEquals(0, chooser.getFlags() & Intent.FLAG_ACTIVITY_NEW_TASK);
        assertTrue((chooser.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0);
    }

    /** 多文件分享使用相同隔离规则，已有标志及 URI 列表不能被覆盖。 */
    @Test
    public void multipleFilesKeepExistingFlagsAndContents() {
        // 多文件与单文件共享入口，覆盖 ACTION_SEND_MULTIPLE 分支。
        ArrayList<Uri> uris = new ArrayList<>(Arrays.asList(Uri.parse("content://backup/one"), Uri.parse("content://backup/two")));
        Intent target = new Intent(Intent.ACTION_SEND_MULTIPLE)
            .putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        Intent chooser = Intent.createChooser(target, null);

        MainActivity.separateShareTask(chooser);

        assertEquals(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NO_ANIMATION, target.getFlags());
        assertEquals(uris, IntentCompat.getParcelableArrayListExtra(target, Intent.EXTRA_STREAM, Uri.class));
        assertEquals(0, chooser.getFlags() & Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    /** 导入文件等非分享请求，以及没有嵌套目标的面板，都不能改变返回行为。 */
    @Test
    public void nonShareRequestsStayUnchanged() {
        // 同时覆盖非面板请求、文件选择面板和空面板，避免影响 WebView 导入。
        Intent open = new Intent(Intent.ACTION_OPEN_DOCUMENT).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(open, null);
        Intent emptyChooser = new Intent(Intent.ACTION_CHOOSER);
        MainActivity.separateShareTask(open);
        MainActivity.separateShareTask(chooser);
        MainActivity.separateShareTask(emptyChooser);

        assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION, open.getFlags());
        assertEquals(0, chooser.getFlags() & Intent.FLAG_ACTIVITY_NEW_TASK);
        assertEquals(0, emptyChooser.getFlags());
    }
}
