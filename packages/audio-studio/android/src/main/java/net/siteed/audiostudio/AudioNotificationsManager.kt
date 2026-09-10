package net.siteed.audiostudio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import java.lang.ref.WeakReference
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import java.util.Objects
import net.siteed.audiostudio.LogUtils

class AudioNotificationManager private constructor(context: Context) {
    companion object {
        private const val CLASS_NAME = "AudioNotificationManager"
        private const val WAVEFORM_UPDATE_INTERVAL = 100L
        private const val UPDATE_INTERVAL = 1000L

        @Volatile
        private var instance: AudioNotificationManager? = null

        fun getInstance(context: Context): AudioNotificationManager {
            return instance ?: synchronized(this) {
                instance ?: AudioNotificationManager(context).also { instance = it }
            }
        }
    }
    
    private val contextRef = WeakReference(context.applicationContext)
    private val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private val mainHandler = Handler(Looper.getMainLooper())
    private val isUpdating = AtomicBoolean(false)
    private val isPaused = AtomicBoolean(false)

    private var lastRemoteViewsUpdate = 0L
    private var consecutiveUpdateFailures = 0
    private var lastSuccessfulUpdate: Long = 0
    private val maxUpdateFailures = 3
    private val remoteViewsRefreshInterval = 10000L // Refresh RemoteViews every 10 seconds

    private lateinit var notificationBuilder: NotificationCompat.Builder
    private lateinit var remoteViews: RemoteViews
    private lateinit var recordingConfig: RecordingConfig
    private var recordingStartTime: Long = 0
    private var pausedDuration: Long = 0
    private var lastPauseTime: Long = 0
    private var lastWaveformUpdate: Long = 0
    private val waveformRenderer = WaveformRenderer()
    private var lastNotificationHash: Int? = null

    fun initialize(config: RecordingConfig) {
        recordingConfig = config
        createNotificationChannel()
        initializeNotification()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                recordingConfig.notification.channelId,
                recordingConfig.notification.channelName,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = recordingConfig.notification.channelDescription
                enableLights(false)
                enableVibration(false)
                setSound(null, null)
                setShowBadge(false)
                vibrationPattern = null
            }

            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun initializeNotification() {
        val context = contextRef.get() ?: return
        try {
            remoteViews = RemoteViews(context.packageName, R.layout.notification_recording)
            remoteViews.apply {
                setTextViewText(R.id.notification_title, recordingConfig.notification?.title)
                setTextViewText(R.id.notification_text, recordingConfig.notification?.text)
                setTextViewText(R.id.notification_duration, formatDuration(0))
                setViewVisibility(
                    R.id.notification_waveform,
                    if (recordingConfig.showWaveformInNotification &&
                        recordingConfig.notification?.waveform != null) View.VISIBLE else View.GONE
                )
            }

            buildNotification(context)
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to initialize notification", e)
        }
    }

    private fun buildNotification(context: Context) {
        val iconResId = recordingConfig.notification?.icon?.let {
            getResourceIdByName(it)
        } ?: R.drawable.ic_microphone

        // Configure notification builder with settings optimized for recording service
        // and wearable device compatibility
        notificationBuilder = NotificationCompat.Builder(context, recordingConfig.notification.channelId)
            .setSmallIcon(iconResId)
            .setOngoing(true)  // Notification cannot be dismissed by user
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            // Prevent repeated alerts and vibrations
            .setOnlyAlertOnce(true)  // Only alert on first notification
            .setVibrate(null)        // Disable vibration
            .setDefaults(0)          // Clear all default notification behaviors
            .setLocalOnly(true)      // Prevent notification from appearing on wearable devices

        context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launchIntent ->
            notificationBuilder.setContentIntent(
                PendingIntent.getActivity(
                    context,
                    0,
                    launchIntent,
                    PendingIntent.FLAG_IMMUTABLE
                )
            )
        }

