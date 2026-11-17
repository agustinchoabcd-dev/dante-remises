package __PACKAGE__;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class DanteTripActionReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : intent.getStringExtra("danteTripAction");
        String tripId = intent == null ? "" : intent.getStringExtra("danteTripId");
        if (tripId == null || tripId.isEmpty() ||
            !("accept".equals(action) || "view".equals(action) || "reject".equals(action))) return;

        context.getSharedPreferences("dante_trip_alerts", 0).edit()
            .putString("pending_action", action)
            .putString("pending_trip_id", tripId)
            .apply();
        context.stopService(new Intent(context, DanteTripAlertService.class));
        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        context.startActivity(open);
    }
}
