package com.faolla.app;

import android.Manifest;
import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.Toast;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final int LAUNCH_BACKGROUND_COLOR = Color.rgb(8, 17, 33);
    private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";
    private static final String MESSAGE_CHANNEL_ID = "faolla_messages_v2";
    private static final String BADGE_CHANNEL_ID = "faolla_badges_v2";
    private static final String NOTIFICATION_ACTION_OPEN = "com.faolla.app.OPEN_NOTIFICATION";
    private static final String NOTIFICATION_EXTRA_URL = "faolla_url";
    private static final int NOTIFICATION_PERMISSION_REQUEST_CODE = 7301;
    private static final int BADGE_NOTIFICATION_ID = 73010;
    private static final int MESSAGE_NOTIFICATION_BASE_ID = 73100;
    private final Handler updateProgressHandler = new Handler(Looper.getMainLooper());
    private long pendingUpdateDownloadId = -1L;
    private Uri pendingUpdateApkUri;
    private boolean pendingUpdateAutoInstall = false;
    private boolean updateInstallStarted = false;
    private FrameLayout launchCover;
    private boolean launchCoverHidden = false;
    private int messageNotificationSerial = 0;
    private int nativeUnreadBadgeCount = 0;
    private String pendingNotificationUrl = "";
    private Runnable launchCoverFallbackRunnable;
    private BroadcastReceiver updateDownloadReceiver;
    private Runnable updateProgressRunnable;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        getWindow().setBackgroundDrawable(new ColorDrawable(LAUNCH_BACKGROUND_COLOR));
        applyLaunchSystemBars();
        super.onCreate(savedInstanceState);
        installLaunchCover();

        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        applyLaunchSystemBars();

        configureWebViewRuntime();
        installDownloadListener();
        handleNotificationIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST_CODE) {
            dispatchNotificationPermissionEvent(resolveNotificationPermissionState());
        }
    }

    private void applyLaunchSystemBars() {
        Window window = getWindow();
        window.setStatusBarColor(LAUNCH_BACKGROUND_COLOR);
        window.setNavigationBarColor(LAUNCH_BACKGROUND_COLOR);

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }

    private void applyContentSystemBars() {
        Window window = getWindow();
        window.setStatusBarColor(Color.WHITE);
        window.setNavigationBarColor(Color.WHITE);

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);
    }

    private void installLaunchCover() {
        if (launchCover != null) {
            return;
        }

        FrameLayout cover = new FrameLayout(this);
        cover.setBackgroundColor(LAUNCH_BACKGROUND_COLOR);
        cover.setClickable(true);
        ImageView welcomePoster = new ImageView(this);
        welcomePoster.setImageResource(R.drawable.faolla_launch);
        welcomePoster.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.addView(
            welcomePoster,
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        addContentView(
            cover,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        launchCover = cover;
        launchCoverHidden = false;
        scheduleLaunchCoverFallback();
    }

    private void scheduleLaunchCoverFallback() {
        if (launchCoverFallbackRunnable != null) {
            updateProgressHandler.removeCallbacks(launchCoverFallbackRunnable);
        }
        launchCoverFallbackRunnable = () -> hideLaunchCover();
        updateProgressHandler.postDelayed(launchCoverFallbackRunnable, 12000L);
    }

    private void showLaunchCover() {
        applyLaunchSystemBars();
        if (launchCover != null) {
            launchCover.animate().cancel();
            launchCover.setAlpha(1f);
            launchCover.bringToFront();
            launchCoverHidden = false;
            scheduleLaunchCoverFallback();
            return;
        }
        installLaunchCover();
    }

    private void hideLaunchCover() {
        if (launchCoverHidden) {
            return;
        }
        launchCoverHidden = true;
        if (launchCoverFallbackRunnable != null) {
            updateProgressHandler.removeCallbacks(launchCoverFallbackRunnable);
            launchCoverFallbackRunnable = null;
        }

        FrameLayout cover = launchCover;
        if (cover == null) {
            applyContentSystemBars();
            return;
        }
        cover.animate()
            .alpha(0f)
            .setDuration(160L)
            .withEndAction(() -> {
                ViewParent parent = cover.getParent();
                if (parent instanceof ViewGroup) {
                    ((ViewGroup) parent).removeView(cover);
                }
                if (launchCover == cover) {
                    launchCover = null;
                }
                applyContentSystemBars();
            })
            .start();
    }

    private void configureWebViewRuntime() {
        if (this.bridge == null || this.bridge.getWebView() == null) {
            return;
        }

        WebView webView = this.bridge.getWebView();
        webView.setBackgroundColor(LAUNCH_BACKGROUND_COLOR);
        webView.setLayerType(WebView.LAYER_TYPE_HARDWARE, null);

        WebSettings settings = webView.getSettings();
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            settings.setOffscreenPreRaster(true);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            settings.setAlgorithmicDarkeningAllowed(false);
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(webView, true);
        }
    }

    private void installDownloadListener() {
        if (this.bridge == null || this.bridge.getWebView() == null) {
            return;
        }

        this.bridge.getWebView().addJavascriptInterface(new FaollaUpdateBridge(), "FaollaNativeUpdates");
        this.bridge.getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            long downloadId = enqueueUpdateDownload(url, userAgent, contentDisposition, mimeType, true);
            if (downloadId < 0) {
                openUrlInCurrentApp(url);
            }
        });
    }

    @Override
    public void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    public void onStop() {
        CookieManager.getInstance().flush();
        super.onStop();
    }

    @Override
    public void onResume() {
        super.onResume();
        configureWebViewRuntime();
        if (updateInstallStarted && pendingUpdateApkUri != null) {
            updateInstallStarted = false;
            dispatchUpdateEvent("downloaded", 100, "");
        }
    }

    @Override
    public void onDestroy() {
        if (launchCoverFallbackRunnable != null) {
            updateProgressHandler.removeCallbacks(launchCoverFallbackRunnable);
            launchCoverFallbackRunnable = null;
        }
        stopUpdateProgressPolling();
        if (updateDownloadReceiver != null) {
            try {
                unregisterReceiver(updateDownloadReceiver);
            } catch (IllegalArgumentException ignored) {
                // Receiver was already unregistered.
            }
            updateDownloadReceiver = null;
        }
        super.onDestroy();
    }

    private long enqueueUpdateDownload(
        String url,
        String userAgent,
        String contentDisposition,
        String mimeType,
        boolean openInstallerAfterDownload
    ) {
        try {
            String resolvedMimeType = (mimeType == null || mimeType.trim().isEmpty()) ? APK_MIME_TYPE : mimeType;
            String fileName = URLUtil.guessFileName(url, contentDisposition, resolvedMimeType);
            if (fileName == null || !fileName.toLowerCase().endsWith(".apk")) {
                fileName = "faolla-android.apk";
            }
            fileName = System.currentTimeMillis() + "-" + fileName;

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Faolla update");
            request.setDescription("Downloading update package");
            request.setMimeType(resolvedMimeType);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(true);

            if (userAgent != null && !userAgent.trim().isEmpty()) {
                request.addRequestHeader("User-Agent", userAgent);
            }
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null && !cookies.trim().isEmpty()) {
                request.addRequestHeader("Cookie", cookies);
            }

            DownloadManager downloadManager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (downloadManager == null) {
                return -1L;
            }

            long downloadId = downloadManager.enqueue(request);
            pendingUpdateDownloadId = downloadId;
            pendingUpdateApkUri = null;
            pendingUpdateAutoInstall = openInstallerAfterDownload;
            updateInstallStarted = false;
            registerUpdateDownloadReceiver();
            return downloadId;
        } catch (Exception ignored) {
            return -1L;
        }
    }

    private void registerUpdateDownloadReceiver() {
        if (updateDownloadReceiver != null) {
            return;
        }
        updateDownloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long completedDownloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
                if (completedDownloadId != pendingUpdateDownloadId) {
                    return;
                }
                handleUpdateDownloadCompleted(completedDownloadId);
            }
        };

        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(updateDownloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(updateDownloadReceiver, filter);
        }
    }

    private void handleUpdateDownloadCompleted(long downloadId) {
        stopUpdateProgressPolling();
        pendingUpdateDownloadId = -1L;
        Uri apkUri = getDownloadedUpdateUri(downloadId);
        if (apkUri == null) {
            dispatchUpdateEvent("failed", 0, "下载失败，请重试。");
            Toast.makeText(this, "Faolla update download failed", Toast.LENGTH_LONG).show();
            return;
        }

        pendingUpdateApkUri = apkUri;
        if (pendingUpdateAutoInstall) {
            dispatchUpdateEvent("installing", 100, "");
            boolean opened = openApkInstaller(apkUri);
            updateInstallStarted = opened;
            if (!opened) {
                dispatchUpdateEvent("downloaded", 100, "安装包已下载，请允许安装后再点安装更新。");
            }
            return;
        }

        dispatchUpdateEvent("downloaded", 100, "");
    }

    private Uri getDownloadedUpdateUri(long downloadId) {
        DownloadManager downloadManager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (downloadManager == null) {
            return null;
        }

        int status = DownloadManager.STATUS_FAILED;
        try (Cursor cursor = downloadManager.query(new DownloadManager.Query().setFilterById(downloadId))) {
            if (cursor != null && cursor.moveToFirst()) {
                int statusColumn = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
                if (statusColumn >= 0) {
                    status = cursor.getInt(statusColumn);
                }
            }
        } catch (Exception ignored) {
            status = DownloadManager.STATUS_FAILED;
        }

        if (status != DownloadManager.STATUS_SUCCESSFUL) {
            return null;
        }
        return downloadManager.getUriForDownloadedFile(downloadId);
    }

    private void startUpdateProgressPolling(long downloadId) {
        stopUpdateProgressPolling();
        updateProgressRunnable = new Runnable() {
            @Override
            public void run() {
                DownloadManager downloadManager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (downloadManager == null) {
                    dispatchUpdateEvent("failed", 0, "下载服务不可用。");
                    stopUpdateProgressPolling();
                    return;
                }

                try (Cursor cursor = downloadManager.query(new DownloadManager.Query().setFilterById(downloadId))) {
                    if (cursor == null || !cursor.moveToFirst()) {
                        dispatchUpdateEvent("failed", 0, "下载任务不存在。");
                        stopUpdateProgressPolling();
                        return;
                    }

                    int status = readDownloadInt(cursor, DownloadManager.COLUMN_STATUS, DownloadManager.STATUS_FAILED);
                    long downloaded = readDownloadLong(cursor, DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR, 0L);
                    long total = readDownloadLong(cursor, DownloadManager.COLUMN_TOTAL_SIZE_BYTES, -1L);
                    int progress = total > 0L ? Math.round((downloaded * 100f) / total) : 0;
                    progress = Math.max(0, Math.min(99, progress));

                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        pendingUpdateApkUri = getDownloadedUpdateUri(downloadId);
                        dispatchUpdateEvent("downloaded", 100, "");
                        stopUpdateProgressPolling();
                        return;
                    }

                    if (status == DownloadManager.STATUS_FAILED) {
                        dispatchUpdateEvent("failed", 0, "下载失败，请重试。");
                        stopUpdateProgressPolling();
                        return;
                    }

                    dispatchUpdateEvent("downloading", progress, "");
                    updateProgressHandler.postDelayed(this, 500L);
                } catch (Exception ignored) {
                    dispatchUpdateEvent("failed", 0, "下载失败，请重试。");
                    stopUpdateProgressPolling();
                }
            }
        };
        updateProgressHandler.post(updateProgressRunnable);
    }

    private void stopUpdateProgressPolling() {
        if (updateProgressRunnable != null) {
            updateProgressHandler.removeCallbacks(updateProgressRunnable);
            updateProgressRunnable = null;
        }
    }

    private int readDownloadInt(Cursor cursor, String columnName, int fallback) {
        int columnIndex = cursor.getColumnIndex(columnName);
        return columnIndex >= 0 ? cursor.getInt(columnIndex) : fallback;
    }

    private long readDownloadLong(Cursor cursor, String columnName, long fallback) {
        int columnIndex = cursor.getColumnIndex(columnName);
        return columnIndex >= 0 ? cursor.getLong(columnIndex) : fallback;
    }

    private boolean openApkInstaller(Uri apkUri) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            settingsIntent.setData(Uri.parse("package:" + getPackageName()));
            settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(settingsIntent);
            Toast.makeText(this, "Allow Faolla to install updates, then tap Install update", Toast.LENGTH_LONG).show();
            return false;
        }

        try {
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, APK_MIME_TYPE);
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(installIntent);
            return true;
        } catch (ActivityNotFoundException ignored) {
            dispatchUpdateEvent("failed", 0, "没有找到可用的安装器。");
            Toast.makeText(this, "No installer found for Faolla update", Toast.LENGTH_LONG).show();
            return false;
        }
    }

    private void dispatchUpdateEvent(String status, int progress, String message) {
        if (this.bridge == null || this.bridge.getWebView() == null) {
            return;
        }

        try {
            JSONObject detail = new JSONObject();
            detail.put("status", status);
            detail.put("progress", Math.max(0, Math.min(100, progress)));
            if (message != null && !message.trim().isEmpty()) {
                detail.put("message", message);
            }
            String script =
                "window.dispatchEvent(new CustomEvent('faolla-native-update',{detail:" + detail.toString() + "}));";
            WebView webView = this.bridge.getWebView();
            webView.post(() -> webView.evaluateJavascript(script, null));
        } catch (Exception ignored) {
            // The web layer will keep its current state if event dispatch fails.
        }
    }

    private boolean hasPostNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return true;
        }
        return ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private String resolveNotificationPermissionState() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return "granted";
        }
        return hasPostNotificationPermission() ? "granted" : "default";
    }

    private void requestNativeNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || hasPostNotificationPermission()) {
            dispatchNotificationPermissionEvent(resolveNotificationPermissionState());
            return;
        }
        ActivityCompat.requestPermissions(
            this,
            new String[] { Manifest.permission.POST_NOTIFICATIONS },
            NOTIFICATION_PERMISSION_REQUEST_CODE
        );
    }

    private void dispatchNotificationPermissionEvent(String permission) {
        if (this.bridge == null || this.bridge.getWebView() == null) {
            return;
        }

        try {
            JSONObject detail = new JSONObject();
            detail.put("permission", permission);
            String script =
                "window.dispatchEvent(new CustomEvent('faolla-native-notification-permission',{detail:" +
                    detail.toString() +
                    "}));";
            WebView webView = this.bridge.getWebView();
            webView.post(() -> webView.evaluateJavascript(script, null));
        } catch (Exception ignored) {
            // The web layer will retry permission checks when settings are opened again.
        }
    }

    private void ensureNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager notificationManager = getSystemService(NotificationManager.class);
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

    private String readJsonString(JSONObject json, String key, String fallback) {
        String value = json.optString(key, fallback);
        if (value == null || value.trim().isEmpty()) {
            return fallback;
        }
        return value.trim();
    }

    private int readJsonInt(JSONObject json, String key, int fallback) {
        int value = json.optInt(key, fallback);
        return Math.max(0, Math.min(999, value));
    }

    private boolean readJsonBoolean(JSONObject json, String key, boolean fallback) {
        return json.has(key) ? json.optBoolean(key, fallback) : fallback;
    }

    private PendingIntent buildNotificationPendingIntent(String url, int requestCode) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setAction(NOTIFICATION_ACTION_OPEN);
        intent.putExtra(NOTIFICATION_EXTRA_URL, url);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(this, requestCode, intent, flags);
    }

    private String resolveNotificationUrl(String rawUrl) {
        String trimmedUrl = rawUrl == null ? "" : rawUrl.trim();
        if (trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://")) {
            return trimmedUrl;
        }

        String origin = "https://www.faolla.com";
        try {
            WebView webView = this.bridge == null ? null : this.bridge.getWebView();
            String currentUrl = webView == null ? "" : webView.getUrl();
            if (currentUrl != null && !currentUrl.trim().isEmpty()) {
                Uri currentUri = Uri.parse(currentUrl);
                if (currentUri.getScheme() != null && currentUri.getAuthority() != null) {
                    origin = currentUri.getScheme() + "://" + currentUri.getAuthority();
                }
            }
        } catch (Exception ignored) {
            origin = "https://www.faolla.com";
        }

        String path = trimmedUrl.startsWith("/") ? trimmedUrl : "/" + trimmedUrl;
        if (!path.contains("appShell=")) {
            path += path.contains("?") ? "&appShell=faolla" : "?appShell=faolla";
        }
        return origin + path;
    }

    private void handleNotificationIntent(Intent intent) {
        if (intent == null || !NOTIFICATION_ACTION_OPEN.equals(intent.getAction())) {
            return;
        }
        String targetUrl = resolveNotificationUrl(intent.getStringExtra(NOTIFICATION_EXTRA_URL));
        pendingNotificationUrl = targetUrl;
        schedulePendingNotificationOpen(targetUrl, 160L);
        schedulePendingNotificationOpen(targetUrl, 800L);
        schedulePendingNotificationOpen(targetUrl, 1800L);
    }

    private void schedulePendingNotificationOpen(String targetUrl, long delayMs) {
        updateProgressHandler.postDelayed(() -> {
            if (targetUrl == null || targetUrl.trim().isEmpty()) {
                return;
            }
            if (!targetUrl.equals(pendingNotificationUrl)) {
                return;
            }
            WebView webView = this.bridge == null ? null : this.bridge.getWebView();
            if (webView == null) {
                return;
            }
            String currentUrl = webView.getUrl();
            if (targetUrl.equals(currentUrl)) {
                pendingNotificationUrl = "";
                return;
            }
            openUrlInCurrentApp(targetUrl);
        }, delayMs);
    }

    @SuppressWarnings("deprecation")
    private void vibrateForNativeNotification() {
        try {
            Vibrator vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null) {
                return;
            }
            long[] pattern = new long[] { 0L, 120L, 70L, 160L };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
            } else {
                vibrator.vibrate(pattern, -1);
            }
        } catch (Exception ignored) {
            // Vibration is best-effort.
        }
    }

    private void showNativeMessageNotification(String payloadJson) {
        JSONObject payload;
        try {
            payload = new JSONObject(payloadJson == null ? "{}" : payloadJson);
        } catch (Exception ignored) {
            payload = new JSONObject();
        }

        String title = readJsonString(payload, "title", "Faolla");
        String body = readJsonString(payload, "body", "New Faolla message");
        String url = resolveNotificationUrl(readJsonString(payload, "url", "/launch?appShell=faolla"));
        int unreadCount = readJsonInt(payload, "badgeCount", nativeUnreadBadgeCount);
        boolean soundEnabled = readJsonBoolean(payload, "sound", true);
        boolean vibrationEnabled = readJsonBoolean(payload, "vibrate", true);

        storeNativeUnreadBadgeCount(unreadCount);
        if (vibrationEnabled) {
            vibrateForNativeNotification();
        }
        if (!hasPostNotificationPermission()) {
            return;
        }

        ensureNotificationChannels();
        cancelNativeBadgeSummaryNotification();
        Uri defaultSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        int serial = messageNotificationSerial++ % 900;
        int notificationId = MESSAGE_NOTIFICATION_BASE_ID + serial;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, MESSAGE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_faolla)
            .setColor(Color.rgb(8, 17, 33))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(buildNotificationPendingIntent(url, notificationId))
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .setNumber(unreadCount);
        if (soundEnabled) {
            builder.setSound(defaultSound);
        } else {
            builder.setSilent(true);
        }
        if (vibrationEnabled) {
            builder.setVibrate(new long[] { 0L, 120L, 70L, 160L });
        } else {
            builder.setVibrate(new long[] { 0L });
        }
        NotificationManagerCompat.from(this).notify(notificationId, builder.build());
    }

    private String resolveCurrentOrigin() {
        try {
            WebView webView = this.bridge == null ? null : this.bridge.getWebView();
            String currentUrl = webView == null ? "" : webView.getUrl();
            if (currentUrl != null && !currentUrl.trim().isEmpty()) {
                Uri currentUri = Uri.parse(currentUrl);
                if (currentUri.getScheme() != null && currentUri.getAuthority() != null) {
                    return currentUri.getScheme() + "://" + currentUri.getAuthority();
                }
            }
        } catch (Exception ignored) {
        }
        return "https://www.faolla.com";
    }

    private String normalizeOrigin(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
            return normalized;
        }
        return resolveCurrentOrigin();
    }

    private void configureNativeNotificationSync(String payloadJson) {
        JSONObject payload;
        try {
            payload = new JSONObject(payloadJson == null ? "{}" : payloadJson);
        } catch (Exception ignored) {
            payload = new JSONObject();
        }

        boolean enabled = readJsonBoolean(payload, "enabled", true);
        int unreadCount = readJsonInt(payload, "unreadCount", nativeUnreadBadgeCount);
        nativeUnreadBadgeCount = unreadCount;

        android.content.SharedPreferences prefs = FaollaNotificationWorker.getPrefs(this);
        if (!enabled) {
            prefs.edit()
                .putBoolean(FaollaNotificationWorker.KEY_ENABLED, false)
                .putBoolean(FaollaNotificationWorker.KEY_INITIALIZED, false)
                .putInt(FaollaNotificationWorker.KEY_UNREAD_COUNT, 0)
                .apply();
            FaollaNotificationWorker.cancel(this);
            syncNativeUnreadBadge(0);
            return;
        }

        String baseUrl = normalizeOrigin(readJsonString(payload, "baseUrl", resolveCurrentOrigin()));
        String cookieHeader = CookieManager.getInstance().getCookie(baseUrl);
        if (cookieHeader == null || cookieHeader.trim().isEmpty()) {
            cookieHeader = CookieManager.getInstance().getCookie(resolveCurrentOrigin());
        }
        if (cookieHeader == null) {
            cookieHeader = "";
        }
        CookieManager.getInstance().flush();

        String latestNotificationKey = readJsonString(payload, "latestNotificationKey", "");
        android.content.SharedPreferences.Editor editor = prefs.edit()
            .putBoolean(FaollaNotificationWorker.KEY_ENABLED, true)
            .putString(FaollaNotificationWorker.KEY_BASE_URL, baseUrl)
            .putString(FaollaNotificationWorker.KEY_SITE_ID, readJsonString(payload, "siteId", ""))
            .putString(FaollaNotificationWorker.KEY_MERCHANT_EMAIL, readJsonString(payload, "merchantEmail", ""))
            .putString(FaollaNotificationWorker.KEY_MERCHANT_NAME, readJsonString(payload, "merchantName", ""))
            .putString(FaollaNotificationWorker.KEY_OFFICIAL_LAST_READ_AT, readJsonString(payload, "officialLastReadAt", ""))
            .putString(FaollaNotificationWorker.KEY_PEER_LAST_READ_JSON, payload.optString("peerLastRead", "{}"))
            .putString(FaollaNotificationWorker.KEY_COOKIE_HEADER, cookieHeader)
            .putBoolean(FaollaNotificationWorker.KEY_SOUND, readJsonBoolean(payload, "sound", true))
            .putBoolean(FaollaNotificationWorker.KEY_VIBRATE, readJsonBoolean(payload, "vibrate", true))
            .putInt(FaollaNotificationWorker.KEY_UNREAD_COUNT, unreadCount)
            .putBoolean(FaollaNotificationWorker.KEY_INITIALIZED, true)
            .putString(FaollaNotificationWorker.KEY_LAST_NOTIFICATION_KEY, latestNotificationKey);
        editor.apply();

        if (unreadCount > 0) {
            syncNativeUnreadBadge(unreadCount);
        } else {
            syncNativeUnreadBadge(0);
        }
        FaollaNotificationWorker.scheduleNow(this);
    }

    private void syncNativeUnreadBadge(int unreadCount) {
        storeNativeUnreadBadgeCount(unreadCount);
        if (!hasPostNotificationPermission()) {
            return;
        }

        NotificationManagerCompat notificationManager = NotificationManagerCompat.from(this);
        if (nativeUnreadBadgeCount <= 0) {
            notificationManager.cancelAll();
            return;
        }

        ensureNotificationChannels();
        String body = nativeUnreadBadgeCount + " unread messages";
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, BADGE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_faolla)
            .setColor(Color.rgb(8, 17, 33))
            .setContentTitle("Faolla")
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setAutoCancel(false)
            .setContentIntent(buildNotificationPendingIntent("/launch?appShell=faolla", BADGE_NOTIFICATION_ID))
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .setNumber(nativeUnreadBadgeCount);
        notificationManager.notify(BADGE_NOTIFICATION_ID, builder.build());
    }

    private void storeNativeUnreadBadgeCount(int unreadCount) {
        nativeUnreadBadgeCount = Math.max(0, Math.min(999, unreadCount));
        FaollaNotificationWorker.getPrefs(this)
            .edit()
            .putInt(FaollaNotificationWorker.KEY_UNREAD_COUNT, nativeUnreadBadgeCount)
            .apply();
    }

    private void cancelNativeBadgeSummaryNotification() {
        try {
            NotificationManagerCompat.from(this).cancel(BADGE_NOTIFICATION_ID);
        } catch (Exception ignored) {
            // Badge summary cleanup is best-effort.
        }
    }

    private void openUrlInCurrentApp(String url) {
        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView webView = this.bridge.getWebView();
            webView.post(() -> webView.loadUrl(url));
        }
    }

    private class FaollaUpdateBridge {
        @JavascriptInterface
        public void hideLaunchCover() {
            runOnUiThread(() -> MainActivity.this.hideLaunchCover());
        }

        @JavascriptInterface
        public void showLaunchCover() {
            runOnUiThread(() -> MainActivity.this.showLaunchCover());
        }

        @JavascriptInterface
        public String getNotificationPermissionState() {
            return resolveNotificationPermissionState();
        }

        @JavascriptInterface
        public String requestNotificationPermission() {
            String currentState = resolveNotificationPermissionState();
            runOnUiThread(() -> MainActivity.this.requestNativeNotificationPermission());
            return currentState;
        }

        @JavascriptInterface
        public void showMessageNotification(String payloadJson) {
            runOnUiThread(() -> MainActivity.this.showNativeMessageNotification(payloadJson));
        }

        @JavascriptInterface
        public void syncUnreadBadge(int unreadCount) {
            runOnUiThread(() -> MainActivity.this.syncNativeUnreadBadge(unreadCount));
        }

        @JavascriptInterface
        public void configureNotificationSync(String payloadJson) {
            runOnUiThread(() -> MainActivity.this.configureNativeNotificationSync(payloadJson));
        }

        @JavascriptInterface
        public void downloadUpdate(String url) {
            runOnUiThread(() -> {
                long downloadId = enqueueUpdateDownload(
                    url,
                    null,
                    "attachment; filename=\"faolla-android.apk\"",
                    APK_MIME_TYPE,
                    false
                );
                if (downloadId < 0) {
                    dispatchUpdateEvent("failed", 0, "下载失败，请重试。");
                    return;
                }
                dispatchUpdateEvent("download-started", 0, "");
                startUpdateProgressPolling(downloadId);
            });
        }

        @JavascriptInterface
        public void installDownloadedUpdate() {
            runOnUiThread(() -> {
                if (pendingUpdateApkUri == null) {
                    dispatchUpdateEvent("failed", 0, "安装包不存在，请重新下载。");
                    return;
                }
                dispatchUpdateEvent("installing", 100, "");
                boolean opened = openApkInstaller(pendingUpdateApkUri);
                updateInstallStarted = opened;
                if (!opened) {
                    dispatchUpdateEvent("downloaded", 100, "安装包已下载，请允许安装后再点安装更新。");
                }
            });
        }

        @JavascriptInterface
        public void downloadAndInstall(String url) {
            runOnUiThread(() -> {
                long downloadId = enqueueUpdateDownload(
                    url,
                    null,
                    "attachment; filename=\"faolla-android.apk\"",
                    APK_MIME_TYPE,
                    true
                );
                if (downloadId < 0) {
                    dispatchUpdateEvent("failed", 0, "下载失败，请重试。");
                    return;
                }
                dispatchUpdateEvent("download-started", 0, "");
                startUpdateProgressPolling(downloadId);
            });
        }
    }
}
