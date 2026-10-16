// 根构建脚本只负责声明插件版本，具体配置在各模块里。
// 插件版本统一放在 gradle/libs.versions.toml，避免版本号散落在多处。
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
