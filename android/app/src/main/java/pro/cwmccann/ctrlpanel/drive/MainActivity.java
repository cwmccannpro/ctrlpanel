package pro.cwmccann.ctrlpanel.drive;

import android.app.Activity;
import android.app.SearchManager;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.provider.MediaStore;
import android.speech.RecognizerIntent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.*;
import android.widget.Toast;
import androidx.webkit.*;
import java.io.ByteArrayInputStream;
import java.util.Collections;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String ORIGIN = "https://ctrlpanel.cwmccann.pro";
    private static final String SPOTIFY = "com.spotify.music";
    private WebView web;
    private JavaScriptReplyProxy reply;
    private DriveLocation location;
    private String voiceKind;
    private String artSent; // album-art id the current page already has
    private JSONObject voiceResult;
    private static final int VOICE = 421;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() { public void run() { publish(); handler.postDelayed(this, 2000); } };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        web = new WebView(this);
        setContentView(web);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString() + " CTRLpanelDrive/0.2 (https://ctrlpanel.cwmccann.pro)");
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        location = new DriveLocation(this);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!trusted(uri)) return null;
                String path = uri.getPath();
                if (path == null) return null;
                if (path.startsWith("/api/")) return null;
                String asset = request.isForMainFrame() ? "tablet.html" : path.substring(1);
                if (asset.contains("..") || (!request.isForMainFrame() && !asset.startsWith("assets/")))
                    return missing();
                try {
                    String mime = asset.endsWith(".js") ? "application/javascript" : asset.endsWith(".css") ? "text/css" : asset.endsWith(".html") ? "text/html"
                        : asset.endsWith(".woff2") ? "font/woff2" : asset.endsWith(".woff") ? "font/woff" : asset.endsWith(".svg") ? "image/svg+xml"
                        : asset.endsWith(".png") ? "image/png" : asset.endsWith(".json") ? "application/json" : asset.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
                    return new WebResourceResponse(mime, "UTF-8", getAssets().open("web/" + asset));
                } catch (Exception e) { return missing(); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (trusted(request.getUrl())) return false;
                if (request.isForMainFrame() && "https".equals(request.getUrl().getScheme())) open(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) { reply = null; artSent = null; }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "CTRLDrive", Collections.singleton(ORIGIN), (view, message, origin, mainFrame, proxy) -> {
                if (!mainFrame || !trusted(origin) || view.getUrl() == null || !"/drive".equals(Uri.parse(view.getUrl()).getPath())) return;
                if (reply != proxy) artSent = null; // a new page needs the art again
                reply = proxy;
                try { handle(message.getData()); }
                catch (RuntimeException e) { Toast.makeText(this, "App connection changed. Open the app and try again.", Toast.LENGTH_SHORT).show(); }
            });
        } else Toast.makeText(this, "Update Android System WebView to enable Maps and Spotify controls.", Toast.LENGTH_LONG).show();
        web.loadUrl(ORIGIN + "/drive");
    }
    private static boolean trusted(Uri uri) { return "https".equals(uri.getScheme()) && "ctrlpanel.cwmccann.pro".equals(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443); }
    private static WebResourceResponse missing() { return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0])); }
    private void open(Intent intent) { try { startActivity(intent); } catch (Exception e) { Toast.makeText(this, "Install or enable the app on this tablet first.", Toast.LENGTH_LONG).show(); } }
    private void handle(String command) {
        if (command == null) return;
        if (command.length() > 2000) return;
        if (command.startsWith("{")) { handleRequest(command); return; }
        switch (command) {
            case "state": publish(); break;
            case "permissions": open(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)); break;
            case "location": location.enable(); break;
            case "voiceMaps": startVoice("maps"); break;
            case "voiceMusic": startVoice("music"); break;
            case "maps":
                Intent mapsLaunch = getPackageManager().getLaunchIntentForPackage(DriveNotifications.MAPS);
                if (mapsLaunch != null) open(mapsLaunch); else open(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + DriveNotifications.MAPS)));
                break;
            case "spotify":
                Intent launch = getPackageManager().getLaunchIntentForPackage(SPOTIFY);
                if (launch != null) open(launch); else open(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + SPOTIFY)));
                break;
            case "ctrlpanel": open(new Intent(Intent.ACTION_VIEW, Uri.parse(ORIGIN))); break;
            case "playPause": case "next": case "previous":
                MediaController controller = spotify();
                if (controller == null) { publish(); return; }
                MediaController.TransportControls control = controller.getTransportControls();
                if ("next".equals(command)) control.skipToNext();
                else if ("previous".equals(command)) control.skipToPrevious();
                else if (playing(controller)) control.pause(); else control.play();
                publish(); break;
            default: break;
        }
    }
    private void handleRequest(String data) {
        try {
            JSONObject request = new JSONObject(data);
            String command = request.optString("command"), query = request.optString("query").trim();
            if ("seek".equals(command)) { // scrub Spotify to a position in the current track
                long position = request.optLong("position", -1);
                MediaController controller = spotify();
                if (controller != null && position >= 0 && position <= 86_400_000L) controller.getTransportControls().seekTo(position);
                publish();
                return;
            }
            if (query.isEmpty() || query.length() > 200 || query.matches("(?s).*[\\x00-\\x1f].*")) return;
            if ("navigate".equals(command)) {
                open(new Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + Uri.encode(query) + "&mode=d")).setPackage(DriveNotifications.MAPS));
            } else if ("musicSearch".equals(command)) {
                Intent play = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH).setPackage(SPOTIFY)
                    .putExtra(SearchManager.QUERY, query).putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/audio");
                if (play.resolveActivity(getPackageManager()) != null) open(play);
                else open(new Intent(Intent.ACTION_VIEW, Uri.parse("spotify:search:" + Uri.encode(query))).setPackage(SPOTIFY));
            }
        } catch (Exception ignored) { Toast.makeText(this, "Could not send that request. Please try again.", Toast.LENGTH_SHORT).show(); }
    }
    private void startVoice(String kind) {
        if (voiceKind != null) return;
        voiceKind = kind;
        Intent speech = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "maps".equals(kind) ? "Say your destination" : "Say a song, artist or playlist");
        try { startActivityForResult(speech, VOICE); }
        catch (Exception e) { finishVoice("", "Voice recognition is unavailable. Type your request instead."); }
    }
    private void finishVoice(String text, String error) {
        try { voiceResult = new JSONObject().put("id", Long.toString(System.nanoTime())).put("kind", voiceKind)
            .put("text", text.substring(0, Math.min(200, text.length()))).put("error", error); }
        catch (Exception ignored) { }
        voiceKind = null;
        publish();
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != VOICE) return;
        java.util.ArrayList<String> results = data == null ? null : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (resultCode == RESULT_OK && results != null && !results.isEmpty()) finishVoice(results.get(0), "");
        else finishVoice("", "No speech captured. Try again or type your request.");
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == DriveLocation.PERMISSION) { location.start(); publish(); }
    }
    private MediaController spotify() {
        try {
            MediaSessionManager manager = (MediaSessionManager) getSystemService(MEDIA_SESSION_SERVICE);
            for (MediaController c : manager.getActiveSessions(new ComponentName(this, DriveNotifications.class)))
                if (SPOTIFY.equals(c.getPackageName())) return c;
        } catch (SecurityException ignored) { }
        return null;
    }
    private boolean playing(MediaController c) { return c.getPlaybackState() != null && c.getPlaybackState().getState() == PlaybackState.STATE_PLAYING; }
    private String field(MediaMetadata m, String key) { String value = m == null ? null : m.getString(key); return value == null ? "" : value.substring(0, Math.min(500, value.length())); }
    private void publish() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        if (reply == null || web == null || web.getUrl() == null || !"/drive".equals(Uri.parse(web.getUrl()).getPath())) return;
        try {
            MediaController c = spotify();
            JSONObject music = null;
            String sentArt = null;
            if (c != null) {
                MediaMetadata md = c.getMetadata();
                PlaybackState ps = c.getPlaybackState();
                long duration = md == null ? 0 : Math.max(0, md.getLong(MediaMetadata.METADATA_KEY_DURATION));
                long position = 0;
                if (ps != null && ps.getPosition() >= 0) {
                    position = ps.getPosition();
                    if (ps.getState() == PlaybackState.STATE_PLAYING && ps.getLastPositionUpdateTime() > 0)
                        position += (long) ((SystemClock.elapsedRealtime() - ps.getLastPositionUpdateTime()) * ps.getPlaybackSpeed());
                }
                if (duration > 0) position = Math.min(position, duration);
                music = new JSONObject().put("title", field(md, MediaMetadata.METADATA_KEY_TITLE))
                        .put("artist", field(md, MediaMetadata.METADATA_KEY_ARTIST)).put("album", field(md, MediaMetadata.METADATA_KEY_ALBUM))
                        .put("playing", playing(c)).put("duration", duration).put("position", Math.max(0, position));
                // Album art goes once per change (it is ~20–40 kB); every message carries its id.
                Bitmap art = md == null ? null : md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
                if (art == null && md != null) art = md.getBitmap(MediaMetadata.METADATA_KEY_ART);
                String artId = DriveImages.signature(art);
                music.put("artId", artId);
                if (!artId.equals(artSent)) { String data = DriveImages.encode(art, 360, false); music.put("art", data == null ? JSONObject.NULL : data); sentArt = artId; }
            }
            JSONObject maps = DriveNotifications.navigation();
            JSONObject fix = location.snapshot();
            reply.postMessage(new JSONObject().put("access", DriveNotifications.instance != null)
                    .put("location", fix == null ? JSONObject.NULL : fix).put("locationMessage", location.message())
                    .put("voice", voiceResult == null ? JSONObject.NULL : voiceResult)
                    .put("music", music == null ? JSONObject.NULL : music)
                    .put("maps", maps == null ? JSONObject.NULL : maps).toString());
            if (sentArt != null) artSent = sentArt; // only once the page actually received it
        } catch (Exception ignored) { /* Page navigated or permission revoked; next tick retries. */ }
    }
    @Override protected void onResume() {
        super.onResume(); if (web != null) { web.onResume(); web.evaluateJavascript("window.dispatchEvent(new Event('ctrlpanel:resume'))", null); }
        if (location != null) location.start();
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        handler.removeCallbacks(tick); handler.post(tick);
    }
    @Override protected void onPause() { handler.removeCallbacks(tick); if (location != null) location.stop(); if (web != null) { web.evaluateJavascript("window.dispatchEvent(new Event('ctrlpanel:pause'))", null); web.onPause(); } super.onPause(); }
    @Override protected void onDestroy() { handler.removeCallbacks(tick); reply = null; if (web != null) { web.destroy(); web = null; } super.onDestroy(); }
    private boolean onDrive() { return web != null && web.getUrl() != null && "/drive".equals(Uri.parse(web.getUrl()).getPath()); }
    private boolean launchedAsHome() { Intent i = getIntent(); return i != null && i.hasCategory(Intent.CATEGORY_HOME); }
    // As the home app, pressing Home while on another page returns to Drive (singleTask delivers it here).
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.hasCategory(Intent.CATEGORY_HOME) && web != null && !onDrive()) web.loadUrl(ORIGIN + "/drive");
    }
    // Back leaves other pages for Drive. On Drive it exits only when opened as a normal app; a home screen has nothing behind it.
    @Override public void onBackPressed() {
        if (web != null && !onDrive()) web.loadUrl(ORIGIN + "/drive");
        else if (!launchedAsHome()) super.onBackPressed();
    }
}