        addNotificationActions(context)
        presentContent(currentDuration())
    }

    private fun currentDuration(): Long {
        if (recordingStartTime == 0L) return 0L
        val duration = if (isPaused.get()) {
            lastPauseTime - recordingStartTime - pausedDuration
        } else {
            System.currentTimeMillis() - recordingStartTime - pausedDuration
        }
        return maxOf(0L, duration)
    }

    /**
     * Puts the title, text and duration on the notification. The custom RemoteViews layout is
     * only used when the waveform is shown: it has no text colour of its own and on Android 12+
     * the collapsed template clips it to a blank row, so without the waveform the standard
     * template carries the same content.
     */
    private fun presentContent(duration: Long) {
        if (recordingConfig.showWaveformInNotification) {
            notificationBuilder
                .setCustomContentView(remoteViews)
                .setCustomBigContentView(remoteViews)
                .setStyle(NotificationCompat.DecoratedCustomViewStyle())
            return
        }
        val text = recordingConfig.notification.text
        val clock = formatDuration(duration)
        notificationBuilder
            .setCustomContentView(null)
            .setCustomBigContentView(null)
            .setStyle(null)
            .setContentTitle(recordingConfig.notification.title)
            .setContentText(if (text.isEmpty()) clock else "$text \u00b7 $clock")
    }

    private fun addNotificationActions(context: Context) {
        // Clear existing actions first
        notificationBuilder.clearActions()

        // Create pause action
        val pauseIntent = Intent(context, RecordingActionReceiver::class.java).apply {
            action = RecordingActionReceiver.ACTION_PAUSE_RECORDING
        }
        val pausePendingIntent = PendingIntent.getBroadcast(
            context,
            0,
            pauseIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Create resume action
        val resumeIntent = Intent(context, RecordingActionReceiver::class.java).apply {
            action = RecordingActionReceiver.ACTION_RESUME_RECORDING
        }
        val resumePendingIntent = PendingIntent.getBroadcast(
            context,
            1,
            resumeIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Add only one pause/resume action based on current state (if enabled)
        if (recordingConfig.notification.showPauseResumeActions) {
            if (isPaused.get()) {
                notificationBuilder.addAction(
                    R.drawable.ic_play,
                    "Resume",
                    resumePendingIntent
                )
            } else {
                notificationBuilder.addAction(
                    R.drawable.ic_pause,
                    "Pause",
                    pausePendingIntent
                )
            }
        }

        // Add configured custom actions (only if they don't already exist)
        val existingActions = mutableSetOf<String>()
        recordingConfig.notification.actions.forEach { action ->
            if (existingActions.add(action.intentAction)) { // Only add if action is unique
                val intent = Intent(context, RecordingActionReceiver::class.java).apply {
                    this.action = action.intentAction
                }
                val pendingIntent = PendingIntent.getBroadcast(
                    context,
                    action.intentAction.hashCode(),
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                val actionIconResId = action.icon?.let { getResourceIdByName(it) }
                    ?: R.drawable.ic_default_action_icon
                notificationBuilder.addAction(actionIconResId, action.title, pendingIntent)
            }
        }
    }

    private fun updateNotificationActions() {
        val context = contextRef.get() ?: return
        try {
            // Clear existing actions
            notificationBuilder.clearActions()
            // Add updated actions
            addNotificationActions(context)

            // Update the notification
            presentContent(currentDuration())
            val updatedNotification = notificationBuilder.build()

            notificationManager.notify(recordingConfig.notification.notificationId, updatedNotification)
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to update notification actions", e)
        }
    }

    fun startUpdates(startTime: Long) {
        recordingStartTime = startTime
        pausedDuration = 0
        isPaused.set(false)
        updateNotificationActions() // Update actions when starting
        if (!isUpdating.getAndSet(true)) {
            scheduleUpdate()
        }
    }

    private fun scheduleUpdate() {
        mainHandler.postDelayed({
            if (isUpdating.get() && !isPaused.get()) {
                updateNotification()
                scheduleUpdate()
            }
        }, UPDATE_INTERVAL)
    }

    fun updateNotification(audioData: FloatArray? = null) {
        val context = contextRef.get() ?: return

        try {
            val currentTime = SystemClock.elapsedRealtime()
            
            // Calculate current notification state
            val recordingDuration = if (isPaused.get()) {
                lastPauseTime - recordingStartTime - pausedDuration
            } else {
                System.currentTimeMillis() - recordingStartTime - pausedDuration
            }
            
            // Create a hash of the current notification state
            val currentHash = Objects.hash(
                recordingConfig.notification.title,
                recordingConfig.notification.text,
                formatDuration(recordingDuration),
                isPaused.get()
            )

            val needsRemoteViewsRefresh = currentTime - lastRemoteViewsUpdate >= remoteViewsRefreshInterval ||
                    consecutiveUpdateFailures >= maxUpdateFailures

            // Only update if content changed or refresh needed
            if (currentHash == lastNotificationHash && !needsRemoteViewsRefresh) {
                // Update waveform only if needed
                if (shouldUpdateWaveform(audioData, currentTime)) {
                    updateWaveformOnly(audioData)
                }
                return
            }

            lastNotificationHash = currentHash

            // Only recreate RemoteViews periodically or after failures
            if (needsRemoteViewsRefresh) {
                remoteViews = RemoteViews(context.packageName, R.layout.notification_recording)
                lastRemoteViewsUpdate = currentTime
                consecutiveUpdateFailures = 0
            }

            // Update RemoteViews content
            remoteViews.apply {
                setTextViewText(R.id.notification_title, recordingConfig.notification.title)
                setTextViewText(R.id.notification_text, recordingConfig.notification.text)
                setTextViewText(R.id.notification_duration, formatDuration(recordingDuration))

                // Update waveform if needed
                if (recordingConfig.showWaveformInNotification &&
                    audioData != null &&
                    audioData.isNotEmpty() &&
                    currentTime - lastWaveformUpdate >= WAVEFORM_UPDATE_INTERVAL
                ) {
                    try {
                        val waveformBitmap = waveformRenderer.generateWaveform(audioData, recordingConfig.notification.waveform)
                        setImageViewBitmap(R.id.notification_waveform, waveformBitmap)
                        lastWaveformUpdate = currentTime
                    } catch (e: Exception) {
                        LogUtils.e(CLASS_NAME, "Error generating waveform", e)
                    }
                }
            }

            // Only rebuild notification if RemoteViews was refreshed
            if (needsRemoteViewsRefresh) {
                notificationBuilder
                    .setOnlyAlertOnce(true)
                    .setOngoing(true)
                addNotificationActions(context)
            }
            presentContent(recordingDuration)

            // Update the notification with disabled alerts
            notificationManager.notify(
                recordingConfig.notification.notificationId,
                notificationBuilder
                    .setOnlyAlertOnce(true)
                    .setVibrate(null)
                    .setDefaults(0)
                    .build()
            )

            lastSuccessfulUpdate = currentTime
            consecutiveUpdateFailures = 0

        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Error updating notification", e)
            consecutiveUpdateFailures++

            if (consecutiveUpdateFailures >= maxUpdateFailures) {
                reinitializeNotification()
            }
        }
    }

    private fun shouldUpdateWaveform(audioData: FloatArray?, currentTime: Long): Boolean {
        return recordingConfig.showWaveformInNotification &&
                audioData != null &&
                audioData.isNotEmpty() &&
                currentTime - lastWaveformUpdate >= WAVEFORM_UPDATE_INTERVAL
    }

    private fun updateWaveformOnly(audioData: FloatArray?) {
        if (audioData == null) return
        
        try {
            val waveformBitmap = waveformRenderer.generateWaveform(audioData, recordingConfig.notification.waveform)
            remoteViews.setImageViewBitmap(R.id.notification_waveform, waveformBitmap)
            lastWaveformUpdate = SystemClock.elapsedRealtime()
            
            notificationManager.notify(
                recordingConfig.notification.notificationId,
                notificationBuilder
                    .setCustomContentView(remoteViews)
                    .setCustomBigContentView(remoteViews)
                    .setOnlyAlertOnce(true)
                    .setVibrate(null)
                    .setDefaults(0)
                    .build()
            )
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Error updating waveform", e)
        }
    }

    private fun reinitializeNotification() {
        try {
            val context = contextRef.get() ?: return

            // Force a RemoteViews refresh
            remoteViews = RemoteViews(context.packageName, R.layout.notification_recording)
            lastRemoteViewsUpdate = SystemClock.elapsedRealtime()

            buildNotification(context)

            notificationManager.notify(
                recordingConfig.notification.notificationId,
                notificationBuilder.build()
            )

            consecutiveUpdateFailures = 0
            LogUtils.d(CLASS_NAME, "Successfully reinitialized notification")
        } catch (e: Exception) {
            LogUtils.e(CLASS_NAME, "Failed to reinitialize notification", e)
        }
    }

    fun getNotification(): Notification = notificationBuilder.build()

    fun pauseUpdates() {
        isPaused.set(true)
        lastPauseTime = System.currentTimeMillis()
        updateNotificationActions() // Update actions when pausing
    }

    fun resumeUpdates() {
        pausedDuration += System.currentTimeMillis() - lastPauseTime
        isPaused.set(false)
        updateNotificationActions() // Update actions when resuming
        scheduleUpdate()
    }

    fun stopUpdates() {
        isUpdating.set(false)
        mainHandler.removeCallbacksAndMessages(null)
        notificationManager.cancel(recordingConfig.notification.notificationId)
        cleanup()
    }

    private fun cleanup() {
        recordingStartTime = 0
        pausedDuration = 0
        lastPauseTime = 0
        lastWaveformUpdate = 0
        lastSuccessfulUpdate = 0
        lastRemoteViewsUpdate = 0
        consecutiveUpdateFailures = 0
        isPaused.set(false)
        isUpdating.set(false)
    }

    private fun getResourceIdByName(resourceName: String): Int {
        val context = contextRef.get() ?: return R.drawable.ic_default_action_icon
        return context.resources.getIdentifier(resourceName, "drawable", context.packageName)
            .takeIf { it != 0 } ?: R.drawable.ic_default_action_icon
    }

    private fun formatDuration(durationMs: Long): String {
        val totalSeconds = durationMs / 1000
        val minutes = totalSeconds / 60
        val seconds = totalSeconds % 60
        return String.format(Locale.US, "%02d:%02d", minutes, seconds)
    }
}
