package com.faolla.app;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import me.leolin.shortcutbadger.ShortcutBadger;

final class FaollaLauncherBadge {
    private FaollaLauncherBadge() {}

    static boolean applyCount(Context context, int unreadCount) {
        int count = normalizeCount(unreadCount);
        Context appContext = context.getApplicationContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && count > 0) {
            // Android 8+ launchers derive badges from one active notification on a
            // showBadge channel. Returning false keeps that notification as the
            // single badge source instead of mixing it with vendor badge writes.
            return false;
        }
        boolean applied = false;
        try {
            if (count > 0) {
                applied = ShortcutBadger.applyCount(appContext, count);
            } else {
                applied = ShortcutBadger.removeCount(appContext);
            }
        } catch (Exception ignored) {
            // Launcher badge support varies by Android vendor.
        }

        String maker = ((Build.MANUFACTURER == null ? "" : Build.MANUFACTURER) +
            " " +
            (Build.BRAND == null ? "" : Build.BRAND)).toLowerCase();
        if (maker.contains("xiaomi") || maker.contains("redmi") || maker.contains("poco")) {
            applied = applyXiaomiBroadcast(appContext, count) || applied;
        }
        if (maker.contains("vivo")) {
            applied = applyVivoBroadcast(appContext, count) || applied;
        }
        if (maker.contains("oppo") || maker.contains("realme") || maker.contains("oneplus")) {
            applied = applyOppoBroadcast(appContext, count) || applied;
        }
        if (maker.contains("huawei") || maker.contains("honor")) {
            applied = applyHuaweiProvider(appContext, count) || applied;
        }
        return applied;
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

    private static boolean applyXiaomiBroadcast(Context context, int count) {
        try {
            ComponentName componentName = resolveLauncherComponent(context);
            Intent intent = new Intent("android.intent.action.APPLICATION_MESSAGE_UPDATE");
            intent.putExtra(
                "android.intent.extra.update_application_component_name",
                componentName.getPackageName() + "/" + componentName.getClassName()
            );
            intent.putExtra("android.intent.extra.update_application_message_text", count > 0 ? String.valueOf(count) : "");
            context.sendBroadcast(intent);
            return true;
        } catch (Exception ignored) {
            // Best-effort vendor badge update.
        }
        return false;
    }

    private static boolean applyVivoBroadcast(Context context, int count) {
        try {
            ComponentName componentName = resolveLauncherComponent(context);
            Intent intent = new Intent("launcher.action.CHANGE_APPLICATION_NOTIFICATION_NUM");
            intent.putExtra("packageName", componentName.getPackageName());
            intent.putExtra("className", componentName.getClassName());
            intent.putExtra("notificationNum", count);
            context.sendBroadcast(intent);
            return true;
        } catch (Exception ignored) {
            // Best-effort vendor badge update.
        }
        return false;
    }

    private static boolean applyOppoBroadcast(Context context, int count) {
        try {
            Intent intent = new Intent("com.oppo.unsettledevent");
            intent.putExtra("pakeageName", context.getPackageName());
            intent.putExtra("number", count);
            intent.putExtra("upgradeNumber", count);
            context.sendBroadcast(intent);
            return true;
        } catch (Exception ignored) {
            // Best-effort vendor badge update.
        }
        return false;
    }

    private static boolean applyHuaweiProvider(Context context, int count) {
        try {
            ComponentName componentName = resolveLauncherComponent(context);
            Bundle bundle = new Bundle();
            bundle.putString("package", componentName.getPackageName());
            bundle.putString("class", componentName.getClassName());
            bundle.putInt("badgenumber", count);
            context
                .getContentResolver()
                .call(Uri.parse("content://com.huawei.android.launcher.settings/badge/"), "change_badge", null, bundle);
            return true;
        } catch (Exception ignored) {
            // Best-effort vendor badge update.
        }
        return false;
    }
}
