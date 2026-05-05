package com.faolla.app;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import me.leolin.shortcutbadger.ShortcutBadger;

final class FaollaLauncherBadge {
    private FaollaLauncherBadge() {}

    static void applyCount(Context context, int unreadCount) {
        int count = normalizeCount(unreadCount);
        Context appContext = context.getApplicationContext();
        try {
            if (count > 0) {
                ShortcutBadger.applyCount(appContext, count);
            } else {
                ShortcutBadger.removeCount(appContext);
            }
        } catch (Exception ignored) {
            // Launcher badge support varies by Android vendor.
        }

        applyXiaomiBroadcast(appContext, count);
        applyVivoBroadcast(appContext, count);
        applyOppoBroadcast(appContext, count);
        applyHuaweiProvider(appContext, count);
    }

    static Notification withBadgeCount(Notification notification, int unreadCount) {
        int count = normalizeCount(unreadCount);
        try {
            notification.number = count;
        } catch (Exception ignored) {
            // Deprecated on newer Android versions, but still useful on some launchers.
        }
        applyXiaomiNotificationBadge(notification, count);
        return notification;
    }

    private static int normalizeCount(int unreadCount) {
        return Math.max(0, Math.min(999, unreadCount));
    }

    private static ComponentName resolveLauncherComponent(Context context) {
        try {
            PackageManager packageManager = context.getPackageManager();
            Intent launchIntent = packageManager.getLaunchIntentForPackage(context.getPackageName());
            ComponentName componentName = launchIntent == null ? null : launchIntent.getComponent();
            if (componentName != null) return componentName;
        } catch (Exception ignored) {
            // Fall through to the known app activity.
        }
        return new ComponentName(context.getPackageName(), context.getPackageName() + ".MainActivity");
    }

    private static void applyXiaomiNotificationBadge(Notification notification, int count) {
        try {
            Object extraNotification = notification.getClass().getDeclaredField("extraNotification").get(notification);
            extraNotification
                .getClass()
                .getDeclaredMethod("setMessageCount", int.class)
                .invoke(extraNotification, count);
        } catch (Exception ignored) {
            // Only MIUI exposes this private API.
        }
    }

    private static void applyXiaomiBroadcast(Context context, int count) {
        try {
            ComponentName componentName = resolveLauncherComponent(context);
            Intent intent = new Intent("android.intent.action.APPLICATION_MESSAGE_UPDATE");
            intent.putExtra(
                "android.intent.extra.update_application_component_name",
                componentName.getPackageName() + "/" + componentName.getClassName()
            );
            intent.putExtra("android.intent.extra.update_application_message_text", count > 0 ? String.valueOf(count) : "");
            context.sendBroadcast(intent);
        } catch (Exception ignored) {
            // Best-effort vendor badge update.
        }
    }

    private static void applyVivoBroadcast(Context context, int count) {
        try {
            ComponentName componentName = resolveLauncherComponent(context);
            Intent intent = new Intent("launcher.action.CHANGE_APPLICATION_NOTIFICATION_NUM");
            intent.putExtra("packageName", componentName.getPackageName());
            intent.putExtra("className", componentName.getClassName());
            intent.putExtra("notificationNum", count);
            context.sendBroadcast(intent);
        } catch (Exception ignored) {
            // Best-effort vendor badge update.
        }
    }

    private static void applyOppoBroadcast(Context context, int count) {
        try {
            Intent intent = new Intent("com.oppo.unsettledevent");
            intent.putExtra("pakeageName", context.getPackageName());
            intent.putExtra("number", count);
            intent.putExtra("upgradeNumber", count);
            context.sendBroadcast(intent);
        } catch (Exception ignored) {
            // Best-effort vendor badge update.
        }
    }

    private static void applyHuaweiProvider(Context context, int count) {
        try {
            ComponentName componentName = resolveLauncherComponent(context);
            Bundle bundle = new Bundle();
            bundle.putString("package", componentName.getPackageName());
            bundle.putString("class", componentName.getClassName());
            bundle.putInt("badgenumber", count);
            context
                .getContentResolver()
                .call(Uri.parse("content://com.huawei.android.launcher.settings/badge/"), "change_badge", null, bundle);
        } catch (Exception ignored) {
            // Best-effort vendor badge update.
        }
    }
}
