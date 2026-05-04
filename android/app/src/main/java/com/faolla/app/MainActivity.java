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
import android.provider.Settings;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.widget.Toast;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";
    private long pendingUpdateDownloadId = -1L;
    private BroadcastReceiver updateDownloadReceiver;

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

        installDownloadListener();
    }

    private void installDownloadListener() {
        if (this.bridge == null || this.bridge.getWebView() == null) {
            return;
        }

        this.bridge.getWebView().addJavascriptInterface(new FaollaUpdateBridge(), "FaollaNativeUpdates");
        this.bridge.getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            enqueueUpdateDownload(url, userAgent, contentDisposition, mimeType, true);
        });
    }

    @Override
    public void onDestroy() {
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

    private void enqueueUpdateDownload(
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
                openUrlInCurrentApp(url);
                return;
            }

            long downloadId = downloadManager.enqueue(request);
            if (openInstallerAfterDownload) {
                pendingUpdateDownloadId = downloadId;
                registerUpdateDownloadReceiver();
            }
            Toast.makeText(this, "Faolla update downloading", Toast.LENGTH_LONG).show();
        } catch (Exception ignored) {
            openUrlInCurrentApp(url);
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
                pendingUpdateDownloadId = -1L;
                openDownloadedUpdate(completedDownloadId);
            }
        };

        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(updateDownloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(updateDownloadReceiver, filter);
        }
    }

    private void openDownloadedUpdate(long downloadId) {
        DownloadManager downloadManager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (downloadManager == null) {
            return;
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
            Toast.makeText(this, "Faolla update download failed", Toast.LENGTH_LONG).show();
            return;
        }

        Uri apkUri = downloadManager.getUriForDownloadedFile(downloadId);
        if (apkUri == null) {
            Toast.makeText(this, "Faolla update package not found", Toast.LENGTH_LONG).show();
            return;
        }

        openApkInstaller(apkUri);
    }

    private void openApkInstaller(Uri apkUri) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            settingsIntent.setData(Uri.parse("package:" + getPackageName()));
            settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(settingsIntent);
            Toast.makeText(this, "Allow Faolla to install updates, then tap Download update again", Toast.LENGTH_LONG).show();
            return;
        }

        try {
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, APK_MIME_TYPE);
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(installIntent);
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, "No installer found for Faolla update", Toast.LENGTH_LONG).show();
        }
    }

    private void openUrlInCurrentApp(String url) {
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().loadUrl(url);
        }
    }

    private class FaollaUpdateBridge {
        @JavascriptInterface
        public void downloadAndInstall(String url) {
            runOnUiThread(() -> enqueueUpdateDownload(url, null, "attachment; filename=\"faolla-android.apk\"", APK_MIME_TYPE, true));
        }
    }
}
