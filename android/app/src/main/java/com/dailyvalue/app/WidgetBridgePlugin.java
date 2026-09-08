package com.dailyvalue.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    private static final String TAG = "WidgetBridge";
    private static final String PREFS_NAME = "daily_value_widget";
    private static final String KEY_SNAPSHOT = "snapshot";
    private static final String KEY_GENERATED_AT = "generatedAt";

    private SharedPreferences getWidgetPrefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void saveSnapshot(PluginCall call) {
        String snapshotJson = call.getString("snapshot", "");
        if (snapshotJson.isEmpty()) {
            call.reject("snapshot is required");
            return;
        }
        try {
            getWidgetPrefs().edit()
                    .putString(KEY_SNAPSHOT, snapshotJson)
                    .putLong(KEY_GENERATED_AT, System.currentTimeMillis())
                    .apply();
            refreshAllWidgets();
            JSObject ret = new JSObject();
            ret.put("saved", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to save snapshot", e);
        }
    }

    @PluginMethod
    public void refreshWidgets(PluginCall call) {
        try {
            refreshAllWidgets();
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to refresh widgets", e);
        }
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", true);
        call.resolve(ret);
    }

    private void refreshAllWidgets() {
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(getContext());
            ComponentName provider = new ComponentName(getContext(), DailyValueWidgetProvider.class);
            int[] ids = mgr.getAppWidgetIds(provider);
            if (ids.length > 0) {
                DailyValueWidgetProvider.updateWidgets(getContext(), mgr, ids);
            }
        } catch (Exception e) {
            Log.w(TAG, "refreshAllWidgets failed", e);
        }
    }

    static String getSnapshotJson(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_SNAPSHOT, null);
    }
}
