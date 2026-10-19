plugins {
	id("com.android.application")
	id("org.jetbrains.kotlin.android")
}

android {
	namespace = "com.sercatdar.tgbridge"
	compileSdk = 34

	defaultConfig {
		applicationId = "com.sercatdar.tgbridge"
		minSdk = 26
		targetSdk = 34
		versionCode = 13
		versionName = "0.1.13"
	}

	buildTypes {
		release {
			isMinifyEnabled = false
		}
	}

	compileOptions {
		sourceCompatibility = JavaVersion.VERSION_17
		targetCompatibility = JavaVersion.VERSION_17
	}
	kotlinOptions {
		jvmTarget = "17"
	}

	packaging {
		resources {
			excludes += "/META-INF/{AL2.0,LGPL2.1}"
		}
	}
}

dependencies {
	implementation("androidx.core:core-ktx:1.13.1")
	implementation("androidx.appcompat:appcompat:1.7.0")

	// TDLib — precompiled, все 4 ABI, без локальной компиляции C++
	implementation("io.github.tdlib-android:core:0.1.1")
	implementation("io.github.tdlib-android:ktx:0.1.1")
	implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

	// встроенный HTTP-сервер для эндпоинтов часов
	implementation("org.nanohttpd:nanohttpd:2.3.1")

	// та же JSON-библиотека, что и в остальном Android SDK
	implementation("org.json:json:20240303")
}
