package net.siteed.audiostudio

import kotlin.test.assertEquals
import org.junit.Test

/** Covers the duration shown in the standard-template header when the waveform is off (#529). */
class AudioNotificationContentTest {

    @Test
    fun `duration formats as minutes and seconds`() {
        assertEquals("00:00", AudioNotificationManager.formatDuration(0))
        assertEquals("01:05", AudioNotificationManager.formatDuration(65_000))
    }

    @Test
    fun `duration rounds down to whole seconds`() {
        assertEquals("10:00", AudioNotificationManager.formatDuration(600_999))
    }
}
