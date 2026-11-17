package __PACKAGE__;
import android.app.Application;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

public class DantePushApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        if (DanteFirebaseOptions.isConfigured() && FirebaseApp.getApps(this).isEmpty()) {
            FirebaseOptions options = new FirebaseOptions.Builder()
                .setApiKey(DanteFirebaseOptions.API_KEY)
                .setApplicationId(DanteFirebaseOptions.APP_ID)
                .setProjectId(DanteFirebaseOptions.PROJECT_ID)
                .setGcmSenderId(DanteFirebaseOptions.SENDER_ID)
                .build();
            FirebaseApp.initializeApp(this, options);
        }
    }
}
