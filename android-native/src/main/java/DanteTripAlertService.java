package __PACKAGE__;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.app.NotificationCompat;
import java.util.Map;

public class DanteTripAlertService extends Service {
    public static final String ACTION_SHOW = "com.danteremises.TRIP_ALERT_SHOW";
    private static final String SERVICE_CHANNEL = "trip_alert_service";
    private static final String ALERT_CHANNEL = "trip_requests";
    private static final int SERVICE_ID = 8401;
    private static final int ALERT_ID = 8402;
    private WindowManager windowManager;
    private android.view.View overlay;
    private Ringtone ringtone;
    private String tripId = "";
    private String carId = "";
    private String passenger = "Pasajero";
    private String origin = "Origen no especificado";
    private String destination = "Destino no especificado";
    private String originDistance = "";
    private String destinationDistance = "";

    @Override public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        createChannels(this);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || !ACTION_SHOW.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        tripId = safe(intent.getStringExtra("tripId"), 128);
        carId = safe(intent.getStringExtra("carId"), 8);
        passenger = safe(intent.getStringExtra("passengerName"), 100);
        origin = cleanAddress(safe(intent.getStringExtra("origin"), 180));
        destination = cleanAddress(safe(intent.getStringExtra("destination"), 180));
        originDistance = safe(intent.getStringExtra("originDistance"), 24);
        destinationDistance = safe(intent.getStringExtra("destinationDistance"), 24);
        if (tripId.isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }

        Notification foreground = new NotificationCompat.Builder(this, SERVICE_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Dante Remises")
            .setContentText("Alerta de viaje pendiente")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(SERVICE_ID, foreground,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(SERVICE_ID, foreground);
        }

        showAlertNotification(this, tripId, carId, passenger, origin, destination, originDistance, destinationDistance);
        showOverlay();
        if (ringtone != null) {
            try { ringtone.stop(); } catch (Exception ignored) { }
        }
        startLoopingSound();
        return START_NOT_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private void showOverlay() {
        if (!Settings.canDrawOverlays(this) || windowManager == null) return;
        removeOverlay();
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(16), dp(18), dp(16));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.rgb(20, 32, 27));
        background.setCornerRadius(dp(20));
        background.setStroke(dp(2), Color.rgb(0, 230, 112));
        card.setBackground(background);
        card.setElevation(dp(12));

