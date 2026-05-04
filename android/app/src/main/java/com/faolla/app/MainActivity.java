package com.faolla.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.widget.Toast;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
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

        this.bridge.getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                String resolvedMimeType = (mimeType == null || mimeType.trim().isEmpty())
                    ? "application/vnd.android.package-archive"
                    : mimeType;
                String fileName = URLUtil.guessFileName(url, contentDisposition, resolvedMimeType);
                if (fileName == null || !fileName.toLowerCase().endsWith(".apk")) {
                    fileName = "faolla-android.apk";
                }

                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setTitle(fileName);
                request.setDescription("Faolla update package");
                request.setMimeType(resolvedMimeType);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

                if (userAgent != null && !userAgent.trim().isEmpty()) {
                    request.addRequestHeader("User-Agent", userAgent);
                }
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null && !cookies.trim().isEmpty()) {
                    request.addRequestHeader("Cookie", cookies);
                }

                DownloadManager downloadManager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (downloadManager != null) {
                    downloadManager.enqueue(request);
                    Toast.makeText(this, "Faolla update download started", Toast.LENGTH_LONG).show();
                    return;
                }
            } catch (Exception ignored) {
                // Fall through to the browser intent below.
            }

            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        });
    }
}
