# =============================================================
# 混淆规则（当前 release 未开 R8，isMinifyEnabled = false）
# 规则先写好放在这里，真机冒烟通过后把 app/build.gradle.kts 里的
# isMinifyEnabled 改成 true 即可生效，不需要再补规则。
# =============================================================

# ---- Retrofit / OkHttp ----
# Retrofit 的默认方法（接口里的 Kotlin suspend 函数会编译成带 @JvmDefault 的形态）
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}
-dontwarn javax.annotation.**
-dontwarn kotlin.Unit
-dontwarn retrofit2.KotlinExtensions
-dontwarn retrofit2.KotlinExtensions$*
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# ---- kotlinx.serialization ----
# 关键：@Serializable 生成的 $$serializer 与 Companion.serializer() 靠名字反射查找，
# 被混淆掉就会出现 "Serializer for class X is not found" 的运行时崩溃。
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.village.population.**$$serializer { *; }
-keepclassmembers class com.village.population.** {
    *** Companion;
}
-keepclasseswithmembers class com.village.population.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# 网络 DTO 与离线队列的记录类：字段名就是 JSON 键名，不能被改写
-keep class com.village.population.data.remote.dto.** { *; }
-keep class com.village.population.data.local.queue.** { *; }

# ---- WorkManager ----
# Worker 由系统按类名实例化，混淆后找不到类
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
-keep class * extends androidx.work.CoroutineWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
