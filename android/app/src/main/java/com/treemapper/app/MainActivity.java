package com.treemapper.app;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginResult;
import java.io.OutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;

public class MainActivity extends BridgeActivity {

    private ImportHelper importHelper;
    private ActivityResultLauncher<String[]> pickFileLauncher;

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        pickFileLauncher = registerForActivityResult(
            new ActivityResultContracts.OpenDocument(),
            uri -> {
                if (uri != null && importHelper != null) {
                    importHelper.handleFileResult(uri);
                }
            }
        );
    }

    @Override
    public void onStart() {
        super.onStart();
        importHelper = new ImportHelper(this, pickFileLauncher, bridge.getWebView());
        bridge.getWebView().addJavascriptInterface(new ExportHelper(this), "ExportHelper");
        bridge.getWebView().addJavascriptInterface(importHelper, "ImportHelper");
    }

    public class ExportHelper {
        private Context ctx;
        public ExportHelper(Context c) { ctx = c; }

        @JavascriptInterface
        public void saveCSV(String content, String fileName) {
            try {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, "text/csv");
                values.put(MediaStore.Downloads.RELATIVE_PATH, "Download/TreeMapper");
                Uri uri = ctx.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri != null) {
                    OutputStream os = ctx.getContentResolver().openOutputStream(uri);
                    os.write(content.getBytes("UTF-8"));
                    os.close();
                    runOnUiThread(() -> Toast.makeText(ctx, "已保存: Download/TreeMapper/" + fileName, Toast.LENGTH_LONG).show());
                }
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(ctx, "保存失败: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }
    }

    public class ImportHelper {
        private Context ctx;
        private ActivityResultLauncher<String[]> launcher;
        private WebView webView;

        public ImportHelper(Context c, ActivityResultLauncher<String[]> l, WebView wv) {
            ctx = c;
            launcher = l;
            webView = wv;
        }

        @JavascriptInterface
        public void pickCSV() {
            launcher.launch(new String[]{"text/csv", "text/comma-separated-values", "text/plain", "*/*"});
        }

        public void handleFileResult(Uri uri) {
            try {
                String fileName = getFileName(uri);
                String base64 = readBytesAsBase64(uri);
                String escapedName = fileName.replace("\\", "\\\\").replace("'", "\\'");
                webView.post(() ->
                    webView.evaluateJavascript(
                        "if(window._onCSVFilePicked){window._onCSVFilePicked('" + escapedName + "','" + base64 + "');}",
                        null
                    )
                );
            } catch (Exception e) {
                String escapedMsg = e.getMessage() != null ? e.getMessage().replace("\\", "\\\\").replace("'", "\\'") : "未知错误";
                webView.post(() ->
                    webView.evaluateJavascript(
                        "if(window._onCSVFilePickedError){window._onCSVFilePickedError('" + escapedMsg + "');}",
                        null
                    )
                );
            }
        }

        private String getFileName(Uri uri) {
            String name = "unknown.csv";
            try (android.database.Cursor cursor = ctx.getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (idx >= 0) name = cursor.getString(idx);
                }
            } catch (Exception e) { /* fallback to default name */ }
            return name;
        }

        private String readBytesAsBase64(Uri uri) throws Exception {
            InputStream is = ctx.getContentResolver().openInputStream(uri);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = is.read(buffer)) != -1) {
                baos.write(buffer, 0, bytesRead);
            }
            is.close();
            return Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
        }
    }
}
