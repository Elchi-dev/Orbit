# R8 rules for Orbit.

# Firebase is looked up by name (dev.elchi.orbit.push.Push), so builds that
# have it keep the object and its INSTANCE field.
-keep class dev.elchi.orbit.push.FirebasePush { public static ** INSTANCE; }

# kotlinx.serialization: the library ships its own rules; these keep the
# generated serializers of the app's own @Serializable classes.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers @kotlinx.serialization.Serializable class dev.elchi.orbit.** {
    static ** Companion;
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class dev.elchi.orbit.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class dev.elchi.orbit.**$$serializer { *; }

# Tink: only the subtle X25519 and HKDF classes are used; it refers to
# annotations and optional providers that aren't on Android.
-keep class com.google.crypto.tink.subtle.X25519 { *; }
-keep class com.google.crypto.tink.subtle.Hkdf { *; }
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn com.google.api.client.**
-dontwarn org.joda.time.**
-dontwarn org.conscrypt.**

# OkHttp ships its rules; these optional TLS providers aren't present.
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
