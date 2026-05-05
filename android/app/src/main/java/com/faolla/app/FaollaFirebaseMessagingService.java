package com.faolla.app;

import android.content.SharedPreferences;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class FaollaFirebaseMessagingService extends FirebaseMessagingService {
    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        FaollaFirebaseTokenRegistrar.registerToken(this, token);
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Map<String, String> data = remoteMessage.getData();
        RemoteMessage.Notification notification = remoteMessage.getNotification();

        String title = read(data, "title", notification == null ? "Faolla" : notification.getTitle());
        String body = read(data, "body", notification == null ? "New Faolla message" : notification.getBody());
        String url = read(data, "url", "/launch?appShell=faolla");
        int badgeCount = normalizeBadgeCount(read(data, "badgeCount", read(data, "unreadCount", "1")));
        boolean sound = !"false".equalsIgnoreCase(read(data, "sound", "true"));
        boolean vibrate = !"false".equalsIgnoreCase(read(data, "vibrate", "true"));
        String notificationKey = read(data, "key", read(data, "tag", ""));

        SharedPreferences prefs = FaollaNotificationWorker.getPrefs(this);
        if (!notificationKey.isEmpty()) {
            FaollaNotificationWorker.rememberNotificationKey(prefs, notificationKey);
        }
        prefs.edit()
            .putInt(FaollaNotificationWorker.KEY_UNREAD_COUNT, badgeCount)
            .apply();

        FaollaNotificationWorker.showMessageNotification(this, title, body, url, badgeCount, sound, vibrate);
        FaollaNotificationWorker.scheduleNow(this);
    }

    private static String read(Map<String, String> data, String key, String fallback) {
        String value = data == null ? "" : data.get(key);
        String normalized = value == null ? "" : value.trim();
        if (!normalized.isEmpty()) return normalized;
        return fallback == null ? "" : fallback.trim();
    }

    private static int normalizeBadgeCount(String value) {
        try {
            int parsed = Integer.parseInt(value == null ? "" : value.trim());
            return Math.max(0, Math.min(999, parsed));
        } catch (Exception ignored) {
            return 1;
        }
    }
}
