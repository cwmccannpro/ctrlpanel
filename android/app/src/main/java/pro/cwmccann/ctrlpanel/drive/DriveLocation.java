package pro.cwmccann.ctrlpanel.drive;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import org.json.JSONObject;

/** Foreground-only Android location. Accepts system/mock providers used by phone GPS bridges. */
final class DriveLocation implements LocationListener {
    private final Activity activity;
    private final LocationManager manager;
    private Location latest;
    private String message = "Enable location to follow your phone’s shared position.";
    static final int PERMISSION = 420;
    DriveLocation(Activity activity) { this.activity = activity; manager = (LocationManager) activity.getSystemService(Activity.LOCATION_SERVICE); }
    boolean allowed() { return activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED || activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED; }
    void enable() {
        if (!allowed()) activity.requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, PERMISSION);
        else start();
    }
    void start() {
        stop();
        if (!allowed()) { latest = null; message = "Allow location access to show the live map."; return; }
        message = "Waiting for your shared location…";
        boolean listening = false;
        for (String provider : manager.getProviders(true)) {
            try {
                manager.requestLocationUpdates(provider, 3000, 5, this);
                listening = true;
                Location last = manager.getLastKnownLocation(provider);
                if (last != null && System.currentTimeMillis() - last.getTime() < 60000) onLocationChanged(last);
            } catch (SecurityException | IllegalArgumentException ignored) { }
        }
        if (!listening) message = "Turn on Android location and your phone’s location-sharing app.";
    }
    void stop() { try { manager.removeUpdates(this); } catch (SecurityException ignored) { } }
    @Override public void onLocationChanged(Location location) {
        if (latest == null || location.getTime() >= latest.getTime()) { latest = location; message = ""; }
    }
    @Override public void onProviderDisabled(String provider) { message = "Location provider disconnected. Check your phone’s location-sharing app."; }
    @Override public void onProviderEnabled(String provider) { }
    @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
    String message() { return message; }
    JSONObject snapshot() {
        if (!allowed()) { latest = null; return null; }
        if (latest == null) return null;
        try {
            return new JSONObject().put("latitude", latest.getLatitude()).put("longitude", latest.getLongitude())
                .put("accuracy", latest.hasAccuracy() ? latest.getAccuracy() : JSONObject.NULL)
                .put("speed", latest.hasSpeed() ? latest.getSpeed() : JSONObject.NULL)
                .put("bearing", latest.hasBearing() && latest.hasSpeed() && latest.getSpeed() > 0.5 ? latest.getBearing() : JSONObject.NULL)
                .put("timestamp", latest.getTime());
        } catch (Exception ignored) { return null; }
    }
}
