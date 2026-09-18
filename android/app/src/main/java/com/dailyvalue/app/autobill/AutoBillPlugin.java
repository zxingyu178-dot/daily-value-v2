package com.dailyvalue.app.autobill;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/**
 * Daily Value - AutoBill Capacitor Plugin（2.15.1 Gate B；2.16.2 增加 pendingChanged 事件）
 *
 * Web 层与原生通知链路之间的唯一桥：
 * - getAccessStatus：真实验证「通知使用权」（Notification Access）授予状态 + 监听连接状态
 * - openAccessSettings：进入系统「通知使用权」页面（不是普通 App 通知页面）
 * - getPendingNotifications / acknowledgeNotifications：Native Pending Queue 拉取与 ack
 * - setEnabledPackages：Web Settings 同步来源白名单（原生第一行防线）
 * - requestRebind：已授权但连接异常时请求系统重绑 Listener
 * - pendingChanged 事件：Service upsert 后私有广播 → notifyListeners（仅计数，不传文本；
 *   真实内容仍由 Web 主动 getPendingNotifications 拉取）
 */
@CapacitorPlugin(name = "AutoBill")
public class AutoBillPlugin extends Plugin {

    private static final String TAG = "AutoBill";

    /** 2.16.2：App 内部私有广播 → Capacitor 事件（Web 实时同步，不做轮询） */
    private final BroadcastReceiver pendingChangedReceiver =
            new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    JSObject payload = new JSObject();
                    try {
                        payload.put("pendingCount", AutoBillNativeStore.queue().count());
                    } catch (Exception ignored) {
                        payload.put("pendingCount", 0);
                    }
                    // 只传计数，绝不把支付通知文本随事件下发
                    notifyListeners("pendingChanged", payload);
                }
            };

    @Override
    protected void handleOnStart() {
        super.handleOnStart();
        registerPendingReceiver();
    }

    @Override
    protected void handleOnStop() {
        super.handleOnStop();
        unregisterPendingReceiver();
    }

    private void registerPendingReceiver() {
        IntentFilter filter = new IntentFilter(
                AutoBillNotificationListenerService.ACTION_PENDING_CHANGED);
        try {
            // 2.16.6：动态注册必须显式声明导出范围（targetSdk 36 / Android 13+ 强制）。
            // 本广播仅 App 内部私有（Service setPackage 发送），用 RECEIVER_NOT_EXPORTED
            // 拒绝其它应用伪造；RECEIVER_NOT_EXPORTED 为 API 26+，低版本走 2 参旧签名。
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                getContext().registerReceiver(
                        pendingChangedReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                getContext().registerReceiver(pendingChangedReceiver, filter);
            }
        } catch (Exception e) {
            // 注册失败不阻断 Web 实时同步兜底（resume/拉取）；日志只记录注册失败本身，绝不打印支付内容
            android.util.Log.e(TAG, "pending receiver register failed", e);
        }
    }

    private void unregisterPendingReceiver() {
        try {
            getContext().unregisterReceiver(pendingChangedReceiver);
        } catch (Exception e) {
            android.util.Log.e(TAG, "pending receiver unregister failed", e);
        }
    }

    @PluginMethod
    public void getAccessStatus(PluginCall call) {
        AutoBillNativeStore.init(getContext());
        JSObject ret = new JSObject();
        ret.put("granted", isNotificationAccessGranted(getContext()));
        ret.put("connected", AutoBillNativeStore.isConnected());
        ret.put("pendingCount", AutoBillNativeStore.queue().count());
        ret.put("lastConnectedAt", AutoBillNativeStore.lastConnectedAt());
        // 2.21.0：后台识别候选数量 + 识别完成提醒开关 + 通知权限状态
        ret.put("candidateCount", AutoBillNativeStore.candidateQueue().count());
        ret.put("recognitionNoticeEnabled", AutoBillNativeStore.recognitionNoticeEnabled());
        ret.put("canPostNotifications", AutoBillRecognitionNotifier.canPostNotifications(getContext()));
        call.resolve(ret);
    }

    /* =====================================================================
     * 2.21.0 后台识别候选：Web 打开后导入 Native Candidate（幂等，按 notificationKey）
     * ===================================================================== */

    @PluginMethod
    public void getPendingCandidates(PluginCall call) {
        AutoBillNativeStore.init(getContext());
        JSObject ret = new JSObject();
        try {
            JSArray arr = new JSArray();
            for (com.dailyvalue.app.autobill.background.NativeParsedCandidate c
                    : AutoBillNativeStore.candidateQueue().pending()) {
                JSObject o = new JSObject();
                o.put("id", c.id);
                o.put("source", c.source);
                o.put("sourcePackage", c.sourcePackage);
                o.put("notificationKey", c.notificationKey);
                o.put("amount", c.amount);
                o.put("type", c.type);
                o.put("merchant", c.merchant);
                o.put("confidence", c.confidence);
                o.put("postTime", c.postTime);
                o.put("capturedAt", c.capturedAt);
                o.put("rawTextHash", c.rawTextHash);
                arr.put(o);
            }
            ret.put("candidates", arr);
        } catch (Exception ignored) {
            ret.put("candidates", new JSArray());
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void acknowledgeCandidates(PluginCall call) {
        AutoBillNativeStore.init(getContext());
        java.util.List<String> list = new ArrayList<>();
        JSArray ids = call.getArray("ids");
        if (ids != null) {
            try {
                for (Object id : ids.toList()) {
                    if (id != null) list.add(String.valueOf(id));
                }
            } catch (Exception ignored) {
            }
        }
        int removed = AutoBillNativeStore.candidateQueue().ack(list);
        JSObject ret = new JSObject();
        ret.put("removed", removed);
        call.resolve(ret);
    }

    @PluginMethod
    public void setRecognitionNoticeEnabled(PluginCall call) {
        AutoBillNativeStore.init(getContext());
        Boolean enabled = call.getBoolean("enabled");
        AutoBillNativeStore.setRecognitionNoticeEnabled(enabled == null || enabled);
        call.resolve();
    }

    /** 后台提醒通知点击后置位的「进入自动记账审核」标志：读取并消费（一次性） */
    @PluginMethod
    public void consumeOpenAutoBillFlag(PluginCall call) {
        AutoBillNativeStore.init(getContext());
        boolean flag = AutoBillNativeStore.consumeOpenAutoBillFlag();
        JSObject ret = new JSObject();
        ret.put("open", flag);
        call.resolve(ret);
    }

    @PluginMethod
    public void openAccessSettings(PluginCall call) {
        // 2.16.7：停止使用「通知监听详情页」Intent（部分 OEM 详情 Activity 启动后内部崩溃，
        // startActivity 无法捕获，导致真机闪退）。正式稳定两级入口：
        //  1) 系统「通知使用权」列表（用户在列表中为「每日的价值」自行开启/关闭）
        //  2) 系统设置（仅列表页无法启动时兜底）
        // 无论走哪一级，都优先以「当前 Activity」叠开（OEM 上避免 Context+NEW_TASK 无法 bring-forward）。
        if (tryStartActivity(listSettingsIntent())) {
            call.resolve();
            return;
        }
        if (tryStartActivity(plainSettingsIntent())) {
            call.resolve();
            return;
        }
        // 两级都失败：明确 reject，Web 层 toast 提示且页面保持不变（绝不闪退/跳页）
        android.util.Log.e(TAG, "Cannot open notification access settings (list & settings both failed)");
        call.reject("cannot open notification access settings");
    }

    private Intent listSettingsIntent() {
        return new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
    }

    private Intent plainSettingsIntent() {
        return new Intent(Settings.ACTION_SETTINGS);
    }

    /** 优先 Activity 叠开；无 Activity 时回退 Context + NEW_TASK（仅作为最终手段，不作为唯一方案） */
    private boolean tryStartActivity(Intent intent) {
        if (intent == null) return false;
        try {
            android.app.Activity activity = getActivity();
            if (activity != null) {
                activity.startActivity(intent);
                return true;
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (Exception e) {
            // 只记录跳转失败本身，绝不打印支付内容
            android.util.Log.e(TAG, "Cannot open settings", e);
            return false;
        }
    }

    @PluginMethod
    public void getPendingNotifications(PluginCall call) {
        AutoBillNativeStore.init(getContext());
        JSObject ret = new JSObject();
        try {
            JSArray arr = new JSArray();
            for (AutoBillNativeRecord r : AutoBillNativeStore.queue().pending()) {
                JSObject o = new JSObject();
                o.put("id", r.id);
                o.put("notificationKey", r.notificationKey); // 2.17.2：贯通到 Web（去重第一优先级）
                o.put("packageName", r.packageName);
                o.put("postTime", r.postTime);
                o.put("capturedAt", r.capturedAt);
                o.put("title", r.title);
                o.put("text", r.text);
                o.put("bigText", r.bigText);
                o.put("subText", r.subText);
                o.put("channelId", r.channelId);
                arr.put(o);
            }
            ret.put("records", arr);
        } catch (Exception ignored) {
            ret.put("records", new JSArray());
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void acknowledgeNotifications(PluginCall call) {
        AutoBillNativeStore.init(getContext());
        List<String> list = new ArrayList<>();
        JSArray ids = call.getArray("ids");
        if (ids != null) {
            try {
                for (Object id : ids.toList()) {
                    if (id != null) list.add(String.valueOf(id));
                }
            } catch (Exception ignored) {
            }
        }
        int removed = AutoBillNativeStore.queue().ack(list);
        JSObject ret = new JSObject();
        ret.put("removed", removed);
        call.resolve(ret);
    }

    @PluginMethod
    public void setEnabledPackages(PluginCall call) {
        AutoBillNativeStore.init(getContext());
        List<String> list = new ArrayList<>();
        JSArray pkgs = call.getArray("packages");
        if (pkgs != null) {
            try {
                for (Object p : pkgs.toList()) {
                    if (p != null) list.add(String.valueOf(p));
                }
            } catch (Exception ignored) {
            }
        }
        // 2.17.2 P0：原子替换白名单 + 裁剪 Queue。
        // 关闭单个来源（如微信）时其旧记录立即从 Queue 移除；空集合 = 全部清除。
        // 只清 Native 暂存，已写入 IndexedDB 的 AutoBillCandidate 与已确认正式 Bill
        // 由 Web 层管理，这里不动。
        AutoBillNativeStore.setEnabledPackagesAndPrune(list);
        call.resolve();
    }

    /**
     * 2.17.0：查询候选来源包名安装状态。
     * Native 完全不理解业务来源（支付宝/微信/银行），只按 Web 传入的包名逐条查询；
     * 声明范围由 AndroidManifest <queries> 精确列举，不申请 QUERY_ALL_PACKAGES。
     */
    @PluginMethod
    public void getInstalledSources(PluginCall call) {
        try {
            JSArray pkgs = call.getArray("packages");
            JSArray results = new JSArray();
            if (pkgs != null) {
                android.content.pm.PackageManager pm = getContext().getPackageManager();
                try {
                    for (Object p : pkgs.toList()) {
                        if (p == null) continue;
                        String packageName = String.valueOf(p);
                        boolean installed;
                        try {
                            pm.getPackageInfo(packageName, 0);
                            installed = true;
                        } catch (android.content.pm.PackageManager.NameNotFoundException e) {
                            installed = false;
                        }
                        JSObject o = new JSObject();
                        o.put("packageName", packageName);
                        o.put("installed", installed);
                        results.put(o);
                    }
                } catch (Exception ignored) {
                }
            }
            JSObject ret = new JSObject();
            ret.put("results", results);
            call.resolve(ret);
        } catch (Exception e) {
            android.util.Log.e(TAG, "getInstalledSources failed", e);
            call.reject("cannot query installed sources", e);
        }
    }

    @PluginMethod
    public void requestRebind(PluginCall call) {
        AutoBillNativeStore.init(getContext());
        try {
            ComponentName component =
                    new ComponentName(getContext(), AutoBillNotificationListenerService.class);
            NotificationListenerService.requestRebind(component);
            call.resolve();
        } catch (Exception e) {
            call.reject("request rebind failed", e);
        }
    }

    /**
     * 通知使用权（Notification Access）真实判定：
     * 官方机制 enabled_notification_listeners 中包含本组件 → 已授权。
     * （区别于 POST_NOTIFICATIONS / 普通「允许通知」，二者不是自动记账权限。）
     */
    static boolean isNotificationAccessGranted(Context context) {
        try {
            String flat =
                    Settings.Secure.getString(
                            context.getContentResolver(), "enabled_notification_listeners");
            if (flat == null || flat.isEmpty()) return false;
            String component =
                    new ComponentName(context, AutoBillNotificationListenerService.class)
                            .flattenToString();
            for (String entry : flat.split(":")) {
                if (entry.equals(component)) return true;
            }
        } catch (Exception ignored) {
        }
        return false;
    }
}