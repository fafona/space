package com.faolla.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

public class FaollaBadgeRestoreReceiver extends BroadcastReceiver {
    private static final String ACTION_RESTORE_BADGE = "com.faolla.app.RESTORE_BADGE";
    private static final long[] RESTORE_DELAYS_MS = new long[] { 120L, 400L, 1200L, 3500L, 8000L, 15000L, 30000L };

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null || !ACTION_RESTORE_BADGE.equals(intent.getAction())) {
            return;
        }
        FaollaNotificationWorker.restoreStoredBadge(context);
    }

    static void schedule(Context context) {
        if (context == null) return;
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        Context appContext = context.getApplicationContext();
        for (int index = 0; index < RESTORE_DELAYS_MS.length; index += 1) {
            Intent intent = new Intent(appContext, FaollaBadgeRestoreReceiver.class);
            intent.setAction(ACTION_RESTORE_BADGE);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                appContext,
                74000 + index,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            long triggerAt = SystemClock.elapsedRealtime() + RESTORE_DELAYS_MS[index];
            alarmManager.cancel(pendingIntent);
            alarmManager.set(AlarmManager.ELAPSED_REALTIME, triggerAt, pendingIntent);
        }
    }
}
