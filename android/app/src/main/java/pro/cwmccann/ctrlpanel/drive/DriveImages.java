package pro.cwmccann.ctrlpanel.drive;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.util.Base64;
import java.io.ByteArrayOutputStream;

/** Small, bounded image hand-off to the Drive page (album art, turn arrows). Images stay in RAM. */
final class DriveImages {
    private DriveImages() { }

    /** Cheap content fingerprint: size plus a 4x4 pixel sample. Metadata parcels give a new Bitmap object every read. */
    static String signature(Bitmap b) {
        if (b == null || b.isRecycled()) return "none";
        try {
            Bitmap s = software(b);
            int w = s.getWidth(), h = s.getHeight();
            long hash = w * 31L + h;
            for (int i = 1; i <= 4; i++) for (int j = 1; j <= 4; j++) hash = hash * 31 + s.getPixel(w * i / 5, h * j / 5);
            return Long.toHexString(hash);
        } catch (RuntimeException e) { return b.getWidth() + "x" + b.getHeight(); }
    }

    /** data: URL, longest side at most {@code max} px. JPEG for photos, PNG keeps transparency. */
    static String encode(Bitmap b, int max, boolean png) {
        if (b == null || b.isRecycled()) return null;
        try {
            Bitmap s = software(b);
            float scale = Math.min(1f, (float) max / Math.max(s.getWidth(), s.getHeight()));
            if (scale < 1f) s = Bitmap.createScaledBitmap(s, Math.max(1, Math.round(s.getWidth() * scale)), Math.max(1, Math.round(s.getHeight() * scale)), true);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            s.compress(png ? Bitmap.CompressFormat.PNG : Bitmap.CompressFormat.JPEG, 82, out);
            return (png ? "data:image/png;base64," : "data:image/jpeg;base64,") + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (RuntimeException e) { return null; }
    }

    /** A turn arrow is only usable as a shape when its background is transparent. */
    static boolean transparentCorners(Bitmap b) {
        try {
            Bitmap s = software(b);
            int w = s.getWidth() - 1, h = s.getHeight() - 1;
            return Color.alpha(s.getPixel(0, 0)) == 0 && Color.alpha(s.getPixel(w, 0)) == 0 && Color.alpha(s.getPixel(0, h)) == 0 && Color.alpha(s.getPixel(w, h)) == 0;
        } catch (RuntimeException e) { return false; }
    }

    static Bitmap fromDrawable(Drawable d, int size) {
        if (d == null) return null;
        if (d instanceof BitmapDrawable && ((BitmapDrawable) d).getBitmap() != null) return ((BitmapDrawable) d).getBitmap();
        int w = d.getIntrinsicWidth() > 0 ? d.getIntrinsicWidth() : size, h = d.getIntrinsicHeight() > 0 ? d.getIntrinsicHeight() : size;
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        d.setBounds(0, 0, w, h);
        d.draw(c);
        return b;
    }

    private static Bitmap software(Bitmap b) {
        return b.getConfig() == Bitmap.Config.HARDWARE ? b.copy(Bitmap.Config.ARGB_8888, false) : b;
    }
}
