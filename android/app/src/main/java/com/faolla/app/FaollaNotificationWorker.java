package com.faolla.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

public class FaollaNotificationWorker extends Worker {
    static final String PREFS_NAME = "faolla_native_notifications";
    static final String WORK_NAME = "faolla_native_notification_poll";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_BASE_URL = "base_url";
    static final String KEY_SITE_ID = "site_id";
    static final String KEY_MERCHANT_EMAIL = "merchant_email";
    static final String KEY_MERCHANT_NAME = "merchant_name";
    static final String KEY_OFFICIAL_LAST_READ_AT = "official_last_read_at";
    static final String KEY_PEER_LAST_READ_JSON = "peer_last_read_json";
    static final String KEY_COOKIE_HEADER = "cookie_header";
    static final String KEY_SOUND = "sound";
    static final String KEY_VIBRATE = "vibrate";
    static final String KEY_LAST_NOTIFICATION_KEY = "last_notification_key";
    static final String KEY_INITIALIZED = "initialized";
    static final String KEY_UNREAD_COUNT = "unread_count";

    private static final String MESSAGE_CHANNEL_ID = "faolla_messages_v2";
    private static final String BADGE_CHANNEL_ID = "faolla_badges_v2";
    private static final String NOTIFICATION_ACTION_OPEN = "com.faolla.app.OPEN_NOTIFICATION";
    private static final String NOTIFICATION_EXTRA_URL = "faolla_url";
    private static final int BADGE_NOTIFICATION_ID = 73010;
    private static final int MESSAGE_NOTIFICATION_ID = 73100;
    private static final long POLL_DELAY_MS = 15_000L;

