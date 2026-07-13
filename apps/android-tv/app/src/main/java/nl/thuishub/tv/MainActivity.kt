package nl.thuishub.tv

import android.media.MediaCodecList
import android.os.Bundle
import android.view.Display
import android.view.Gravity
import android.view.ViewGroup
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : ComponentActivity() {
    private lateinit var root: FrameLayout
    private var player: ExoPlayer? = null
    private var mediaSession: MediaSession? = null
    private val preferences by lazy { getSharedPreferences("thuishub", MODE_PRIVATE) }
    private val server get() = preferences.getString("server", "")!!.trimEnd('/')
    private val token get() = preferences.getString("deviceToken", "")!!

    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); root=FrameLayout(this);setContentView(root);if(token.isBlank())showPairing() else { showLibrary(); startCommandPolling() } }

    private fun showPairing() {
        root.removeAllViews();val column=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;gravity=Gravity.CENTER;setPadding(96,64,96,64)}
        val title=TextView(this).apply{text="ThuisHub koppelen";textSize=34f;setTextColor(0xffffffff.toInt())}
        val address=EditText(this).apply{hint="http://192.168.1.10:8788";setText(preferences.getString("server",""));setTextColor(0xffffffff.toInt());setHintTextColor(0xff80958c.toInt());minWidth=620}
        val code=TextView(this).apply{textSize=52f;letterSpacing=.22f;setTextColor(0xffd9ff3f.toInt());gravity=Gravity.CENTER}
        val status=TextView(this).apply{text="Vul het privé-LAN-adres uit ThuisHub in.";textSize=18f;setTextColor(0xffb8c8c0.toInt())}
        val button=Button(this).apply {
            text="Koppelcode maken"
            setOnClickListener {
                val value=address.text.toString().trimEnd('/')
                if(!value.startsWith("http://")&&!value.startsWith("https://")){status.text="Gebruik een volledig http(s)-adres.";return@setOnClickListener}
                preferences.edit().putString("server",value).apply()
                lifecycleScope.launch {
                    try { val request=post("/api/devices/pair/request",pairingPayload());code.text=request.getString("code");status.text="Voer deze code in bij Dashboard → TV en afspeelapparaten";pollPairing(request.getString("deviceId"),request.getString("pairingSecret"),status) }
                    catch(error:Exception){status.text=error.message}
                }
            }
        }
        column.addView(title);column.addView(address);column.addView(button);column.addView(code);column.addView(status);root.addView(column,FrameLayout.LayoutParams(-1,-1))
    }

    private suspend fun pollPairing(deviceId:String,secret:String,status:TextView){repeat(300){delay(2000);val result=post("/api/devices/pair/claim",JSONObject().put("deviceId",deviceId).put("pairingSecret",secret));when(result.getString("status")){"approved"->{preferences.edit().putString("deviceToken",result.getString("token")).apply();showLibrary();startCommandPolling();return};"expired"->{status.text="De koppelcode is verlopen.";return}}}}

    private fun showLibrary(){root.removeAllViews();val scroll=ScrollView(this);val grid=GridLayout(this).apply{columnCount=5;setPadding(40,32,40,32)};scroll.addView(grid);root.addView(scroll,FrameLayout.LayoutParams(-1,-1));lifecycleScope.launch{try{val items=getArray("/api/device/library");for(i in 0 until items.length()){val item=items.getJSONObject(i);val button=Button(this@MainActivity).apply{text=if(item.optString("kind")=="episode")"${item.optString("seriesTitle")}\nS${item.optInt("season")} A${item.optInt("episode")}" else item.optString("title");minHeight=150;isFocusable=true;setOnClickListener{play(item)}};grid.addView(button,ViewGroup.LayoutParams(300,180))}}catch(error:Exception){Toast.makeText(this@MainActivity,error.message,Toast.LENGTH_LONG).show()}}}

    private fun play(item:JSONObject){lifecycleScope.launch{try{val response=postAuthorized("/api/device/media/${item.getInt("id")}/decision",JSONObject().put("quality","auto").put("network","lan"));val uri=response.getJSONObject("urls").getString("playback");root.removeAllViews();val view=PlayerView(this@MainActivity);root.addView(view,FrameLayout.LayoutParams(-1,-1));player=ExoPlayer.Builder(this@MainActivity).build().also{view.player=it;it.setMediaItem(MediaItem.fromUri(uri));it.prepare();it.playWhenReady=true;mediaSession=MediaSession.Builder(this@MainActivity,it).build()};syncProgress(item.getInt("id"))}catch(error:Exception){Toast.makeText(this@MainActivity,error.message,Toast.LENGTH_LONG).show()}}}

    private fun syncProgress(mediaId:Int)=lifecycleScope.launch{while(isActive&&player!=null){delay(10_000);player?.let{putAuthorized("/api/device/media/$mediaId/progress",JSONObject().put("position",it.currentPosition/1000.0).put("duration",it.duration.coerceAtLeast(0)/1000.0))}}}

    private fun startCommandPolling()=lifecycleScope.launch { while(isActive&&token.isNotBlank()){delay(2_000);try{val commands=JSONObject(request("/api/device/commands","GET",null,true)).getJSONArray("items");for(i in 0 until commands.length()){val entry=commands.getJSONObject(i);val payload=entry.optJSONObject("payload")?:JSONObject();when(entry.getString("command")){"play"->player?.play();"pause"->player?.pause();"stop"->{player?.stop();player=null;showLibrary()};"seek"->player?.seekTo(if(payload.has("positionSeconds"))payload.optLong("positionSeconds")*1000 else (player?.currentPosition?:0)+payload.optLong("deltaSeconds")*1000);"volume"->player?.volume=payload.optDouble("level",1.0).toFloat().coerceIn(0f,1f);"disconnect"->{mediaSession?.release();player?.release();player=null;preferences.edit().remove("deviceToken").apply();showPairing()};"load"->if(payload.has("mediaId"))play(JSONObject().put("id",payload.getInt("mediaId")))};postAuthorized("/api/device/commands/${entry.getInt("id")}/ack",JSONObject())}}catch(_:Exception){}} }

    private fun pairingPayload():JSONObject{val codecs=MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos.flatMap{it.supportedTypes.toList()};val mode=display?.mode;val hdr=display?.hdrCapabilities?.supportedHdrTypes?.toList()?:emptyList();return JSONObject().put("name","${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}").put("manufacturer",android.os.Build.MANUFACTURER).put("model",android.os.Build.MODEL).put("platform","android-tv").put("appVersion","1.2.2").put("capabilities",JSONObject().put("maxWidth",mode?.physicalWidth?:1920).put("maxHeight",mode?.physicalHeight?:1080).put("maxFrameRate",mode?.refreshRate?:60).put("maxBitrateMbps",80).put("containers",JSONArray(listOf("mp4","mkv","mpegts","webm"))).put("videoCodecs",JSONArray(listOf("h264","hevc","vp9","av1").filter{codec->codecs.any{it.contains(codec,true)||(codec=="h264"&&it.contains("avc",true))}})).put("maxBitDepth",10).put("hdrFormats",JSONArray(if(hdr.isEmpty())listOf("sdr") else listOf("sdr","hdr10","hlg","dolby-vision"))).put("dolbyVisionProfiles",JSONArray(listOf(5,8))).put("audioCodecs",JSONArray(listOf("aac","ac3","eac3","truehd","dts","flac","opus"))).put("maxAudioChannels",8).put("passthrough",true).put("atmos",true).put("trueHd",true).put("eac3",true).put("dts",true).put("subtitleFormats",JSONArray(listOf("srt","webvtt","ass","pgs"))).put("arc","unknown"))}

    private suspend fun getArray(path:String)=request(path,"GET",null).let{JSONArray(it)}
    private suspend fun post(path:String,body:JSONObject)=JSONObject(request(path,"POST",body.toString(),false))
    private suspend fun postAuthorized(path:String,body:JSONObject)=JSONObject(request(path,"POST",body.toString(),true))
    private suspend fun putAuthorized(path:String,body:JSONObject)=JSONObject(request(path,"PUT",body.toString(),true))
    private suspend fun request(path:String,method:String,body:String?,authorized:Boolean=true):String = withContext(Dispatchers.IO) { val connection=(URL(server+path).openConnection() as HttpURLConnection).apply{requestMethod=method;connectTimeout=8000;readTimeout=15000;setRequestProperty("Content-Type","application/json");if(authorized&&token.isNotBlank())setRequestProperty("Authorization","Device $token");doOutput=body!=null};try{if(body!=null)connection.outputStream.use{it.write(body.toByteArray())};val responseCode=connection.responseCode;val stream=if(responseCode in 200..299)connection.inputStream else connection.errorStream;val text=stream.bufferedReader().use{it.readText()};if(responseCode !in 200..299)throw IllegalStateException(JSONObject(text).optString("error","Serverfout $responseCode"));text}finally{connection.disconnect()} }

    override fun onDestroy(){mediaSession?.release();player?.release();super.onDestroy()}
    override fun onBackPressed(){if(player!=null){mediaSession?.release();player?.release();player=null;showLibrary()}else super.onBackPressed()}
}
