package com.faolla.app;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";
    private final Handler updateProgressHandler = new Handler(Looper.getMainLooper());
    private long pendingUpdateDownloadId = -1L;
    private Uri pendingUpdateApkUri;
    private boolean pendingUpdateAutoInstall = false;
    private boolean updateInstallStarted = false;
    private BroadcastReceiver updateDownloadReceiver;
    private Runnable updateProgressRunnable;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, true);
        window.setStatusBarColor(Color.WHITE);
        window.setNavigationBarColor(Color.WHITE);

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);

        configureWebViewRuntime();
        installDownloadListener();
    }

    private void configureWebViewRuntime() {
        if (this.bridge == null || this.bridge.getWebView() == null) {
            return;
        }

        WebView webView = this.bridge.getWebView();
        webView.setBackgroundColor(Color.rgb(8, 17, 33));

        WebSettings settings = webView.getSettings();
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

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
        CookieManager.getInstance().flush();
        if (updateInstallStarted && pendingUpdateApkUri != null) {
            updateInstallStarted = false;
            dispatchUpdateEvent("downloaded", 100, "");
        }
    }

    @Override
    public void onDestroy() {
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

    private void openUrlInCurrentApp(String url) {
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().loadUrl(url);
        }
    }

    private class FaollaUpdateBridge {
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