        TextView title = makeText("NUEVA SOLICITUD DE VIAJE", true);
        title.setTextColor(Color.rgb(0, 230, 112));
        title.setTextSize(13);
        card.addView(title);
        card.addView(makeText("Pasajero: " + passenger, true));
        card.addView(makeText("Desde: " + origin + distanceSuffix(originDistance), false));
        card.addView(makeText("Hasta: " + destination + distanceSuffix(destinationDistance), false));
        card.addView(makeText("Coche " + carId, false));

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER);
        Button reject = new Button(this);
        reject.setText("Rechazar viaje");
        reject.setTextSize(10);
        reject.setOnClickListener(view -> dispatchAction("reject"));
        Button viewTrip = new Button(this);
        viewTrip.setText("Ver viaje");
        viewTrip.setTextSize(10);
        viewTrip.setOnClickListener(view -> dispatchAction("view"));
        Button accept = new Button(this);
        accept.setText("Aceptar viaje");
        accept.setTextSize(10);
        accept.setTextColor(Color.WHITE);
        accept.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(20, 135, 76)));
        accept.setOnClickListener(view -> dispatchAction("accept"));
        LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(0, dp(48), 1);
        actionParams.setMargins(dp(2), 0, dp(2), 0);
        actions.addView(reject, actionParams);
        LinearLayout.LayoutParams viewParams = new LinearLayout.LayoutParams(0, dp(48), 1);
        viewParams.setMargins(dp(2), 0, dp(2), 0);
        actions.addView(viewTrip, viewParams);
        LinearLayout.LayoutParams acceptParams = new LinearLayout.LayoutParams(0, dp(48), 1);
        acceptParams.setMargins(dp(2), 0, dp(2), 0);
        actions.addView(accept, acceptParams);
        card.addView(actions);

        int width = Math.min(getResources().getDisplayMetrics().widthPixels - dp(24), dp(420));
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            width,
            WindowManager.LayoutParams.WRAP_CONTENT,
            Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN |
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.y = dp(28);
        try {
            windowManager.addView(card, params);
            overlay = card;
        } catch (Exception ignored) {
            overlay = null;
        }
    }

    private TextView makeText(String value, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextColor(Color.WHITE);
        view.setTextSize(14);
        view.setPadding(0, dp(7), 0, dp(3));
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private void startLoopingSound() {
        try {
            Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            ringtone = RingtoneManager.getRingtone(getApplicationContext(), soundUri);
            if (ringtone != null) {
                ringtone.setStreamType(AudioManager.STREAM_NOTIFICATION);
                if (Build.VERSION.SDK_INT >= 28) ringtone.setLooping(true);
                ringtone.play();
            }
        } catch (Exception ignored) { }
    }

    private void dispatchAction(String action) {
        getSharedPreferences("dante_trip_alerts", 0).edit()
            .putString("pending_action", action)
            .putString("pending_trip_id", tripId)
            .apply();
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
            Intent.FLAG_ACTIVITY_CLEAR_TOP |
            Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try { startActivity(open); } catch (Exception ignored) { }
        stopSelf();
    }

    private void removeOverlay() {
        if (overlay != null && windowManager != null) {
            try { windowManager.removeView(overlay); } catch (Exception ignored) { }
            overlay = null;
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static String safe(String value, int max) {
        if (value == null) return "";
        String clean = value.replace('\n', ' ').replace('\r', ' ').trim();
        return clean.substring(0, Math.min(clean.length(), max));
    }

    private static String distanceSuffix(String value) {
        String distance = safe(value, 24);
        return distance.isEmpty() ? "" : " · " + distance;
    }

    private static String cleanAddress(String value) {
        String[] parts = safe(value, 180).split(",");
        StringBuilder result = new StringBuilder();
        for (String raw : parts) {
            String part = raw.trim();
            if (part.isEmpty()) continue;
            if (part.matches("(?i)^\\d{4,5}\\b.*") ||
                part.matches("(?i).*(argentina|c[oó]rdoba|santa rosa de calamuchita|calamuchita).*")) continue;
            boolean road = part.matches("(?i).*\\b(calle|avenida|av\\.?|ruta|rp|rn|boulevard|bv\\.?|pasaje|camino|autopista)\\b.*") ||
                part.matches(".*\\d+.*");
            if (result.length() == 0) result.append(part);
            else if (road) { result.append(" · ").append(part); break; }
        }
        return result.length() == 0 ? "Ubicación sin referencia" : result.toString();
    }

    public static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel service = new NotificationChannel(
            SERVICE_CHANNEL, "Servicio de alertas de viajes", NotificationManager.IMPORTANCE_LOW);
        service.setSound(null, null);
        manager.createNotificationChannel(service);
        NotificationChannel alert = new NotificationChannel(
            ALERT_CHANNEL, "Solicitudes de viaje", NotificationManager.IMPORTANCE_HIGH);
        alert.setDescription("Alertas urgentes de solicitudes nuevas.");
        alert.enableVibration(true);
        alert.setSound(null, null);
        manager.createNotificationChannel(alert);
    }

    public static void showAlertNotification(Context context, String tripId, String carId,
            String passenger, String origin, String destination, String originDistance, String destinationDistance) {
        createChannels(context);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        String cleanOrigin = cleanAddress(origin);
        String cleanDestination = cleanAddress(destination);
        String fromLine = "Desde: " + cleanOrigin + distanceSuffix(originDistance);
        String toLine = "Hasta: " + cleanDestination + distanceSuffix(destinationDistance);
        Intent open = new Intent(context, MainActivity.class);
        PendingIntent content = PendingIntent.getActivity(context, tripId.hashCode(), open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, ALERT_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Nueva solicitud de viaje")
            .setContentText(passenger + " · Coche " + carId + " · " + cleanOrigin + distanceSuffix(originDistance) + " → " + cleanDestination + distanceSuffix(destinationDistance))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(
                "Pasajero: " + passenger + "\n" + fromLine + "\n" + toLine))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setContentIntent(content)
            .setSilent(true)
            .addAction(0, "Rechazar viaje", actionPendingIntent(context, tripId, "reject"))
            .addAction(0, "Ver viaje", actionPendingIntent(context, tripId, "view"))
            .addAction(0, "Aceptar viaje", actionPendingIntent(context, tripId, "accept"));
        manager.notify(ALERT_ID, builder.build());
    }

    private static PendingIntent actionPendingIntent(Context context, String tripId, String action) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.putExtra("danteTripAction", action);
        intent.putExtra("danteTripId", tripId);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, tripId.hashCode() ^ action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static void showFallbackNotification(Context context, Map<String, String> data) {
        String id = safe(data.get("tripId"), 128);
        if (id.isEmpty()) return;
        String car = safe(data.get("carId"), 8);
        String passenger = safe(data.get("passengerName"), 100);
        String origin = safe(data.get("origin"), 180);
        String destination = safe(data.get("destination"), 180);
        String originDistance = safe(data.get("originDistance"), 24);
        String destinationDistance = safe(data.get("destinationDistance"), 24);
        showAlertNotification(context, id, car, passenger, origin, destination, originDistance, destinationDistance);
        try {
            Ringtone sound = RingtoneManager.getRingtone(context,
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION));
            if (sound != null) sound.play();
        } catch (Exception ignored) { }
    }

    @Override public void onDestroy() {
        removeOverlay();
        if (ringtone != null) {
            try { ringtone.stop(); } catch (Exception ignored) { }
            ringtone = null;
        }
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        manager.cancel(ALERT_ID);
        super.onDestroy();
    }
}
