package net.siteed.sherpaonnx

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import junit.framework.TestCase.*
import net.siteed.sherpaonnx.utils.createPromise
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import net.siteed.sherpaonnx.utils.createTestReactContext

@RunWith(AndroidJUnit4::class)
class SystemInfoTest {

    private lateinit var sherpaOnnxImpl: SherpaOnnxImpl
    private lateinit var reactContext: ReactApplicationContext

    @Before
    fun setUp() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        
        
        // Create ReactApplicationContext for testing
        reactContext = createTestReactContext(context)
        
        // Initialize the SherpaOnnxImpl instance
        sherpaOnnxImpl = SherpaOnnxImpl(reactContext)
    }

    @Test
    fun testGetSystemInfo() {
        val latch = CountDownLatch(1)
        var systemInfo: ReadableMap? = null
        var error: String? = null

        val promise = createPromise(
            onResolve = { result ->
                systemInfo = result as? ReadableMap
                latch.countDown()
            },
            onReject = { _, message, _ ->
                error = message
                latch.countDown()
            }
        )

        // Call getSystemInfo
        sherpaOnnxImpl.getSystemInfo(promise)

        // Wait for the result
        assertTrue("getSystemInfo should complete within 5 seconds", latch.await(5, TimeUnit.SECONDS))
        
        // Verify no error occurred
        assertNull("getSystemInfo should not throw an error", error)
        assertNotNull("System info should not be null", systemInfo)

        // Verify architecture information
        val architecture = systemInfo?.getMap("architecture")
        assertNotNull("Architecture info should be present", architecture)
        assertTrue("Architecture type should be 'old' or 'new'", 
            architecture?.getString("type") in listOf("old", "new"))
        assertNotNull("Architecture description should be present", architecture?.getString("description"))
        assertEquals("Module type should match architecture", 
            if (architecture?.getString("type") == "new") "TurboModule" else "Bridge Module",
            architecture?.getString("moduleType"))

        // Verify memory information
        val memory = systemInfo?.getMap("memory")
        assertNotNull("Memory info should be present", memory)
        assertTrue("Max memory should be positive", memory?.getDouble("maxMemoryMB") ?: 0.0 > 0)
        assertTrue("Total memory should be positive", memory?.getDouble("totalMemoryMB") ?: 0.0 > 0)
        assertTrue("Free memory should be non-negative", memory?.getDouble("freeMemoryMB") ?: -1.0 >= 0)
        assertTrue("Used memory should be non-negative", memory?.getDouble("usedMemoryMB") ?: -1.0 >= 0)

        // Verify CPU information
        val cpu = systemInfo?.getMap("cpu")
        assertNotNull("CPU info should be present", cpu)
        assertTrue("Available processors should be positive", cpu?.getInt("availableProcessors") ?: 0 > 0)
        val supportedAbis = cpu?.getArray("supportedAbis")
        assertNotNull("Supported ABIs should be present", supportedAbis)
        assertTrue("Should have at least one supported ABI", supportedAbis?.size() ?: 0 > 0)

        // Verify device information
        val device = systemInfo?.getMap("device")
        assertNotNull("Device info should be present", device)
        assertNotNull("Brand should be present", device?.getString("brand"))
        assertNotNull("Model should be present", device?.getString("model"))
        assertNotNull("Device name should be present", device?.getString("device"))
        assertNotNull("Manufacturer should be present", device?.getString("manufacturer"))
        assertTrue("SDK version should be positive", device?.getInt("sdkVersion") ?: 0 > 0)
        assertNotNull("Android version should be present", device?.getString("androidVersion"))

        // Verify GPU information
        val gpu = systemInfo?.getMap("gpu")
        assertNotNull("GPU info should be present", gpu)
        // GPU info might be limited, so we just check it exists

        // Verify thread information
        val thread = systemInfo?.getMap("thread")
        assertNotNull("Thread info should be present", thread)
        assertNotNull("Current thread should be present", thread?.getString("currentThread"))
        assertTrue("Thread ID should be positive", thread?.getInt("threadId") ?: 0 > 0)

        // Verify library loaded status
        assertNotNull("Library loaded status should be present", systemInfo?.getBoolean("libraryLoaded"))
    }

    @Test
    fun testGetArchitectureInfo() {
        val latch = CountDownLatch(1)
        var result: ReadableMap? = null
        var error: String? = null

        val promise = createPromise(
            onResolve = { data ->
                result = data as? ReadableMap
                latch.countDown()
            },
            onReject = { _, message, _ ->
                error = message
                latch.countDown()
            }
        )

        // Call getArchitectureInfo (which internally calls getSystemInfo)
        sherpaOnnxImpl.getArchitectureInfo(promise)

        // Wait for the result
        assertTrue("getArchitectureInfo should complete within 5 seconds", latch.await(5, TimeUnit.SECONDS))
        
        // Verify no error occurred
        assertNull("getArchitectureInfo should not throw an error", error)
        assertNotNull("Result should not be null", result)

        // Since getArchitectureInfo now returns full system info, verify it has all expected fields
        assertNotNull("Should have architecture info", result?.getMap("architecture"))
        assertNotNull("Should have memory info", result?.getMap("memory"))
        assertNotNull("Should have CPU info", result?.getMap("cpu"))
        assertNotNull("Should have device info", result?.getMap("device"))
        assertNotNull("Should have GPU info", result?.getMap("gpu"))
        assertNotNull("Should have thread info", result?.getMap("thread"))
    }

    @Test
    fun testOnnxIntegrationSucceedsWhenLibraryLoads() {
        assertTrue("Sherpa ONNX JNI library should load", SherpaOnnxImpl.isLibraryLoaded)
        val latch = CountDownLatch(1)
        var result: ReadableMap? = null

        sherpaOnnxImpl.testOnnxIntegration(createPromise(
            onResolve = { value ->
                result = value as? ReadableMap
                latch.countDown()
            },
            onReject = { _, _, _ -> latch.countDown() }
        ))

        assertTrue("testOnnxIntegration should complete within 5 seconds", latch.await(5, TimeUnit.SECONDS))
        assertTrue(
            "testOnnxIntegration should succeed: ${result?.getString("status")}",
            result?.getBoolean("success") == true
        )
    }
}
