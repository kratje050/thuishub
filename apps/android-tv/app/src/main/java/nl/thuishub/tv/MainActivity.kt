package nl.thuishub.tv

import android.app.AlertDialog
import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.media.MediaCodecList
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Bundle
import android.os.Build
import android.provider.Settings as AndroidSettings
import android.view.Display
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URL
import java.security.MessageDigest
import java.util.UUID

class MainActivity : ComponentActivity() {
    companion object {
        private const val SERVICE_TYPE = "_thuishub._tcp."
        private const val DISCOVERY_PORT = 8789
        private const val DISCOVERY_REQUEST = "THUISHUB_DISCOVER_V1"
        private const val APP_VERSION = "1.2.15"
        private const val UPDATE_MANIFEST_URL = "https://github.com/kratje050/thuishub/releases/latest/download/latest.json"
        private const val MAX_MANIFEST_BYTES = 256 * 1024
        private const val MAX_APK_BYTES = 200L * 1024 * 1024
    }

    private lateinit var root: FrameLayout
    private lateinit var nsdManager: NsdManager
    private var discoveryStarted = false
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    private var player: ExoPlayer? = null
    private var mediaSession: MediaSession? = null
    private var currentMediaId = 0
    private var currentSessionId = ""
    private var progressJob: Job? = null
    private var commandJob: Job? = null
    private var pairingJob: Job? = null
    private var screenStatus: TextView? = null
    private var pairingCode: TextView? = null
    private var pairingInProgress = false
    private var serverConfirmed = false
    private var connectionAttemptActive = false
    private var connectionJob: Job? = null
    private var updateJob: Job? = null
    private var currentScreen = AppScreen.HOME
    private var lastConnectionStatus = ""
    private var lastPairingCode = ""
    private var updateScreenStatus: TextView? = null
    private var lastUpdateStatus = "Updates werken ook zonder gekoppelde ThuisHub-server."
    private var availableUpdate: AndroidUpdate? = null
    private var downloadedUpdateFile: File? = null
    private var updateDownloadDialog: AlertDialog? = null
    private var updateDialogProgress: ProgressBar? = null
    private var updateDialogStatus: TextView? = null
    private var updateDialogBytes: TextView? = null
    private val resolving = mutableSetOf<String>()
    private val executedCommandIds = mutableSetOf<Long>()
    private val preferences by lazy { getSharedPreferences("thuishub", MODE_PRIVATE) }
    private val isTelevision by lazy {
        (getSystemService(Context.UI_MODE_SERVICE) as UiModeManager).currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
    }
    private val server get() = preferences.getString("server", "")!!.trimEnd('/')
    private val token get() = preferences.getString("deviceToken", "")!!
    private val automaticConnectionEnabled get() = preferences.getBoolean("automaticConnectionEnabled", true)
    private val stableDeviceId: String by lazy {
        preferences.getString("deviceId", null) ?: UUID.randomUUID().toString().also {
            preferences.edit().putString("deviceId", it).apply()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this)
        setContentView(root)
        nsdManager = getSystemService(Context.NSD_SERVICE) as NsdManager
        showHome()
        if (automaticConnectionEnabled) root.post { startConnection(showProgressScreen = false) }
        root.postDelayed({ checkForAndroidUpdate(silent = true) }, 1_200)
    }

