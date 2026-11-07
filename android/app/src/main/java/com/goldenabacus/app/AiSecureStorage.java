package com.goldenabacus.app;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** AI 配置密文保存在应用私有目录，密钥由 Android Keystore 管理。 */
@CapacitorPlugin(name = "AiSecureStorage")
public class AiSecureStorage extends Plugin {
    // 专用别名与安装包签名无关。
    private static final String ALIAS = "golden-abacus-ai-config";

    /** 独立于账本和备份存储。 */
    private SharedPreferences storage() {
        return getContext().getSharedPreferences(ALIAS, 0);
    }

    /** 读取时不生成新密钥，避免掩盖原密钥丢失。 */
    private SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        if (!create) throw new IllegalStateException();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build());
        return generator.generateKey();
    }

    /** 认证解密失败时只返回可操作提示，不记录配置。 */
    @PluginMethod
    public synchronized void get(PluginCall call) {
        try {
            String encrypted = storage().getString("ciphertext", null);
            String value = "";
            if (encrypted != null) {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                byte[] iv = Base64.decode(storage().getString("iv", ""), Base64.NO_WRAP);
                cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, iv));
                value = new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8);
            }
            call.resolve(new JSObject().put("value", value));
        } catch (Exception error) {
            call.reject("无法解密 AI 配置，请清除后重新填写");
        }
    }

    /** 每次写入使用随机 IV，密文和 IV 在同一次提交中保存。 */
    @PluginMethod
    public synchronized void set(PluginCall call) {
        try {
            String value = call.getString("value");
            if (value == null || value.length() > 16000) throw new IllegalArgumentException();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key(true));
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            if (!storage().edit().putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).commit()) throw new IllegalStateException();
            call.resolve();
        } catch (Exception error) {
            call.reject("无法保存 AI 配置，请重试");
        }
    }

    /** 清除专用密文与密钥，失败由用户重试。 */
    @PluginMethod
    public synchronized void clear(PluginCall call) {
        try {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            store.deleteEntry(ALIAS);
            if (!storage().edit().clear().commit()) throw new IllegalStateException();
            call.resolve();
        } catch (Exception error) {
            call.reject("无法清除 AI 配置，请重试");
        }
    }
}
