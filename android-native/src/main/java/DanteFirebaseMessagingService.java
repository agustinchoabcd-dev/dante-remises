package __PACKAGE__;
import android.content.Intent;
import android.os.Build;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class DanteFirebaseMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) {
        super.onNewToken(token);
        getSharedPreferences("dante_trip_alerts", 0).edit().putString("fcm_token", token).apply();
    }

    @Override public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        if (message == null || !"trip_request".equals(message.getData().get("type"))) return;
        if (message.getPriority() != RemoteMessage.PRIORITY_HIGH) {
            DanteTripAlertService.showFallbackNotification(this, message.getData());
            return;
        }
        Intent intent = new Intent(this, DanteTripAlertService.class);
        intent.setAction(DanteTripAlertService.ACTION_SHOW);
        for (java.util.Map.Entry<String, String> entry : message.getData().entrySet()) {
            intent.putExtra(entry.getKey(), entry.getValue());
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent);
            else startService(intent);
        } catch (Exception error) {
            DanteTripAlertService.showFallbackNotification(this, message.getData());
        }
    }
}
