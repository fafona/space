package com.faolla.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class FaollaNotificationBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }
        String action = intent.getAction();
        boolean shouldRestore =
            Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            Intent.ACTION_MY_PACKAGE_REPLACED.equals(action) ||
            "android.intent.action.QUICKBOOT_POWERON".equals(action);
        if (!shouldRestore || !FaollaNotificationWorker.isEnabled(context)) {
            return;
        }
        FaollaNotificationWorker.restoreStoredBadge(context);
        FaollaNotificationWorker.scheduleNow(context);
    }
}
