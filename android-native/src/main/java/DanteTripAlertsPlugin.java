package __PACKAGE__;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DanteTripAlerts")
public class DanteTripAlertsPlugin extends Plugin {
    private static final String PREFS = "dante_trip_alerts";

    @PluginMethod public void getToken(PluginCall call) {
        if (!DanteFirebaseOptions.isConfigured() || FirebaseApp.getApps(getContext()).isEmpty()) {
            call.reject("Falta registrar la aplicación Android de Dante Remises en Firebase y configurar google-services.json.");
            return;
        }
        try {
            FirebaseMessaging.getInstance().getToken()
                .addOnSuccessListener(token -> {
                    JSObject result = new JSObject();
                    result.put("token", token);
                    call.resolve(result);
                })
                .addOnFailureListener(error -> call.reject("No se pudo obtener el token FCM.", error));
        } catch (Exception error) {
            call.reject("Firebase Cloud Messaging no está inicializado.", error);
        }
    }

    @PluginMethod public void canPostNotifications(PluginCall call) {
        boolean granted = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            granted = granted && ContextCompat.checkSelfPermission(
                getContext(), android.Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED;
        }
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            android.app.NotificationManager manager =
                (android.app.NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            android.app.NotificationChannel channel = manager.getNotificationChannel("trip_requests");
            granted = granted && (channel == null || channel.getImportance() != android.app.NotificationManager.IMPORTANCE_NONE);
        }
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod public void openNotificationSettings(PluginCall call) {
        Intent intent = new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        intent.putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        startActivityForResult(call, intent, "notificationSettingsResult");
    }

    @ActivityCallback private void notificationSettingsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject value = new JSObject();
        boolean granted = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            granted = granted && ContextCompat.checkSelfPermission(
                getContext(), android.Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED;
        }
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            android.app.NotificationManager manager =
                (android.app.NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            android.app.NotificationChannel channel = manager.getNotificationChannel("trip_requests");
            granted = granted && (channel == null || channel.getImportance() != android.app.NotificationManager.IMPORTANCE_NONE);
        }
        value.put("opened", true);
        value.put("granted", granted);
        call.resolve(value);
    }

    @PluginMethod public void canDrawOverlays(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", Settings.canDrawOverlays(getContext()));
        call.resolve(result);
    }

    @PluginMethod public void requestOverlayPermission(PluginCall call) {
        if (Settings.canDrawOverlays(getContext())) {
            JSObject result = new JSObject();
            result.put("opened", false);
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, intent, "overlayPermissionResult");
    }

    @ActivityCallback private void overlayPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject value = new JSObject();
        value.put("opened", true);
        value.put("granted", Settings.canDrawOverlays(getContext()));
        call.resolve(value);
    }

    @PluginMethod public void getPendingTripAction(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        JSObject result = new JSObject();
        result.put("action", prefs.getString("pending_action", ""));
        result.put("tripId", prefs.getString("pending_trip_id", ""));
        call.resolve(result);
    }

    @PluginMethod public void clearPendingTripAction(PluginCall call) {
        getContext().getSharedPreferences(PREFS, 0).edit()
            .remove("pending_action").remove("pending_trip_id").apply();
        call.resolve();
    }

    @PluginMethod public void stopAlert(PluginCall call) {
        getContext().stopService(new Intent(getContext(), DanteTripAlertService.class));
        call.resolve();
    }
}
