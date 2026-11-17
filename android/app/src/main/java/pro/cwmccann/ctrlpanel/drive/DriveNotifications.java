package pro.cwmccann.ctrlpanel.drive;

import android.app.Notification;
import android.graphics.Bitmap;
import android.graphics.drawable.Icon;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONObject;

/** Only the Maps ongoing navigation category is retained, in RAM. Never upload notifications. */
public class DriveNotifications extends NotificationListenerService {
    static volatile DriveNotifications instance;
    static final String MAPS = "com.google.android.apps.maps";
    @Override public void onListenerConnected() { instance = this; }
    @Override public void onListenerDisconnected() { instance = null; }
    @Override public void onDestroy() { instance = null; super.onDestroy(); }
    static JSONObject navigation() {
        DriveNotifications listener = instance;
        if (listener == null) return null;
        try {
            StatusBarNotification latest = null;
            for (StatusBarNotification item : listener.getActiveNotifications()) {
                Notification n = item.getNotification();
                if (MAPS.equals(item.getPackageName()) && item.isOngoing()
                        && Notification.CATEGORY_NAVIGATION.equals(n.category)
                        && (latest == null || item.getPostTime() > latest.getPostTime())) latest = item;
            }
            if (latest == null) return null;
            Notification n = latest.getNotification();
            JSONObject route = new JSONObject().put("title", text(n, Notification.EXTRA_TITLE))
                    .put("text", text(n, Notification.EXTRA_TEXT)).put("subtext", text(n, Notification.EXTRA_SUB_TEXT));
            // Google Maps' large icon is the maneuver arrow for the next step.
            Icon large = n.getLargeIcon();
            Bitmap arrow = large == null ? null : DriveImages.fromDrawable(large.loadDrawable(listener), 128);
            if (arrow != null && DriveImages.transparentCorners(arrow)) {
                String icon = DriveImages.encode(arrow, 128, true);
                if (icon != null) route.put("icon", icon);
            }
            return route;
        } catch (Exception ignored) { return null; }
    }
    private static String text(Notification n, String key) {
        CharSequence value = n.extras.getCharSequence(key);
        if (value == null) return "";
        String s = value.toString();
        return s.substring(0, Math.min(s.length(), 500));
    }
}