    private fun newScreenColumn(): LinearLayout {
        val horizontalPadding = dp(if (isTelevision) 48 else 20)
        val verticalPadding = dp(if (isTelevision) 32 else 20)
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(horizontalPadding, verticalPadding, horizontalPadding, verticalPadding)
        }
    }

    private fun renderColumn(column: LinearLayout) {
        root.removeAllViews()
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(column, ViewGroup.LayoutParams(-1, -1))
        }
        root.addView(scroll, FrameLayout.LayoutParams(-1, -1))
    }

    private fun addNavigation(column: LinearLayout, screenTitle: String, includeHome: Boolean = true) {
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(TextView(this).apply {
            text = screenTitle
            textSize = if (isTelevision) 28f else 23f
            setTextColor(0xffffffff.toInt())
        }, LinearLayout.LayoutParams(0, -2, 1f))
        if (includeHome) header.addView(Button(this).apply {
            text = "Home"
            isAllCaps = false
            setOnClickListener { showHome() }
        })
        header.addView(Button(this).apply {
            text = "Instellingen"
            isAllCaps = false
            isEnabled = currentScreen != AppScreen.SETTINGS
            setOnClickListener { showSettings() }
        })
        column.addView(header, LinearLayout.LayoutParams(-1, -2))
    }

    private fun showHome() {
        currentScreen = AppScreen.HOME
        pairingCode = null
        updateScreenStatus = null
        val column = newScreenColumn()
        addNavigation(column, "ThuisHub", includeHome = false)
        column.addView(TextView(this).apply {
            text = if (server.isNotBlank() && token.isNotBlank()) "Klaar om je bibliotheek te openen"
            else "Je eigen mediabibliotheek"
            textSize = if (isTelevision) 34f else 29f
            setTextColor(0xffffffff.toInt())
            gravity = Gravity.CENTER
            setPadding(0, dp(48), 0, dp(8))
        })
        screenStatus = TextView(this).apply {
            text = when {
                lastConnectionStatus.isNotBlank() -> lastConnectionStatus
                server.isNotBlank() && token.isNotBlank() -> "Gekoppeld met $server."
                server.isNotBlank() -> "Server opgeslagen. Koppelen moet nog worden afgerond."
                else -> "Kies zelf wanneer je ThuisHub wilt zoeken en koppelen."
            }
            textSize = 17f
            gravity = Gravity.CENTER
            setTextColor(0xffb8c8c0.toInt())
            setPadding(0, 0, 0, dp(26))
        }
        column.addView(screenStatus)
        column.addView(Button(this).apply {
            text = when {
                pairingInProgress -> "Lopende koppeling bekijken"
                server.isNotBlank() && token.isNotBlank() -> "Bibliotheek openen"
                else -> "ThuisHub koppelen"
            }
            isAllCaps = false
            setOnClickListener {
                if (pairingInProgress) showPairing() else startConnection(showProgressScreen = true)
            }
        }, LinearLayout.LayoutParams(-1, -2))
        column.addView(Button(this).apply {
            text = "Verbindingsinstellingen"
            isAllCaps = false
            setOnClickListener { showSettings() }
        }, LinearLayout.LayoutParams(-1, -2))
        column.addView(Button(this).apply {
            text = "App-updates"
            isAllCaps = false
            setOnClickListener { showUpdates() }
        }, LinearLayout.LayoutParams(-1, -2))
        column.addView(TextView(this).apply {
            text = if (automaticConnectionEnabled) "Automatisch zoeken en verbinden: aan"
            else "Automatisch zoeken en verbinden: uit"
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(0xff80958c.toInt())
            setPadding(0, dp(18), 0, 0)
        })
        renderColumn(column)
    }

    private fun showSettings() {
        currentScreen = AppScreen.SETTINGS
        pairingCode = null
        updateScreenStatus = null
        val column = newScreenColumn()
        addNavigation(column, "Instellingen")
        column.addView(TextView(this).apply {
            text = "Verbinding"
            textSize = 24f
            setTextColor(0xffffffff.toInt())
            setPadding(0, dp(34), 0, dp(8))
        }, LinearLayout.LayoutParams(-1, -2))
        column.addView(SwitchCompat(this).apply {
            text = "Automatisch zoeken en verbinden"
            textSize = 17f
            setTextColor(0xffffffff.toInt())
            isChecked = automaticConnectionEnabled
            setPadding(0, dp(8), 0, dp(8))
            setOnCheckedChangeListener { _, enabled ->
                preferences.edit().putBoolean("automaticConnectionEnabled", enabled).apply()
                if (!enabled) stopConnectionAttempt()
                lastConnectionStatus = if (enabled) {
                    "Automatisch verbinden staat aan en wordt bij de volgende start gebruikt."
                } else {
                    "Automatisch verbinden staat uit. Je kunt nog steeds handmatig verbinden."
                }
                screenStatus?.text = lastConnectionStatus
            }
        }, LinearLayout.LayoutParams(-1, -2))
        column.addView(TextView(this).apply {
            text = "Als dit aanstaat controleert ThuisHub bij het openen eerst de opgeslagen server en zoekt daarna op je thuisnetwerk. Een nieuwe koppeling moet altijd met de zescijferige code worden goedgekeurd."
            textSize = 14f
            setTextColor(0xffa9b7c0.toInt())
            setPadding(0, 0, 0, dp(18))
        }, LinearLayout.LayoutParams(-1, -2))
        screenStatus = TextView(this).apply {
            text = if (lastConnectionStatus.isNotBlank()) lastConnectionStatus
            else if (server.isBlank()) "Er is nog geen server opgeslagen." else "Opgeslagen server: $server"
            textSize = 15f
            setTextColor(0xffb8c8c0.toInt())
            setPadding(0, dp(8), 0, dp(16))
        }
        column.addView(screenStatus, LinearLayout.LayoutParams(-1, -2))
        column.addView(Button(this).apply {
            text = "App-updates"
            isAllCaps = false
            setOnClickListener { showUpdates() }
        }, LinearLayout.LayoutParams(-1, -2))
        column.addView(Button(this).apply {
            text = "Nu zoeken en koppelen"
            isAllCaps = false
            setOnClickListener { startConnection(showProgressScreen = true) }
        }, LinearLayout.LayoutParams(-1, -2))
        if (pairingInProgress) column.addView(Button(this).apply {
            text = "Lopende koppeling bekijken"
            isAllCaps = false
            setOnClickListener { showPairing() }
        }, LinearLayout.LayoutParams(-1, -2))
        val manualAddress = EditText(this).apply {
            hint = "http://192.168.1.10:8788"
            setText(server)
            setTextColor(0xffffffff.toInt())
            setHintTextColor(0xff80958c.toInt())
            minWidth = 0
            setSingleLine(true)
            setPadding(dp(12), dp(14), dp(12), dp(14))
        }
        column.addView(manualAddress, LinearLayout.LayoutParams(-1, -2))
        column.addView(Button(this).apply {
            text = "Handmatig verbinden"
            isAllCaps = false
            setOnClickListener { connectManually(manualAddress.text.toString()) }
        }, LinearLayout.LayoutParams(-1, -2))
        if (server.isNotBlank()) column.addView(Button(this).apply {
            text = "Opgeslagen verbinding vergeten"
            isAllCaps = false
            setOnClickListener {
                stopConnectionAttempt()
                commandJob?.cancel()
                commandJob = null
                preferences.edit().remove("server").remove("deviceToken").apply()
                serverConfirmed = false
                lastConnectionStatus = "De opgeslagen verbinding is verwijderd."
                showSettings()
            }
        }, LinearLayout.LayoutParams(-1, -2))
        renderColumn(column)
    }

    private fun showUpdates() {
        currentScreen = AppScreen.UPDATES
        pairingCode = null
        val column = newScreenColumn()
        addNavigation(column, "App-updates")
        column.addView(TextView(this).apply {
            text = "ThuisHub bijwerken"
            textSize = if (isTelevision) 32f else 27f
            setTextColor(0xffffffff.toInt())
            gravity = Gravity.CENTER
            setPadding(0, dp(38), 0, dp(8))
        }, LinearLayout.LayoutParams(-1, -2))
        column.addView(TextView(this).apply {
            text = "Huidige versie: $APP_VERSION"
            textSize = 16f
            setTextColor(0xffa9b7c0.toInt())
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(-1, -2))
        updateScreenStatus = TextView(this).apply {
            text = lastUpdateStatus
            textSize = 16f
            setTextColor(0xffb8c8c0.toInt())
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(22))
        }
        column.addView(updateScreenStatus, LinearLayout.LayoutParams(-1, -2))
        column.addView(Button(this).apply {
            text = "Controleren op updates"
            isAllCaps = false
            isEnabled = updateJob?.isActive != true
            setOnClickListener { checkForAndroidUpdate() }
        }, LinearLayout.LayoutParams(-1, -2))
        val update = availableUpdate
        if (update != null && compareVersions(update.version, APP_VERSION) > 0) {
            column.addView(TextView(this).apply {
                text = "Nieuwe versie: ${update.version}"
                textSize = 18f
                setTextColor(0xffd9ff3f.toInt())
                gravity = Gravity.CENTER
                setPadding(0, dp(18), 0, dp(8))
            }, LinearLayout.LayoutParams(-1, -2))
            val downloaded = downloadedUpdateFile?.takeIf { it.isFile }
            column.addView(Button(this).apply {
                text = if (downloaded == null) "Downloaden" else "Installeren"
                isAllCaps = false
                isEnabled = updateJob?.isActive != true
                setOnClickListener {
                    if (downloaded == null) downloadAndroidUpdate(update) else launchApkInstaller(downloaded)
                }
            }, LinearLayout.LayoutParams(-1, -2))
        }
        column.addView(TextView(this).apply {
            text = "De update komt rechtstreeks van GitHub Releases en wordt vóór installatie met SHA-256 gecontroleerd. Koppelen met de pc is hiervoor niet nodig."
            textSize = 13f
            setTextColor(0xff80958c.toInt())
            gravity = Gravity.CENTER
            setPadding(0, dp(20), 0, 0)
        }, LinearLayout.LayoutParams(-1, -2))
        renderColumn(column)
    }

    private fun showPairing() {
        currentScreen = AppScreen.CONNECTING
        updateScreenStatus = null
        val column = newScreenColumn()
        addNavigation(column, "ThuisHub koppelen")
        val title = TextView(this).apply {
            text = "Verbinden met je ThuisHub"
            textSize = if (isTelevision) 32f else 27f
            setTextColor(0xffffffff.toInt())
            gravity = Gravity.CENTER
            setPadding(0, dp(42), 0, dp(8))
        }
        screenStatus = TextView(this).apply {
            text = if (lastConnectionStatus.isNotBlank()) lastConnectionStatus else "ThuisHub wordt op je thuisnetwerk gezocht…"
            textSize = 18f
            gravity = Gravity.CENTER
            setTextColor(0xffb8c8c0.toInt())
        }
        pairingCode = TextView(this).apply {
            text = lastPairingCode
            textSize = 52f
            letterSpacing = .22f
            setTextColor(0xffd9ff3f.toInt())
            gravity = Gravity.CENTER
        }
        val manualAddress = EditText(this).apply {
            hint = "http://192.168.1.10:8788"
            setText(server)
            setTextColor(0xffffffff.toInt())
            setHintTextColor(0xff80958c.toInt())
            minWidth = 0
            setSingleLine(true)
            visibility = View.GONE
        }
        val manualConnect = Button(this).apply {
            text = "Handmatig verbinden"
            visibility = View.GONE
            isAllCaps = false
            setOnClickListener { connectManually(manualAddress.text.toString()) }
        }
        val advanced = Button(this).apply {
            text = "Geavanceerd: handmatig adres"
            isAllCaps = false
            setOnClickListener {
                val visible = manualAddress.visibility != View.VISIBLE
                manualAddress.visibility = if (visible) View.VISIBLE else View.GONE
                manualConnect.visibility = if (visible) View.VISIBLE else View.GONE
                if (visible) manualAddress.requestFocus()
            }
        }
        column.addView(title)
        column.addView(screenStatus)
        column.addView(pairingCode)
        column.addView(advanced)
        column.addView(manualAddress, LinearLayout.LayoutParams(-1, -2))
        column.addView(manualConnect, LinearLayout.LayoutParams(-1, -2))
        column.addView(Button(this).apply {
            text = "App-updates"
            isAllCaps = false
            setOnClickListener { showUpdates() }
        }, LinearLayout.LayoutParams(-1, -2))
        column.addView(Button(this).apply {
            text = "Annuleren"
            isAllCaps = false
            setOnClickListener {
                stopConnectionAttempt()
                lastConnectionStatus = "Koppelen geannuleerd."
                showHome()
            }
        }, LinearLayout.LayoutParams(-1, -2))
        renderColumn(column)
    }

    private fun updateStatus(message: String) {
        lastConnectionStatus = message
        runOnUiThread { screenStatus?.text = message }
    }

    private fun checkForAndroidUpdate(silent: Boolean = false) {
        if (updateJob?.isActive == true) return
        lastUpdateStatus = "De nieuwste GitHub-release controleren…"
        updateScreenStatus?.text = lastUpdateStatus
        updateJob = lifecycleScope.launch {
            try {
                val update = loadAndroidUpdateManifest()
                availableUpdate = update
                if (downloadedUpdateFile?.name != update.assetName) downloadedUpdateFile = null
                lastUpdateStatus = if (compareVersions(update.version, APP_VERSION) > 0) {
                    "Versie ${update.version} is beschikbaar."
                } else {
                    "Je gebruikt al de nieuwste versie."
                }
            } catch (error: Exception) {
                lastUpdateStatus = error.message ?: "Updatecontrole is mislukt."
            }
            updateJob = null
            if (currentScreen == AppScreen.UPDATES) {
                showUpdates()
            } else if (availableUpdate?.let { compareVersions(it.version, APP_VERSION) > 0 } == true) {
                showToast("ThuisHub ${availableUpdate?.version} is beschikbaar. Open App-updates om bij te werken.")
            } else if (!silent && lastUpdateStatus.startsWith("Updatecontrole is mislukt")) {
                showToast(lastUpdateStatus)
            }
        }
    }

    private suspend fun loadAndroidUpdateManifest(): AndroidUpdate = withContext(Dispatchers.IO) {
        val manifest = JSONObject(readTrustedUpdateText(UPDATE_MANIFEST_URL))
        val version = manifest.optString("version").trim()
        val tag = manifest.optString("tag").trim()
        val channel = manifest.optString("channel").trim()
        if (manifest.optString("product") != "ThuisHub" || channel != "stable" || !Regex("^\\d+\\.\\d+\\.\\d+$").matches(version)) {
            throw IllegalStateException("De GitHub-release bevat geen geldige stabiele ThuisHub-versie.")
        }
        if (tag != "v$version") throw IllegalStateException("De versie en releasetag komen niet overeen.")
        val android = manifest.optJSONObject("assets")?.optJSONObject("android")
            ?: throw IllegalStateException("De Android-update ontbreekt in de release.")
        val assetName = android.optString("name").trim()
        val sha256 = android.optString("sha256").trim().lowercase()
        if (assetName != "ThuisHub-Android-$version.apk" || !Regex("^[A-Fa-f0-9]{64}$").matches(sha256)) {
            throw IllegalStateException("De Android-update bevat geen geldige bestandscontrole.")
        }
        AndroidUpdate(version, tag, assetName, sha256)
    }

    private fun readTrustedUpdateText(urlValue: String): String {
        if (urlValue != UPDATE_MANIFEST_URL) throw IllegalStateException("Onbekende updatebron geweigerd.")
        val connection = openTrustedUpdateConnection(urlValue)
        try {
            val status = connection.responseCode
            validateFinalUpdateUrl(connection.url)
            if (status !in 200..299) throw IllegalStateException("GitHub gaf foutcode $status tijdens de updatecontrole.")
            val declaredLength = connection.contentLengthLong
            if (declaredLength > MAX_MANIFEST_BYTES) throw IllegalStateException("Het updatemanifest is onverwacht groot.")
            connection.inputStream.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(8 * 1024)
                var total = 0
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    if (total > MAX_MANIFEST_BYTES) throw IllegalStateException("Het updatemanifest is onverwacht groot.")
                    output.write(buffer, 0, count)
                }
                return output.toString(Charsets.UTF_8.name())
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun downloadAndroidUpdate(update: AndroidUpdate) {
        if (updateJob?.isActive == true) return
        lastUpdateStatus = "ThuisHub ${update.version} downloaden en controleren…"
        updateScreenStatus?.text = lastUpdateStatus
        showUpdateDownloadDialog(update)
        updateJob = lifecycleScope.launch {
            try {
                val file = withContext(Dispatchers.IO) {
                    downloadAndVerifyApk(
                        update,
                        onProgress = { downloaded, total ->
                            runOnUiThread { updateDownloadProgress(downloaded, total) }
                        },
                        onVerifying = {
                            runOnUiThread {
                                updateDialogStatus?.text = "Download controleren met SHA-256…"
                                updateDialogProgress?.isIndeterminate = true
                            }
                        }
                    )
                }
                downloadedUpdateFile = file
                lastUpdateStatus = "Download voltooid en SHA-256 gecontroleerd."
                updateJob = null
                if (currentScreen == AppScreen.UPDATES) showUpdates()
                showUpdateReadyDialog(update, file)
            } catch (error: Exception) {
                lastUpdateStatus = error.message ?: "Downloaden van de update is mislukt."
                updateJob = null
                if (currentScreen == AppScreen.UPDATES) showUpdates()
                showUpdateDownloadError(lastUpdateStatus)
            }
        }
    }

    private fun downloadAndVerifyApk(
        update: AndroidUpdate,
        onProgress: (downloaded: Long, total: Long) -> Unit,
        onVerifying: () -> Unit
    ): File {
        if (!Regex("^ThuisHub-Android-\\d+\\.\\d+\\.\\d+\\.apk$").matches(update.assetName)) {
            throw IllegalStateException("Ongeldige Android-update geweigerd.")
        }
        val url = "https://github.com/kratje050/thuishub/releases/download/${update.tag}/${update.assetName}"
        val connection = openTrustedUpdateConnection(url)
        val updateDirectory = File(cacheDir, "updates").apply { mkdirs() }
        val temporary = File(updateDirectory, "${update.assetName}.part")
        val target = File(updateDirectory, update.assetName)
        temporary.delete()
        try {
            val status = connection.responseCode
            validateFinalUpdateUrl(connection.url)
            if (status !in 200..299) throw IllegalStateException("GitHub gaf foutcode $status tijdens het downloaden.")
            val declaredLength = connection.contentLengthLong
            if (declaredLength > MAX_APK_BYTES) throw IllegalStateException("De Android-update is onverwacht groot.")
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            onProgress(0, declaredLength)
            connection.inputStream.use { input ->
                temporary.outputStream().buffered().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > MAX_APK_BYTES) throw IllegalStateException("De Android-update is onverwacht groot.")
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                        onProgress(total, declaredLength)
                    }
                }
            }
            if (declaredLength > 0 && total != declaredLength) throw IllegalStateException("De Android-update is niet volledig gedownload.")
            onVerifying()
            val actualHash = digest.digest().joinToString("") { "%02x".format(it) }
            if (actualHash != update.sha256) throw IllegalStateException("De SHA-256-controle van de Android-update is mislukt.")
            target.delete()
            if (!temporary.renameTo(target)) throw IllegalStateException("De gecontroleerde update kon niet worden opgeslagen.")
            return target
        } finally {
            connection.disconnect()
            if (temporary.exists()) temporary.delete()
        }
    }

    private fun showUpdateDownloadDialog(update: AndroidUpdate) {
        updateDownloadDialog?.dismiss()
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(10), dp(24), dp(4))
        }
        val status = TextView(this).apply {
            text = "De update wordt veilig van GitHub gedownload."
            textSize = 16f
            setPadding(0, 0, 0, dp(18))
        }
        val progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 1_000
            isIndeterminate = true
        }
        val bytes = TextView(this).apply {
            text = "Download voorbereiden…"
            textSize = 13f
            setPadding(0, dp(10), 0, 0)
        }
        content.addView(status, LinearLayout.LayoutParams(-1, -2))
        content.addView(progress, LinearLayout.LayoutParams(-1, dp(10)))
        content.addView(bytes, LinearLayout.LayoutParams(-1, -2))
        val dialog = AlertDialog.Builder(this)
            .setTitle("ThuisHub ${update.version} downloaden")
            .setView(content)
            .setPositiveButton("Installeren", null)
            .setNegativeButton("Verbergen", null)
            .create()
        updateDownloadDialog = dialog
        updateDialogProgress = progress
        updateDialogStatus = status
        updateDialogBytes = bytes
        dialog.setOnDismissListener {
            if (updateDownloadDialog === dialog) {
                updateDownloadDialog = null
                updateDialogProgress = null
                updateDialogStatus = null
                updateDialogBytes = null
            }
        }
        dialog.show()
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).visibility = View.GONE
    }

    private fun updateDownloadProgress(downloaded: Long, total: Long) {
        val progress = updateDialogProgress ?: return
        progress.isIndeterminate = total <= 0
        if (total > 0) progress.progress = ((downloaded * 1_000L) / total).coerceIn(0L, 1_000L).toInt()
        updateDialogStatus?.text = "Update downloaden…"
        updateDialogBytes?.text = if (total > 0) {
            "${formatUpdateBytes(downloaded)} van ${formatUpdateBytes(total)} (${((downloaded * 100L) / total).coerceIn(0L, 100L)}%)"
        } else {
            "${formatUpdateBytes(downloaded)} gedownload"
        }
    }

    private fun showUpdateReadyDialog(update: AndroidUpdate, file: File) {
        if (updateDownloadDialog == null) showUpdateDownloadDialog(update)
        val dialog = updateDownloadDialog ?: return
        dialog.setTitle("Update klaar om te installeren")
        updateDialogProgress?.apply {
            isIndeterminate = false
            progress = max
        }
        updateDialogStatus?.text = "ThuisHub ${update.version} is gedownload en veilig gecontroleerd."
        updateDialogBytes?.text = "${formatUpdateBytes(file.length())} • Klaar voor installatie"
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).apply {
            visibility = View.VISIBLE
            text = "Installeren"
            setOnClickListener { launchApkInstaller(file) }
        }
        dialog.getButton(AlertDialog.BUTTON_NEGATIVE).text = "Later"
    }

    private fun showUpdateDownloadError(message: String) {
        val update = availableUpdate ?: return
        if (updateDownloadDialog == null) showUpdateDownloadDialog(update)
        val dialog = updateDownloadDialog ?: return
        dialog.setTitle("Download mislukt")
        updateDialogProgress?.visibility = View.GONE
        updateDialogStatus?.text = message
        updateDialogBytes?.text = "Probeer het later opnieuw via App-updates."
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).visibility = View.GONE
        dialog.getButton(AlertDialog.BUTTON_NEGATIVE).text = "Sluiten"
    }

    private fun formatUpdateBytes(value: Long): String = when {
        value >= 1024L * 1024L -> String.format("%.1f MB", value / (1024.0 * 1024.0))
        value >= 1024L -> String.format("%.1f kB", value / 1024.0)
        else -> "$value bytes"
    }

    private fun openTrustedUpdateConnection(urlValue: String): HttpURLConnection {
        val parsed = URL(urlValue)
        if (parsed.protocol != "https" || parsed.host != "github.com" || parsed.userInfo != null) {
            throw IllegalStateException("Onveilige updateverbinding geweigerd.")
        }
        return (parsed.openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = true
            connectTimeout = 12_000
            readTimeout = 60_000
            setRequestProperty("Accept", "application/octet-stream, application/json")
            setRequestProperty("User-Agent", "ThuisHub-Android/$APP_VERSION")
        }
    }

    private fun validateFinalUpdateUrl(url: URL) {
        val trustedHosts = setOf("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")
        if (url.protocol != "https" || url.host !in trustedHosts || url.userInfo != null) {
            throw IllegalStateException("GitHub stuurde de update naar een onbekende locatie.")
        }
    }

    private fun launchApkInstaller(file: File) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
                lastUpdateStatus = "Geef ThuisHub toestemming om deze gecontroleerde update te installeren en kies daarna opnieuw Installeren."
                showUpdates()
                startActivity(Intent(AndroidSettings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                return
            }
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            val installer = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            lastUpdateStatus = "Android-installatie geopend. Bevestig de update op je apparaat."
            updateScreenStatus?.text = lastUpdateStatus
            startActivity(installer)
        } catch (error: Exception) {
            lastUpdateStatus = error.message ?: "De Android-installatie kon niet worden geopend."
            showUpdates()
        }
    }

    private fun compareVersions(left: String, right: String): Int {
        val leftParts = left.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
        val rightParts = right.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
        for (index in 0 until maxOf(leftParts.size, rightParts.size)) {
            val difference = (leftParts.getOrNull(index) ?: 0).compareTo(rightParts.getOrNull(index) ?: 0)
            if (difference != 0) return difference
        }
        return 0
    }

    private fun startConnection(showProgressScreen: Boolean) {
        stopConnectionAttempt()
        connectionAttemptActive = true
        serverConfirmed = false
        if (showProgressScreen) showPairing()
        val savedServer = server
        connectionJob = lifecycleScope.launch {
            if (savedServer.isNotBlank()) {
                updateStatus("Opgeslagen server controleren…")
                if (verifyServer(savedServer)) {
                    selectServer(savedServer)
                    return@launch
                }
                updateStatus("Opgeslagen server niet bereikbaar. ThuisHub wordt op je thuisnetwerk gezocht…")
            } else {
                updateStatus("ThuisHub wordt op je thuisnetwerk gezocht…")
            }
            startDiscovery()
            delay(1_500)
            if (connectionAttemptActive && !serverConfirmed) {
                updateStatus("ThuisHub wordt snel op je lokale netwerk gezocht…")
                val advertised = discoverServerByBroadcast()
                if (advertised != null && connectionAttemptActive && !serverConfirmed && verifyServer(advertised)) {
                    selectServer(advertised)
                    return@launch
                }
                if (!connectionAttemptActive || serverConfirmed) return@launch
                updateStatus("ThuisHub wordt rechtstreeks op je lokale netwerk gezocht…")
                val candidate = discoverServerOnLocalSubnet()
                if (candidate != null && connectionAttemptActive && !serverConfirmed) selectServer(candidate)
                else if (connectionAttemptActive && !serverConfirmed) {
                    updateStatus("Geen ThuisHub gevonden. Controleer of de pc-app draait of gebruik Handmatig adres.")
                }
            }
        }
    }

    private fun connectManually(value: String) {
        val candidate = value.trim().trimEnd('/')
        if (!isSafeLocalServer(candidate)) {
            updateStatus("Gebruik een privé-LAN-adres, bijvoorbeeld http://192.168.1.10:8788.")
            return
        }
        stopConnectionAttempt()
        connectionAttemptActive = true
        serverConfirmed = false
        showPairing()
        connectionJob = lifecycleScope.launch {
            updateStatus("Handmatig adres controleren…")
            if (verifyServer(candidate)) selectServer(candidate)
            else updateStatus("Op dit adres is geen bereikbare ThuisHub-server gevonden.")
        }
    }

    private fun stopConnectionAttempt() {
        connectionJob?.cancel()
        connectionJob = null
        pairingJob?.cancel()
        pairingJob = null
        pairingInProgress = false
        connectionAttemptActive = false
        lastPairingCode = ""
        stopDiscovery()
    }

    private fun startDiscovery() {
        if (discoveryStarted) return
        try {
            val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            multicastLock = wifi.createMulticastLock("thuishub-tv-discovery").apply {
                setReferenceCounted(false)
                acquire()
            }
            val listener = object : NsdManager.DiscoveryListener {
                override fun onDiscoveryStarted(serviceType: String) {
                    if (!connectionAttemptActive) {
                        runCatching { nsdManager.stopServiceDiscovery(this) }
                        return
                    }
                    discoveryStarted = true
                    updateStatus("ThuisHub wordt automatisch gezocht…")
                }

                override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                    if (connectionAttemptActive && isThuisHubServiceType(serviceInfo.serviceType)) resolveService(serviceInfo)
                }

                override fun onServiceLost(serviceInfo: NsdServiceInfo) = Unit
                override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) = discoveryFailed()
                override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = discoveryFailed()
                override fun onDiscoveryStopped(serviceType: String) {
                    discoveryStarted = false
                    releaseMulticastLock()
                }
            }
            discoveryListener = listener
            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (_: Exception) {
            discoveryFailed()
        }
    }

    private fun discoveryFailed() {
        discoveryStarted = false
        discoveryListener = null
        releaseMulticastLock()
        if (connectionAttemptActive) {
            updateStatus("Zoeken op het netwerk is niet beschikbaar. Open Instellingen om handmatig te verbinden.")
        }
    }

    private fun stopDiscovery() {
        val listener = discoveryListener
        discoveryListener = null
        if (listener != null) runCatching { nsdManager.stopServiceDiscovery(listener) }
        discoveryStarted = false
        synchronized(resolving) { resolving.clear() }
        releaseMulticastLock()
    }

    private fun releaseMulticastLock() {
        multicastLock?.let { if (it.isHeld) runCatching { it.release() } }
        multicastLock = null
    }

    @Suppress("DEPRECATION")
    private fun resolveService(serviceInfo: NsdServiceInfo) {
        val key = "${serviceInfo.serviceName}|${serviceInfo.serviceType}"
        synchronized(resolving) { if (!resolving.add(key)) return }
        try {
            nsdManager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                    synchronized(resolving) { resolving.remove(key) }
                }

                override fun onServiceResolved(info: NsdServiceInfo) {
                    synchronized(resolving) { resolving.remove(key) }
                    val candidate = serverUrl(info.host, info.port) ?: return
                    lifecycleScope.launch {
                        if (connectionAttemptActive && !serverConfirmed && verifyServer(candidate)) selectServer(candidate)
                    }
                }
            })
        } catch (_: Exception) {
            synchronized(resolving) { resolving.remove(key) }
        }
    }

    private fun serverUrl(address: InetAddress?, port: Int): String? {
        if (address == null || port !in 1..65535 || !address.isSiteLocalAddress && !address.isLinkLocalAddress) return null
        val host = when (address) {
            is Inet4Address -> address.hostAddress
            is Inet6Address -> "[${address.hostAddress?.replace("%", "%25")}]"
            else -> null
        } ?: return null
        return "http://$host:$port"
    }

    private fun isThuisHubServiceType(value: String): Boolean {
        val normalized = value.trim().lowercase().trimEnd('.').removeSuffix(".local")
        return normalized == "_thuishub._tcp"
    }

    private suspend fun verifyServer(candidate: String): Boolean {
        if (!isSafeLocalServer(candidate)) return false
        return try {
            val health = JSONObject(rawRequest(candidate, "/api/health", "GET", null, false))
            health.optString("app") == "thuishub" && health.optString("status") == "ok"
        } catch (_: Exception) { false }
    }

    private suspend fun discoverServerByBroadcast(): String? = withContext(Dispatchers.IO) {
        val connectivity = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = connectivity.allNetworks.firstOrNull { candidate ->
            connectivity.getNetworkCapabilities(candidate)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
        } ?: connectivity.activeNetwork ?: return@withContext null
        val link = connectivity.getLinkProperties(network)?.linkAddresses
            ?.firstOrNull { it.address is Inet4Address && it.address.isSiteLocalAddress }
            ?: return@withContext null
        val address = link.address as Inet4Address
        val prefixLength = link.prefixLength
        if (prefixLength !in 1..30) return@withContext null
        val localValue = address.address.fold(0) { value, part -> (value shl 8) or (part.toInt() and 0xff) }
        val hostBits = 32 - prefixLength
        val mask = -1 shl hostBits
        val broadcastValue = localValue or mask.inv()
        val broadcastBytes = intArrayOf(24, 16, 8, 0)
            .map { shift -> ((broadcastValue ushr shift) and 0xff).toByte() }
            .toByteArray()
        val targets = listOfNotNull(
            runCatching { InetAddress.getByAddress(broadcastBytes) }.getOrNull(),
            runCatching { InetAddress.getByName("255.255.255.255") }.getOrNull(),
        ).distinctBy { it.hostAddress }
        val request = DISCOVERY_REQUEST.toByteArray(Charsets.UTF_8)
        DatagramSocket().use { socket ->
            runCatching { network.bindSocket(socket) }
            socket.broadcast = true
            targets.forEach { target ->
                runCatching { socket.send(DatagramPacket(request, request.size, target, DISCOVERY_PORT)) }
            }
            val deadline = System.nanoTime() + 2_400_000_000L
            while (System.nanoTime() < deadline) {
                val remainingMs = ((deadline - System.nanoTime()) / 1_000_000L).coerceAtLeast(1L)
                socket.soTimeout = minOf(700L, remainingMs).toInt()
                val bytes = ByteArray(4_096)
                val packet = DatagramPacket(bytes, bytes.size)
                try {
                    socket.receive(packet)
                } catch (_: SocketTimeoutException) {
                    continue
                } catch (_: Exception) {
                    return@withContext null
                }
                val response = runCatching {
                    JSONObject(String(packet.data, packet.offset, packet.length, Charsets.UTF_8))
                }.getOrNull() ?: continue
                val candidate = response.optString("url").trim().trimEnd('/')
                val responseHost = runCatching { URL(candidate).host }.getOrNull()
                if (response.optString("app") == "thuishub"
                    && response.optString("status") == "ok"
                    && responseHost == packet.address.hostAddress
                    && isSafeLocalServer(candidate)
                ) return@withContext candidate
            }
        }
        null
    }

    private suspend fun discoverServerOnLocalSubnet(): String? = coroutineScope {
        val connectivity = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val wifiNetwork = connectivity.allNetworks.firstOrNull { network ->
            connectivity.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
        }
        val candidateNetworks = listOfNotNull(wifiNetwork, connectivity.activeNetwork).distinct()
        val link = candidateNetworks.asSequence()
            .mapNotNull { connectivity.getLinkProperties(it) }
            .flatMap { it.linkAddresses.asSequence() }
            .firstOrNull { it.address is Inet4Address && it.address.isSiteLocalAddress }
            ?: return@coroutineScope null
        val address = link.address as Inet4Address
        val bytes = address.address.map { it.toInt() and 0xff }
        val prefixLength = link.prefixLength.coerceIn(22, 30)
        val hostBits = 32 - prefixLength
        val hostCount = 1 shl hostBits
        val localValue = bytes.fold(0) { value, part -> (value shl 8) or part }
        val networkMask = if (prefixLength == 0) 0 else -1 shl hostBits
        val networkValue = localValue and networkMask
        val candidates = (1 until hostCount - 1)
            .sortedBy { host -> minOf(host, hostCount - 1 - host) }
            .map { networkValue or it }
            .filter { it != localValue }
            .map { value ->
                val host = listOf(24, 16, 8, 0).joinToString(".") { shift -> ((value ushr shift) and 0xff).toString() }
                "http://$host:8788"
            }
        val found = CompletableDeferred<String?>()
        val semaphore = Semaphore(64)
        val jobs = candidates.map { candidate ->
            launch(Dispatchers.IO) {
                semaphore.withPermit {
                    if (!found.isCompleted && verifyServerFast(candidate)) found.complete(candidate)
                }
            }
        }
        val result = withTimeoutOrNull(12_000) { found.await() }
        jobs.forEach { it.cancel() }
        result
    }

    private fun verifyServerFast(candidate: String): Boolean {
        if (!isSafeLocalServer(candidate)) return false
        var socket: Socket? = null
        var connection: HttpURLConnection? = null
        return try {
            val url = URL(candidate)
            socket = Socket().apply { connect(InetSocketAddress(url.host, url.port), 550) }
            connection = (URL("$candidate/api/health").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 650
                readTimeout = 900
                instanceFollowRedirects = false
                useCaches = false
            }
            if (connection.responseCode != 200) return false
            val body = connection.inputStream.bufferedReader().use { it.readText().take(4_096) }
            val health = JSONObject(body)
            health.optString("app") == "thuishub" && health.optString("status") == "ok"
        } catch (_: Exception) {
            false
        } finally {
            runCatching { socket?.close() }
            connection?.disconnect()
        }
    }

    private fun isSafeLocalServer(candidate: String): Boolean {
        return try {
            val url = URL(candidate)
            if (url.protocol !in setOf("http", "https") || url.userInfo != null || url.query != null || url.ref != null) return false
            val host = url.host.lowercase().removePrefix("[").removeSuffix("]")
            if (host.isBlank() || host == "localhost" || host == "::1" || host.startsWith("127.") || host == "0.0.0.0") return false
            val ipv4 = host.split('.').mapNotNull { it.toIntOrNull() }
            if (ipv4.size == 4) return ipv4.all { it in 0..255 } && (ipv4[0] == 10 || ipv4[0] == 192 && ipv4[1] == 168 || ipv4[0] == 172 && ipv4[1] in 16..31)
            if (host.contains(':')) {
                val ipv6 = host.substringBefore('%')
                return ipv6.startsWith("fc") || ipv6.startsWith("fd") || Regex("^fe[89ab]").containsMatchIn(ipv6)
            }
            host.endsWith(".local") || !host.contains('.')
        } catch (_: Exception) { false }
    }

    private fun selectServer(candidate: String) {
        if (!connectionAttemptActive) return
        if (serverConfirmed && server != candidate) return
        val changedServer = server != candidate
        serverConfirmed = true
        connectionAttemptActive = false
        stopDiscovery()
        val editor = preferences.edit().putString("server", candidate)
        if (changedServer) editor.remove("deviceToken")
        editor.apply()
        updateStatus("ThuisHub gevonden op het thuisnetwerk.")
        if (token.isBlank()) {
            if (currentScreen != AppScreen.CONNECTING) showPairing()
            beginPairing()
        } else {
            showLibrary()
            startCommandPolling()
        }
    }

    private fun beginPairing() {
        if (pairingInProgress || server.isBlank()) return
        pairingInProgress = true
        pairingJob?.cancel()
        pairingJob = lifecycleScope.launch {
            try {
                updateStatus("Veilige koppelcode aanvragen…")
                val result = post("/api/devices/pair/request", pairingPayload())
                lastPairingCode = result.getString("code")
                pairingCode?.text = lastPairingCode
                updateStatus("Voer deze code in bij Dashboard → TV en afspeelapparaten.")
                pollPairing(result.getString("deviceId"), result.getString("pairingSecret"))
            } catch (error: Exception) {
                pairingInProgress = false
                lastPairingCode = ""
                updateStatus(error.message ?: "Koppelen is mislukt.")
            }
        }
    }

    private suspend fun pollPairing(deviceId: String, secret: String) {
        repeat(300) {
            delay(2_000)
            try {
                val result = post("/api/devices/pair/claim", JSONObject().put("deviceId", deviceId).put("pairingSecret", secret))
                when (result.optString("status")) {
                    "approved" -> {
                        preferences.edit().putString("deviceToken", result.getString("token")).apply()
                        pairingInProgress = false
                        lastPairingCode = ""
                        showLibrary()
                        startCommandPolling()
                        return
                    }
                    "expired" -> {
                        pairingInProgress = false
                        lastPairingCode = ""
                        updateStatus("De koppelcode is verlopen. Kies opnieuw koppelen.")
                        return
                    }
                }
            } catch (_: Exception) { /* Een korte netwerkonderbreking mag pairing niet afbreken. */ }
        }
        pairingInProgress = false
        lastPairingCode = ""
        updateStatus("De koppelcode is verlopen. Start opnieuw.")
    }

    private fun showLibrary() {
        if (token.isBlank()) { showPairing(); beginPairing(); return }
        currentScreen = AppScreen.LIBRARY
        updateScreenStatus = null
        root.removeAllViews()
        screenStatus = null
        pairingCode = null
        val screenWidthDp = resources.configuration.screenWidthDp.coerceAtLeast(320)
        val columns = if (isTelevision) 5 else when {
            screenWidthDp >= 840 -> 4
            screenWidthDp >= 600 -> 3
            else -> 2
        }
        val outerPadding = dp(if (isTelevision) 20 else 12)
        val gap = dp(if (isTelevision) 8 else 6)
        val availableWidth = (resources.displayMetrics.widthPixels - outerPadding * 2).coerceAtLeast(dp(280))
        val itemWidth = (availableWidth / columns).coerceAtLeast(dp(132))
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(outerPadding, outerPadding, outerPadding, outerPadding)
        }
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        header.addView(TextView(this).apply {
            text = "ThuisHub\n${if (isTelevision) "Android TV" else "Android"} $APP_VERSION"
            textSize = if (isTelevision) 26f else 22f
            setTextColor(0xffffffff.toInt())
        }, LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(Button(this).apply {
            text = "Home"
            isAllCaps = false
            setOnClickListener { showHome() }
        })
        header.addView(Button(this).apply {
            text = "Instellingen"
            isAllCaps = false
            setOnClickListener { showSettings() }
        })
        content.addView(header, LinearLayout.LayoutParams(-1, -2))
        content.addView(Button(this).apply {
            text = "App-updates"
            isAllCaps = false
            setOnClickListener { showUpdates() }
        }, LinearLayout.LayoutParams(-1, -2))
        val libraryStatus = TextView(this).apply {
            text = "Bibliotheek laden…"
            textSize = 16f
            setTextColor(0xffb8c8c0.toInt())
            setPadding(0, dp(10), 0, dp(10))
        }
        content.addView(libraryStatus)
        val grid = GridLayout(this).apply { columnCount = columns }
        content.addView(grid, LinearLayout.LayoutParams(-1, -2))
        val scroll = ScrollView(this).apply { addView(content) }
        root.addView(scroll, FrameLayout.LayoutParams(-1, -1))
        lifecycleScope.launch {
            try {
                val items = getArray("/api/device/library")
                libraryStatus.text = if (items.length() == 0) "Je bibliotheek is nog leeg." else "${items.length()} titels"
                for (index in 0 until items.length()) {
                    val item = items.getJSONObject(index)
                    val mediaId = item.getInt("id")
                    val button = Button(this@MainActivity).apply {
                        text = if (item.optString("kind") == "episode") "${item.optString("seriesTitle")}\nS${item.optInt("season")} A${item.optInt("episode")}" else item.optString("title")
                        minHeight = 150
                        isFocusable = true
                        isAllCaps = false
                        gravity = Gravity.CENTER
                        setOnClickListener { lifecycleScope.launch { playMedia(mediaId) } }
                    }
                    grid.addView(button, GridLayout.LayoutParams().apply {
                        width = itemWidth - gap * 2
                        height = dp(if (isTelevision) 92 else 112)
                        setMargins(gap, gap, gap, gap)
                    })
                }
            } catch (error: HttpFailure) {
                if (error.status == 401) {
                    preferences.edit().remove("deviceToken").apply()
                    showPairing()
                    beginPairing()
                } else showToast(error.message)
            } catch (error: Exception) { showToast(error.message) }
        }
    }

    private suspend fun playMedia(mediaId: Int): Boolean {
        if (mediaId <= 0) return false
        return try {
            val response = postAuthorized("/api/device/media/$mediaId/session", JSONObject().put("quality", "auto"))
            val uri = response.getJSONObject("urls").getString("playback")
            val session = response.getJSONObject("session")
            startPlayback(mediaId, uri, sessionId = session.getString("id"), startPositionSeconds = session.optDouble("position", 0.0))
        } catch (error: Exception) {
            showToast(error.message)
            false
        }
    }

    private fun playCommandPayload(payload: JSONObject): Boolean {
        val mediaId = payload.optInt("mediaId")
        val sessionId = payload.optString("sessionId").trim()
        val uri = payload.optJSONObject("urls")?.optString("playback").orEmpty().trim()
        val startPosition = when {
            payload.has("position") -> payload.optDouble("position", 0.0)
            payload.has("positionSeconds") -> payload.optDouble("positionSeconds", 0.0)
            else -> 0.0
        }
        if (mediaId <= 0 || sessionId.isBlank() || !isSafePlaybackUrl(uri)) return false
        if (currentMediaId == mediaId && currentSessionId == sessionId && player != null) return true
        return startPlayback(mediaId, uri, sessionId, startPosition)
    }

    private fun startPlayback(mediaId: Int, uri: String, sessionId: String, startPositionSeconds: Double): Boolean {
        releasePlayback()
        try {
            currentScreen = AppScreen.PLAYER
            val view = PlayerView(this@MainActivity)
            root.removeAllViews()
            root.addView(view, FrameLayout.LayoutParams(-1, -1))
            val nextPlayer = ExoPlayer.Builder(this@MainActivity).build()
            player = nextPlayer
            currentMediaId = mediaId
            currentSessionId = sessionId
            view.player = nextPlayer
            nextPlayer.setMediaItem(MediaItem.fromUri(uri))
            nextPlayer.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (playbackState == Player.STATE_ENDED && player === nextPlayer) stopPlayback(showLibraryAfter = true)
                }

                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    if (isPlaying && player === nextPlayer) reportPlayerState(mediaId, sessionId, nextPlayer, "playing")
                }

                override fun onPlayerError(error: PlaybackException) {
                    if (player !== nextPlayer) return
                    reportPlayerState(mediaId, sessionId, nextPlayer, "error")
                    releasePlayback()
                    showLibrary()
                    showToast(error.message)
                }
            })
            if (startPositionSeconds.isFinite() && startPositionSeconds > 0) {
                nextPlayer.seekTo((startPositionSeconds * 1000).toLong().coerceAtLeast(0))
            }
            nextPlayer.prepare()
            nextPlayer.playWhenReady = true
            mediaSession = MediaSession.Builder(this@MainActivity, nextPlayer).build()
            startProgressSync(mediaId, nextPlayer)
            return true
        } catch (error: Exception) {
            reportPlayerState(mediaId, sessionId, player, "error")
            releasePlayback()
            throw error
        }
    }

    private fun startProgressSync(mediaId: Int, activePlayer: ExoPlayer) {
        progressJob?.cancel()
        progressJob = lifecycleScope.launch {
            while (isActive && player === activePlayer && currentMediaId == mediaId) {
                delay(10_000)
                if (player !== activePlayer || currentMediaId != mediaId) break
                val duration = activePlayer.duration.coerceAtLeast(0)
                runCatching {
                    putAuthorized("/api/device/media/$mediaId/progress", JSONObject()
                        .put("sessionId", currentSessionId)
                        .put("position", activePlayer.currentPosition.coerceAtLeast(0) / 1000.0)
                        .put("duration", duration / 1000.0)
                        .put("state", if (activePlayer.isPlaying) "playing" else "paused"))
                }
            }
        }
    }

    private fun startCommandPolling() {
        if (commandJob?.isActive == true) return
        commandJob = lifecycleScope.launch {
            while (isActive && token.isNotBlank()) {
                delay(2_000)
                try {
                    val commands = JSONObject(request("/api/device/commands", "GET", null, true)).optJSONArray("items") ?: JSONArray()
                    for (index in 0 until commands.length()) {
                        val entry = commands.getJSONObject(index)
                        val id = entry.getLong("id")
                        val executed = id in executedCommandIds || executeCommand(entry)
                        if (executed) {
                            executedCommandIds.add(id)
                            try {
                                postAuthorized("/api/device/commands/$id/ack", JSONObject())
                                executedCommandIds.remove(id)
                            } catch (_: Exception) { /* Alleen de ack opnieuw proberen, niet de opdracht. */ }
                        }
                    }
                } catch (_: Exception) { /* Rustig opnieuw proberen zolang de app gekoppeld is. */ }
            }
        }
    }

    private suspend fun executeCommand(entry: JSONObject): Boolean {
        val payload = entry.optJSONObject("payload") ?: JSONObject()
        return try {
            val command = entry.optString("command")
            val commandSessionId = payload.optString("sessionId").trim()
            if (command != "load" && commandSessionId.isNotBlank() && currentSessionId.isNotBlank() && commandSessionId != currentSessionId) return true
            when (command) {
                "play" -> player?.let { it.play(); true } ?: false
                "pause" -> player?.let { it.pause(); true } ?: false
                "stop" -> stopPlayback(showLibraryAfter = true)
                "seek" -> player?.let {
                    val position = if (payload.has("positionSeconds")) payload.optLong("positionSeconds") * 1000
                    else it.currentPosition + payload.optLong("deltaSeconds") * 1000
                    it.seekTo(position.coerceAtLeast(0)); true
                } ?: false
                "volume" -> player?.let { it.volume = payload.optDouble("level", 1.0).toFloat().coerceIn(0f, 1f); true } ?: false
                "disconnect" -> { stopPlayback(showLibraryAfter = false); showLibrary(); true }
                "load" -> playCommandPayload(payload)
                else -> false
            }
        } catch (_: Exception) { false }
    }

    private fun stopPlayback(showLibraryAfter: Boolean): Boolean {
        val activePlayer = player
        val mediaId = currentMediaId
        val sessionId = currentSessionId
        val hadPlayer = activePlayer != null
        if (activePlayer != null && mediaId > 0) reportPlayerState(mediaId, sessionId, activePlayer, "stopped")
        releasePlayback()
        if (showLibraryAfter) showLibrary()
        return hadPlayer
    }

    private fun reportPlayerState(mediaId: Int, sessionId: String, activePlayer: Player?, state: String) {
        if (mediaId <= 0 || sessionId.isBlank()) return
        val payload = JSONObject()
            .put("sessionId", sessionId)
            .put("position", activePlayer?.currentPosition?.coerceAtLeast(0)?.div(1000.0) ?: 0.0)
            .put("duration", activePlayer?.duration?.coerceAtLeast(0)?.div(1000.0) ?: 0.0)
            .put("state", state)
        lifecycleScope.launch { runCatching { putAuthorized("/api/device/media/$mediaId/progress", payload) } }
    }

    private fun releasePlayback() {
        progressJob?.cancel()
        progressJob = null
        mediaSession?.release()
        mediaSession = null
        player?.release()
        player = null
        currentMediaId = 0
        currentSessionId = ""
    }

    private fun isSafePlaybackUrl(value: String): Boolean {
        return try {
            val url = URL(value)
            if (url.protocol !in setOf("http", "https") || url.userInfo != null || url.ref != null) return false
            if (!url.path.startsWith("/api/playback/")) return false
            val host = if (url.host.contains(':')) "[${url.host}]" else url.host
            val port = if (url.port >= 0) ":${url.port}" else ""
            isSafeLocalServer("${url.protocol}://$host$port")
        } catch (_: Exception) { false }
    }

    private fun pairingPayload(): JSONObject {
        val decoders = MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos.filter { !it.isEncoder }
        val mimeTypes = decoders.flatMap { it.supportedTypes.toList() }.map { it.lowercase() }.toSet()
        fun supports(vararg candidates: String) = candidates.any { it.lowercase() in mimeTypes }
        val videoCodecs = buildList {
            if (supports("video/avc")) add("h264")
            if (supports("video/hevc")) add("hevc")
            if (supports("video/x-vnd.on2.vp9")) add("vp9")
            if (supports("video/av01")) add("av1")
        }
        val audioCodecs = buildList {
            if (supports("audio/mp4a-latm")) add("aac")
            if (supports("audio/ac3")) add("ac3")
            if (supports("audio/eac3", "audio/eac3-joc")) add("eac3")
            if (supports("audio/true-hd")) add("truehd")
            if (supports("audio/vnd.dts", "audio/vnd.dts.hd")) add("dts")
            if (supports("audio/flac")) add("flac")
            if (supports("audio/opus")) add("opus")
        }
        val maxAudioChannels = decoders.flatMap { codec ->
            codec.supportedTypes.filter { it.startsWith("audio/", ignoreCase = true) }.mapNotNull { type ->
                runCatching { codec.getCapabilitiesForType(type).audioCapabilities?.maxInputChannelCount }.getOrNull()
            }
        }.maxOrNull()?.coerceIn(2, 8) ?: 2
        @Suppress("DEPRECATION")
        val activeDisplay = (getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay
        val mode = activeDisplay.mode
        val hdrTypes = activeDisplay.hdrCapabilities?.supportedHdrTypes?.toSet() ?: emptySet()
        val hdrFormats = buildList {
            add("sdr")
            if (Display.HdrCapabilities.HDR_TYPE_HDR10 in hdrTypes) add("hdr10")
            if (Display.HdrCapabilities.HDR_TYPE_HLG in hdrTypes) add("hlg")
            if (Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS in hdrTypes) add("hdr10plus")
            if (Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION in hdrTypes && supports("video/dolby-vision")) add("dolby-vision")
        }
        val maxWidth = mode?.physicalWidth ?: 1920
        val maxHeight = mode?.physicalHeight ?: 1080
        val eac3 = "eac3" in audioCodecs
        val dts = "dts" in audioCodecs
        return JSONObject()
            .put("id", stableDeviceId)
            .put("name", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
            .put("manufacturer", android.os.Build.MANUFACTURER)
            .put("model", android.os.Build.MODEL)
            .put("platform", if (isTelevision) "android-tv" else "android-mobile")
            .put("deviceType", if (isTelevision) "television" else "display")
            .put("appVersion", APP_VERSION)
            .put("capabilities", JSONObject()
                .put("maxWidth", maxWidth)
                .put("maxHeight", maxHeight)
                .put("maxFrameRate", mode?.refreshRate ?: 60)
                .put("maxBitrateMbps", if (maxWidth >= 3840 || maxHeight >= 2160) 60 else 20)
                .put("containers", JSONArray(listOf("mp4", "mkv", "mpegts", "webm")))
                .put("videoCodecs", JSONArray(videoCodecs))
                .put("maxBitDepth", if (hdrTypes.isEmpty()) 8 else 10)
                .put("hdrFormats", JSONArray(hdrFormats))
                .put("dolbyVisionProfiles", JSONArray())
                .put("audioCodecs", JSONArray(audioCodecs))
                .put("maxAudioChannels", maxAudioChannels)
                .put("passthrough", false)
                .put("atmos", false)
                .put("trueHd", false)
                .put("eac3", eac3)
                .put("dts", dts)
                .put("subtitleFormats", JSONArray(listOf("srt", "webvtt")))
                .put("play", true)
                .put("pause", true)
                .put("stop", true)
                .put("seek", true)
                .put("position", true)
                .put("volume", true)
                .put("next", false)
                .put("previous", false)
                .put("audioTrackSelection", false)
                .put("subtitleTrackSelection", false)
                .put("qualitySelection", false)
                .put("arc", "unknown"))
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun showToast(message: String?) = Toast.makeText(this, message ?: "Onbekende fout", Toast.LENGTH_LONG).show()
    private suspend fun getArray(path: String) = JSONArray(request(path, "GET", null, true))
    private suspend fun post(path: String, body: JSONObject) = JSONObject(request(path, "POST", body.toString(), false))
    private suspend fun postAuthorized(path: String, body: JSONObject) = JSONObject(request(path, "POST", body.toString(), true))
    private suspend fun putAuthorized(path: String, body: JSONObject) = JSONObject(request(path, "PUT", body.toString(), true))

    private suspend fun request(path: String, method: String, body: String?, authorized: Boolean) = rawRequest(server, path, method, body, authorized)

    private suspend fun rawRequest(base: String, path: String, method: String, body: String?, authorized: Boolean): String = withContext(Dispatchers.IO) {
        if (base.isBlank()) throw IllegalStateException("ThuisHub is nog niet gevonden.")
        val connection = (URL(base + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 8_000
            readTimeout = 15_000
            setRequestProperty("Content-Type", "application/json")
            if (authorized && token.isNotBlank()) setRequestProperty("Authorization", "Device $token")
            doOutput = body != null
        }
        try {
            if (body != null) connection.outputStream.use { it.write(body.toByteArray()) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            if (status !in 200..299) {
                val message = runCatching { JSONObject(text).optString("error") }.getOrNull().orEmpty().ifBlank { "Serverfout $status" }
                throw HttpFailure(status, message)
            }
            text
        } finally { connection.disconnect() }
    }

    override fun onDestroy() {
        connectionJob?.cancel()
        updateJob?.cancel()
        updateDownloadDialog?.dismiss()
        pairingJob?.cancel()
        commandJob?.cancel()
        releasePlayback()
        stopDiscovery()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            player != null -> stopPlayback(showLibraryAfter = true)
            currentScreen == AppScreen.SETTINGS -> showHome()
            currentScreen == AppScreen.UPDATES -> showHome()
            currentScreen == AppScreen.CONNECTING -> {
                stopConnectionAttempt()
                lastConnectionStatus = "Koppelen geannuleerd."
                showHome()
            }
            else -> super.onBackPressed()
        }
    }
}

private enum class AppScreen { HOME, SETTINGS, UPDATES, CONNECTING, LIBRARY, PLAYER }

private data class AndroidUpdate(val version: String, val tag: String, val assetName: String, val sha256: String)

private class HttpFailure(val status: Int, message: String) : IllegalStateException(message)
