package dev.elchi.orbit.ui.pair

import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Reads QR codes from camera frames with ZXing; no Play Services. */
class QrAnalyzer(private val onText: (String) -> Unit) : ImageAnalysis.Analyzer {
    private val reader = MultiFormatReader().apply {
        setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE), DecodeHintType.TRY_HARDER to true))
    }
    private val done = AtomicBoolean(false)

    fun reset() = done.set(false)

    override fun analyze(image: ImageProxy) {
        try {
            if (done.get()) return
            val plane = image.planes[0]
            val buf = plane.buffer
            val rowStride = plane.rowStride
            val w = image.width
            val h = image.height
            // copy the luminance plane without its row padding
            val data = ByteArray(w * h)
            buf.rewind()
            if (rowStride == w) buf.get(data, 0, minOf(buf.remaining(), data.size))
            else for (row in 0 until h) {
                buf.position(row * rowStride)
                buf.get(data, row * w, minOf(w, buf.remaining()))
            }
            val src = PlanarYUVLuminanceSource(data, w, h, 0, 0, w, h, false)
            val text = decode(BinaryBitmap(HybridBinarizer(src))) ?: decode(BinaryBitmap(HybridBinarizer(src.invert())))
            if (text != null && done.compareAndSet(false, true)) onText(text)
        } catch (_: Throwable) {
        } finally {
            image.close()
        }
    }

    private fun decode(b: BinaryBitmap): String? = try {
        reader.decodeWithState(b).text
    } catch (_: NotFoundException) {
        null
    } finally {
        reader.reset()
    }
}

@Composable
fun QrCamera(onText: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val callback by rememberUpdatedState(onText)
    val executor = remember { Executors.newSingleThreadExecutor() }
    val analyzer = remember { QrAnalyzer { text -> ContextCompat.getMainExecutor(context).execute { callback(text) } } }
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    DisposableEffect(owner) {
        val future = ProcessCameraProvider.getInstance(context)
        var provider: ProcessCameraProvider? = null
        future.addListener({
            runCatching {
                val p = future.get()
                provider = p
                val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
                val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build().also { it.setAnalyzer(executor, analyzer) }
                p.unbindAll()
                p.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            }
        }, ContextCompat.getMainExecutor(context))
        onDispose {
            runCatching { provider?.unbindAll() }
        }
    }
    DisposableEffect(Unit) { onDispose { executor.shutdown() } }
    AndroidView({ previewView }, modifier)
}
