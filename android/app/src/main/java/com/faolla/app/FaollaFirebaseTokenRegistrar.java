package com.faolla.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import com.google.firebase.messaging.FirebaseMessaging;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

final class FaollaFirebaseTokenRegistrar {
    private FaollaFirebaseTokenRegistrar() {}

    static void registerCurrentToken(Context context) {
        if (!FaollaNotificationWorker.isEnabled(context)) return;
        try {
            FirebaseMessaging.getInstance()
                .getToken()
                .addOnCompleteListener(task -> {
                    if (!task.isSuccessful()) return;
                    String token = task.getResult();
                    registerToken(context, token);
                });
        } catch (Exception ignored) {
            // Firebase is unavailable until google-services.json is configured.
        }
    }

    static void registerToken(Context context, String token) {
        String normalizedToken = token == null ? "" : token.trim();
        if (normalizedToken.isEmpty()) return;
        SharedPreferences prefs = FaollaNotificationWorker.getPrefs(context);
        prefs.edit().putString(FaollaNotificationWorker.KEY_FCM_TOKEN, normalizedToken).apply();
        if (!prefs.getBoolean(FaollaNotificationWorker.KEY_ENABLED, false)) return;
        postTokenAction(context.getApplicationContext(), "register", normalizedToken);
    }

    static void unregisterCurrentToken(Context context) {
        SharedPreferences prefs = FaollaNotificationWorker.getPrefs(context);
        String token = prefs.getString(FaollaNotificationWorker.KEY_FCM_TOKEN, "");
        if (token == null || token.trim().isEmpty()) return;
        postTokenAction(context.getApplicationContext(), "unregister", token.trim());
    }

    private static void postTokenAction(Context context, String action, String token) {
        new Thread(() -> {
            try {
                SharedPreferences prefs = FaollaNotificationWorker.getPrefs(context);
                String baseUrl = normalizeBaseUrl(prefs.getString(FaollaNotificationWorker.KEY_BASE_URL, "https://www.faolla.com"));
                URL url = new URL(baseUrl + "/api/merchant-native-push-tokens");
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(10_000);
                connection.setReadTimeout(10_000);
                connection.setDoOutput(true);
                connection.setUseCaches(false);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setRequestProperty("User-Agent", "FaollaAndroidFcm/1.0");
                String cookieHeader = prefs.getString(FaollaNotificationWorker.KEY_COOKIE_HEADER, "");
                if (cookieHeader != null && !cookieHeader.trim().isEmpty()) {
                    connection.setRequestProperty("Cookie", cookieHeader);
                }
                String accessToken = prefs.getString(FaollaNotificationWorker.KEY_ACCESS_TOKEN, "");
                if (accessToken != null && !accessToken.trim().isEmpty()) {
                    connection.setRequestProperty("x-merchant-access-token", accessToken.trim());
                }
                String refreshToken = prefs.getString(FaollaNotificationWorker.KEY_REFRESH_TOKEN, "");
                if (refreshToken != null && !refreshToken.trim().isEmpty()) {
                    connection.setRequestProperty("x-merchant-refresh-token", refreshToken.trim());
                }

                JSONObject payload = new JSONObject();
                payload.put("action", action);
                payload.put("token", token);
                payload.put("platform", "android");
                payload.put("siteId", prefs.getString(FaollaNotificationWorker.KEY_SITE_ID, ""));
                payload.put("merchantEmail", prefs.getString(FaollaNotificationWorker.KEY_MERCHANT_EMAIL, ""));
                payload.put("merchantName", prefs.getString(FaollaNotificationWorker.KEY_MERCHANT_NAME, ""));
                payload.put("unreadCount", Math.max(0, Math.min(999, prefs.getInt(FaollaNotificationWorker.KEY_UNREAD_COUNT, 0))));

                byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                }
                int statusCode = connection.getResponseCode();
                if (statusCode >= 200 && statusCode < 300 && "unregister".equals(action)) {
                    prefs.edit().remove(FaollaNotificationWorker.KEY_FCM_TOKEN).apply();
                }
                connection.disconnect();
            } catch (Exception ignored) {
                // Token registration is retried whenever the app reconfigures native notifications.
            }
        }, "faolla-fcm-token-register").start();
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
}
