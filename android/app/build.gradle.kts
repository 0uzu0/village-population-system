import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

/**
 * 服务端地址在打包时注入，让同一份代码能出「内网测试」和「生产」两个包：
 *   ./gradlew assembleRelease -PapiBaseUrl=https://pop.example.gov.cn
 * 不传则用占位地址；安装后还能在「我的 → 服务器设置」里改（存 DataStore），
 * 这一条对村级场景是刚需：同一个 APK 要发给几十个村，各村的服务器地址不一样。
 */
val apiBaseUrl: String = (project.findProperty("apiBaseUrl") as String?) ?: "https://work.zerolin.fun:11127/"

/** 版本号由 CI 注入（run_number / tag），本地构建用默认值 */
val appVersionCode: Int = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 1
val appVersionName: String = (project.findProperty("versionName") as String?) ?: "2.0.1"

/**
 * 正式包签名从环境变量读取（CI 用 secrets 注入）。
 * 没提供时回退到 debug 签名——这样 CI 永远能给出一个「能装上、能跑」的 APK，
 * 而不是一个谁也装不了的 unsigned 包。缺失签名这件事在 CI 日志里会有明确提示。
 *
 * ⚠️ 必须过滤空串：CI 里这个变量是「按条件赋值」的，未配置签名时会传成空串，
 * 而 System.getenv() 对「已设置但为空」返回 ""（不是 null）。只判 null 的话，
 * 会走进 create("release") 分支并把 storeFile 指向空路径，构建直接失败。
 */
val keystorePath: String? = System.getenv("ANDROID_KEYSTORE_PATH")?.takeIf { it.isNotBlank() }

android {
    namespace = "com.village.population"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.village.population"
        minSdk = 24
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName

        // 只保留中文资源，省掉其它语言包的开销
        resourceConfigurations += listOf("zh")

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            /**
             * 暂不开 R8。
             * kotlinx.serialization 靠「编译期生成的 serializer + 反射查找 Companion」工作，
             * 混淆规则写不对的典型症状是「能装上、一进页面就崩」——而这类问题只有真机冒烟
             * 才能发现，CI 的编译通过不代表没问题。所以先用不混淆的 release 包把链路跑通，
             * 真机验证后再把 isMinifyEnabled 打开（规则已写在 proguard-rules.pro 里）。
             */
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig =
                if (keystorePath != null) signingConfigs.getByName("release")
                else signingConfigs.getByName("debug")
        }

        debug {
            // 加后缀，让「正式包」和「调试包」能同时装在一台手机上排查问题
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf(
            "/META-INF/{AL2.0,LGPL2.1}",
            "/META-INF/DEPENDENCIES",
            "/META-INF/LICENSE*",
        )
    }

    testOptions {
        unitTests.isIncludeAndroidResources = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    debugImplementation(libs.androidx.ui.tooling)

    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.work.runtime.ktx)

    implementation(libs.retrofit)
    implementation(libs.retrofit.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    implementation(libs.coil.compose)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
