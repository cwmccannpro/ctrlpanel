package pro.cwmccann.ctrlpanel.drive;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONObject;

/**
 * Only the Maps ongoing navigation category is retained, in RAM. Never upload notifications.
 *
 * Both Drive cards depend on this listener: Maps' next turn comes from its notifications, and
 * Spotify's media session is only visible to an app holding notification access. Android can
 * drop the binding (APK update, process killed on a low-memory tablet) while access stays
 * granted, and it does not always rebind on its own, so Drive asks for a rebind when that happens.
 */
public class DriveNotifications extends NotificationListenerService {
    static volatile DriveNotifications instance;
    static final String MAPS = "com.google.android.apps.maps";
    private static long lastRebind;
    @Override public void onListenerConnected() { instance = this; }
    @Override public void onListenerDisconnected() { instance = null; rebind(this, true); }
    @Override public void onDestroy() { instance = null; super.onDestroy(); }

    static ComponentName component(Context context) { return new ComponentName(context, DriveNotifications.class); }

    /** Notification access is switched on for Drive in Android settings (whether or not it is connected right now). */
    static boolean granted(Context context) {
        try {
            if (Build.VERSION.SDK_INT >= 27) {
                NotificationManager manager = context.getSystemService(NotificationManager.class);
                if (manager != null) return manager.isNotificationListenerAccessGranted(component(context));
            }
            String enabled = Settings.Secure.getString(context.getContentResolver(), "enabled_notification_listeners");
            if (enabled == null) return false;
            String mine = component(context).flattenToString(), shortName = component(context).flattenToShortString();
            for (String item : enabled.split(":")) if (mine.equals(item) || shortName.equals(item)) return true;
        } catch (RuntimeException ignored) { }
        return false;
    }

    /** Android Go / low-RAM builds don't offer notification access at all. */
    static boolean supported(Context context) {
        ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        return manager == null || !manager.isLowRamDevice();
    }

    /** Ask Android to reconnect the listener when access is on but it isn't connected. At most every 15 s. */
    static void rebind(Context context, boolean force) {
        if (instance != null || !granted(context)) return;
        long now = SystemClock.elapsedRealtime();
        if (!force && lastRebind != 0 && now - lastRebind < 15000) return;
        lastRebind = now;
        try { NotificationListenerService.requestRebind(component(context)); } catch (RuntimeException ignored) { }
    }

    static JSONObject navigation() {
        DriveNotifications listener = instance;
        if (listener == null) return null;
        try {
            StatusBarNotification[] active = listener.getActiveNotifications();
            if (active == null) return null;
            StatusBarNotification latest = null;
            for (StatusBarNotification item : active) {
                Notification n = item.getNotification();
                if (MAPS.equals(item.getPackageName()) && item.isOngoing()
                        && Notification.CATEGORY_NAVIGATION.equals(n.category)
                        && (latest == null || item.getPostTime() > latest.getPostTime())) latest = item;
            }
            if (latest == null) return null;
            Notification n = latest.getNotification();
            JSONObject route = new JSONObject().put("title", text(n, Notification.EXTRA_TITLE))
                    .put("text", text(n, Notification.EXTRA_TEXT)).put("subtext", text(n, Notification.EXTRA_SUB_TEXT));
            // Google Maps' large icon is the maneuver arrow for the next step. A failure here only
            // loses the arrow (the page draws its own), never the turn text.
            try {
                Icon large = n.getLargeIcon();
                Bitmap arrow = large == null ? null : DriveImages.fromDrawable(large.loadDrawable(listener), 128);
                if (arrow != null && DriveImages.transparentCorners(arrow)) {
                    String icon = DriveImages.encode(arrow, 128, true);
                    if (icon != null) route.put("icon", icon);
                }
            } catch (Exception ignored) { }
            return route;
        } catch (Exception ignored) { return null; }
    }
    private static String text(Notification n, String key) {
        CharSequence value = n.extras == null ? null : n.extras.getCharSequence(key);
        if (value == null) return "";
        String s = value.toString();
        return s.substring(0, Math.min(s.length(), 500));
    }
}
