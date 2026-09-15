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
        try {
            IntentFilter filter = new IntentFilter(
                    AutoBillNotificationListenerService.ACTION_PENDING_CHANGED);
            getContext().registerReceiver(pendingChangedReceiver, filter);
        } catch (Exception ignored) {
            // 注册失败：Web 仍可通过 resume/拉取兜底
        }
    }

    private void unregisterPendingReceiver() {
        try {
            getContext().unregisterReceiver(pendingChangedReceiver);
        } catch (Exception ignored) {
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
        call.resolve(ret);
    }

    @PluginMethod
    public void openAccessSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            // OEM 不支持该页面 → 回退系统设置
            try {
                Intent intent = new Intent(Settings.ACTION_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e2) {
                call.reject("cannot open notification access settings", e2);
            }
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
                o.put("packageName", r.packageName);
                o.put("postTime", r.postTime);
                o.put("capturedAt", r.capturedAt);
                o.put("title", r.title);
                o.put("text", r.text);
                o.put("bigText", r.bigText);
                o.put("subText", r.subText);
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
        AutoBillNativeStore.setEnabledPackages(list);
        call.resolve();
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