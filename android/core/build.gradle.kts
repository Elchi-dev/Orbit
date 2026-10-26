// The protocol and the client state, with no Android in it: the app uses it,
// and the JVM tests (including the integration test against a real Orbit) run it.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

dependencies {
    api(libs.kotlinx.coroutines.core)
    api(libs.kotlinx.serialization.json)
    api(libs.okhttp)
    implementation(libs.tink.android)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}

val itLink: String = providers.gradleProperty("orbit.it.link").getOrElse("")
val itUrl: String = providers.gradleProperty("orbit.it.url").getOrElse("")
val itCookie: String = providers.gradleProperty("orbit.it.cookie").getOrElse("")
val vectors: String = rootProject.file("../docs/remote-vectors.json").absolutePath

tasks.test {
    // The integration test talks to a real Orbit and relay; it runs only when
    // -Porbit.it.link=<pairing link> is given; with -Porbit.it.url and
    // -Porbit.it.cookie it also checks that forgetting the phone in Orbit is noticed.
    // See android/README.md.
    systemProperty("orbit.it.link", itLink)
    systemProperty("orbit.it.url", itUrl)
    systemProperty("orbit.it.cookie", itCookie)
    systemProperty("orbit.it.out", layout.buildDirectory.dir("it").get().asFile.absolutePath)
    systemProperty("orbit.vectors", vectors)
    inputs.property("orbitItLink", itLink)
    testLogging {
        events("failed", "skipped")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
        showStandardStreams = itLink.isNotEmpty()
    }
}
