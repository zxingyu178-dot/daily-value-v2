package com.dailyvalue.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Daily Value v2 - 文件桥（2.14.0）
 *
 * 使用 Android SAF（Storage Access Framework）：
 * - saveFile：ACTION_CREATE_DOCUMENT → 系统「保存文件」界面，用户选择位置，App 拿到可写 URI 写入。
 *   数据以 UTF-8 base64 传入（备份 JSON / CSV 文本）。
 * - openFile：ACTION_OPEN_DOCUMENT → 系统文件选择器，读取后以 base64（UTF-8）返回。
 *
 * 官方 @capacitor/filesystem / share 不提供 SAF 保存界面；由本最小本地插件补齐
 *（用户必须有真实系统保存/选择界面，且文件存放在用户可控位置）。
 */
@CapacitorPlugin(name = "FileBridge")
public class FileBridgePlugin extends Plugin {

    private static final String TAG = "FileBridge";

    @PluginMethod
    public void saveFile(PluginCall call) {
        String fileName = call.getString("fileName", "DailyValue.dvbackup");
        String mimeType = call.getString("mimeType", "application/json");
        String data = call.getString("data", "");
        if (data.isEmpty()) {
            call.reject("data is required");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("invalid base64", e);
            return;
        }
        startActivityForResult(call, intent, "saveResult");
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "openResult");
    }

    /** ACTION_CREATE_DOCUMENT 结果回调：写入 base64 内容后 resolve */
    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        int resultCode = result.getResultCode();
        Intent resultData = result.getData();
        if (resultCode != Activity.RESULT_OK || resultData == null || resultData.getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri uri = resultData.getData();
        String fileName = call.getString("fileName", "DailyValue.dvbackup");
        String data = call.getString("data", "");
        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("invalid base64", e);
            return;
        }
        OutputStream os = null;
        try {
            os = getContext().getContentResolver().openOutputStream(uri);
            if (os == null) {
                call.reject("cannot open output stream");
                return;
            }
            os.write(bytes);
            os.flush();
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("fileName", fileName);
            call.resolve(ret);
        } catch (Exception e) {
            Log.w(TAG, "saveFile failed", e);
            call.reject("write failed", e);
        } finally {
            if (os != null) {
                try { os.close(); } catch (Exception ignored) { }
            }
        }
    }

    /** ACTION_OPEN_DOCUMENT 结果回调：读取文件为 base64 后 resolve */
    @ActivityCallback
    private void openResult(PluginCall call, ActivityResult result) {
        int resultCode = result.getResultCode();
        Intent resultData = result.getData();
        if (resultCode != Activity.RESULT_OK || resultData == null || resultData.getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri uri = resultData.getData();
        String name = queryDisplayName(uri);
        InputStream is = null;
        try {
            is = getContext().getContentResolver().openInputStream(uri);
            if (is == null) {
                call.reject("cannot open input stream");
                return;
            }
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = is.read(chunk)) != -1) {
                buffer.write(chunk, 0, n);
            }
            JSObject ret = new JSObject();
            ret.put("name", name != null ? name : "file");
            ret.put("data", Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception e) {
            Log.w(TAG, "openFile failed", e);
            call.reject("read failed", e);
        } finally {
            if (is != null) {
                try { is.close(); } catch (Exception ignored) { }
            }
        }
    }

    /** 从 content URI 查询显示文件名（OpenableColumns.DISPLAY_NAME） */
    private String queryDisplayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    return c.getString(idx);
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }
}