    public FaollaNotificationWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(KEY_ENABLED, false)) {
            cancel(context);
            return Result.success();
        }

        try {
            JSONObject payload = fetchSnapshot(prefs);
            int unreadCount = Math.max(0, Math.min(999, payload.optInt("unreadCount", 0)));
            applyLauncherBadgeCount(context, unreadCount);
            prefs.edit().putInt(KEY_UNREAD_COUNT, unreadCount).apply();

            JSONObject latest = payload.optJSONObject("latest");
            String latestKey = latest == null ? "" : latest.optString("key", "").trim();
            boolean initialized = prefs.getBoolean(KEY_INITIALIZED, false);
            String previousKey = prefs.getString(KEY_LAST_NOTIFICATION_KEY, "");

            if (!initialized) {
                syncUnreadBadge(context, unreadCount);
                prefs.edit()
                    .putBoolean(KEY_INITIALIZED, true)
                    .putString(KEY_LAST_NOTIFICATION_KEY, latestKey)
                    .apply();
            } else if (unreadCount > 0 && latest != null && !latestKey.isEmpty() && !latestKey.equals(previousKey)) {
                showMessageNotification(
                    context,
                    latest.optString("title", "Faolla"),
                    latest.optString("body", "New Faolla message"),
                    latest.optString("url", "/launch?appShell=faolla"),
                    unreadCount,
                    prefs.getBoolean(KEY_SOUND, true),
                    prefs.getBoolean(KEY_VIBRATE, true)
                );
                prefs.edit().putString(KEY_LAST_NOTIFICATION_KEY, latestKey).apply();
            } else {
                syncUnreadBadge(context, unreadCount);
            }
            scheduleNext(context);
            return Result.success();
        } catch (Exception ignored) {
            scheduleNext(context);
            return Result.success();
        }
    }

    static SharedPreferences getPrefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    static void scheduleNow(Context context) {
        enqueue(context, 0L);
    }

    static void scheduleNext(Context context) {
        enqueue(context, POLL_DELAY_MS);
    }

    static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
    }

    private static void enqueue(Context context, long delayMs) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        OneTimeWorkRequest.Builder builder = new OneTimeWorkRequest.Builder(FaollaNotificationWorker.class)
            .setConstraints(constraints);
        if (delayMs > 0L) {
            builder.setInitialDelay(delayMs, TimeUnit.MILLISECONDS);
        }
        WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, builder.build());
    }

    private JSONObject fetchSnapshot(SharedPreferences prefs) throws Exception {
        String baseUrl = normalizeBaseUrl(prefs.getString(KEY_BASE_URL, "https://www.faolla.com"));
        Uri.Builder builder = Uri.parse(baseUrl + "/api/merchant-native-notifications").buildUpon();
        appendQuery(builder, "siteId", prefs.getString(KEY_SITE_ID, ""));
        appendQuery(builder, "merchantEmail", prefs.getString(KEY_MERCHANT_EMAIL, ""));
        appendQuery(builder, "merchantName", prefs.getString(KEY_MERCHANT_NAME, ""));
        appendQuery(builder, "officialLastReadAt", prefs.getString(KEY_OFFICIAL_LAST_READ_AT, ""));
        appendQuery(builder, "peerLastRead", prefs.getString(KEY_PEER_LAST_READ_JSON, ""));

        URL url = new URL(builder.build().toString());
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(10_000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "FaollaAndroidNativeNotifications/1.0");
        String cookieHeader = prefs.getString(KEY_COOKIE_HEADER, "");
        if (cookieHeader != null && !cookieHeader.trim().isEmpty()) {
            connection.setRequestProperty("Cookie", cookieHeader);
        }

        int statusCode = connection.getResponseCode();
        InputStream stream = statusCode >= 200 && statusCode < 400
            ? connection.getInputStream()
            : connection.getErrorStream();
        String response = readStream(stream);
        if (statusCode < 200 || statusCode >= 300) {
            throw new IllegalStateException("notification_snapshot_failed_" + statusCode);
        }
        return new JSONObject(response);
    }

    private static void appendQuery(Uri.Builder builder, String key, String value) {
        if (value == null || value.trim().isEmpty()) {
            return;
        }
        builder.appendQueryParameter(key, value.trim());
    }

    private static String readStream(InputStream stream) throws Exception {
        if (stream == null) return "{}";
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }
        return builder.toString();
    }

    private static String normalizeBaseUrl(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
            return normalized;
        }
        return "https://www.faolla.com";
    }

    private static boolean hasPostNotificationPermission(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return true;
        }
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private static void ensureNotificationChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager notificationManager = context.getSystemService(NotificationManager.class);
        if (notificationManager == null) {
            return;
        }

        Uri defaultSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

        NotificationChannel messageChannel = new NotificationChannel(
            MESSAGE_CHANNEL_ID,
            "Faolla messages",
            NotificationManager.IMPORTANCE_HIGH
        );
        messageChannel.setDescription("New Faolla message alerts");
        messageChannel.enableVibration(true);
        messageChannel.setVibrationPattern(new long[] { 0L, 120L, 70L, 160L });
        messageChannel.setSound(defaultSound, audioAttributes);
        messageChannel.setShowBadge(true);
        notificationManager.createNotificationChannel(messageChannel);

        NotificationChannel badgeChannel = new NotificationChannel(
            BADGE_CHANNEL_ID,
            "Faolla unread badges",
            NotificationManager.IMPORTANCE_LOW
        );
        badgeChannel.setDescription("Faolla unread count badge sync");
        badgeChannel.enableVibration(false);
        badgeChannel.setSound(null, null);
        badgeChannel.setShowBadge(true);
        notificationManager.createNotificationChannel(badgeChannel);
    }

    private static PendingIntent buildNotificationPendingIntent(Context context, String url, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(NOTIFICATION_ACTION_OPEN);
        intent.putExtra(NOTIFICATION_EXTRA_URL, url);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(context, requestCode, intent, flags);
    }

    @SuppressWarnings("deprecation")
    private static void vibrate(Context context) {
        try {
            Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null) return;
            long[] pattern = new long[] { 0L, 120L, 70L, 160L };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
            } else {
                vibrator.vibrate(pattern, -1);
            }
        } catch (Exception ignored) {
        }
    }

    private static void showMessageNotification(
        Context context,
        String title,
        String body,
        String url,
        int unreadCount,
        boolean soundEnabled,
        boolean vibrationEnabled
    ) {
        if (vibrationEnabled) {
            vibrate(context);
        }
        if (!hasPostNotificationPermission(context)) {
            return;
        }

        ensureNotificationChannels(context);
        NotificationManagerCompat.from(context).cancel(BADGE_NOTIFICATION_ID);
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, MESSAGE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_faolla)
            .setColor(Color.rgb(8, 17, 33))
            .setContentTitle(title == null || title.trim().isEmpty() ? "Faolla" : title.trim())
            .setContentText(body == null || body.trim().isEmpty() ? "New Faolla message" : body.trim())
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null ? "" : body.trim()))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(buildNotificationPendingIntent(context, url, MESSAGE_NOTIFICATION_ID))
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .setNumber(unreadCount);
        if (soundEnabled) {
            notification.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION));
        } else {
            notification.setSilent(true);
        }
        if (vibrationEnabled) {
            notification.setVibrate(new long[] { 0L, 120L, 70L, 160L });
        } else {
            notification.setVibrate(new long[] { 0L });
        }
        Notification postedNotification = FaollaLauncherBadge.withBadgeCount(notification.build(), unreadCount);
        NotificationManagerCompat.from(context).notify(MESSAGE_NOTIFICATION_ID, postedNotification);
    }

    static void syncUnreadBadge(Context context, int unreadCount) {
        int normalizedUnreadCount = Math.max(0, Math.min(999, unreadCount));
        applyLauncherBadgeCount(context, normalizedUnreadCount);
        if (!hasPostNotificationPermission(context)) {
            return;
        }

        NotificationManagerCompat notificationManager = NotificationManagerCompat.from(context);
        if (normalizedUnreadCount <= 0) {
            notificationManager.cancel(BADGE_NOTIFICATION_ID);
            notificationManager.cancel(MESSAGE_NOTIFICATION_ID);
            return;
        }

        ensureNotificationChannels(context);
        notificationManager.cancel(MESSAGE_NOTIFICATION_ID);
        String body = normalizedUnreadCount + " unread messages";
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, BADGE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_faolla)
            .setColor(Color.rgb(8, 17, 33))
            .setContentTitle("Faolla")
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setAutoCancel(false)
            .setContentIntent(buildNotificationPendingIntent(context, "/launch?appShell=faolla", BADGE_NOTIFICATION_ID))
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .setNumber(normalizedUnreadCount);
        Notification postedNotification = FaollaLauncherBadge.withBadgeCount(notification.build(), normalizedUnreadCount);
        notificationManager.notify(BADGE_NOTIFICATION_ID, postedNotification);
    }

    private static void applyLauncherBadgeCount(Context context, int unreadCount) {
        FaollaLauncherBadge.applyCount(context, unreadCount);
    }
}
