# Orbit for Android

The phone companion to Orbit. It reaches Orbit on your computer from anywhere
through your relay, end to end encrypted (see [docs/REMOTE.md](../docs/REMOTE.md)):
the sky of workspaces, the conversations, approvals, starting new work, and
alerts when Claude needs you, even with the app closed.

Native Kotlin and Jetpack Compose. Package `dev.elchi.orbit`, minSdk 28.

## Layout

| Module | What |
| --- | --- |
| `core/` | Plain Kotlin (JVM): the protocol and the client state, no Android. Crypto (X25519 and HKDF from Tink, AES-GCM from `javax.crypto`), pairing links, the session (handshake, sealed frames, requests, events), the reconnecting client, the alert socket, the event reducer that mirrors `web/src/lib/store.ts`, Ori's pose logic, a small Markdown reader. |
| `app/` | The Android app: Compose screens, Ori, the sky, storage, the alert service, notifications, Firebase (optional). |
| `screenshots/` | Every screen rendered on the JVM by the screenshot tests. |

## Building

Needs JDK 17 or newer and the Android SDK (set `ANDROID_HOME` or write
`sdk.dir=...` in `local.properties`).

```sh
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew test                 # core and app unit tests, and the screenshots
./gradlew assembleRelease      # app/build/outputs/apk/release/app-release.apk (R8)
```

`./gradlew test` also renders the screenshots into `screenshots/` with
Robolectric and Roborazzi. Robolectric's Android runtime is fetched through
Gradle (`robolectricDeps`), so the tests run offline after that.

The version lives in `version.properties`.

### Firebase (optional)

If `app/google-services.json` exists, the build applies the Google Services
plugin, adds `firebase-messaging`, and compiles `src/firebase/` (the messaging
service and its manifest). Without the file the app builds without Firebase and
the Firebase alert option is hidden. The file is in `.gitignore`; CI writes it
from a secret before building:

```sh
echo "$GOOGLE_SERVICES_JSON" > android/app/google-services.json
```

For Firebase alerts Orbit also needs the project's service account key, pasted
in Orbit, Settings, Your phone.

### Signing

When these environment variables are set, `assembleRelease` signs with them:

| Variable | |
| --- | --- |
| `ORBIT_KEYSTORE` | path to the keystore |
| `ORBIT_KEYSTORE_PASSWORD` | its password |
| `ORBIT_KEY_ALIAS` | the key's alias |
| `ORBIT_KEY_PASSWORD` | the key's password |

Without them, release builds are signed with the debug key so they still
install for testing.

## Screens

- **Welcome**: Ori waves, says what the app is, and how to pair. Scan the QR
  code Orbit shows (Settings, Your phone, Pair a phone), or paste the link.
  `orbit://pair` links opened from elsewhere come here too.
- **Scan**: the camera (CameraX with ZXing, no Play Services) and a paste
  field. Then pairing: Ori thinks, then celebrates or says what went wrong.
  After the first pairing Ori asks once about notifications (Android 13+).
- **Sky**: the workspaces as planets around the sun, coloured by each
  workspace's style, with rings, surfaces and helper moons. Busy planets turn
  faster and spark, a waiting one pulses peach. Tap a planet to open it;
  TalkBack gets an action per planet. The list toggle shows the same
  workspaces as rows, the ones that need you on top, with archive and delete.
  The top line switches between paired computers. At the bottom, "What are we
  working on?" with a profile picker makes a workspace and sends the first
  message.
- **Workspace**: the title, Ori showing what Claude does right now, the
  profile and the approval mode switch. The conversation: your messages,
  Claude's answers as Markdown, thinking folded away, tool calls as compact rows
  (who allowed them, status, input, diff and output on tap), helper lanes, the
  plan, and the answer streaming in. The composer sends, stops a run, and a
  message sent while Claude works joins the run. Effort and web search sit
  under it. Pull to refresh; "Latest" jumps to the end.
- **Approval sheet**: opens by itself in a workspace when Claude asks. Ori in
  the "needs" pose, what Claude wants to do (the command, or the diff), the
  judge's note, and Allow once, Always allow (with the rule it saves, editable)
  and Deny (with an optional reason for Claude). A light buzz on each.
- **Waiting for you**: everything that waits on the active computer.
- **Settings**: paired computers (switch, rename, forget, pair another), this
  phone's name, the alert mode, start on boot, battery and notification
  status, how to send a test alert from Orbit, versions, licenses.

## How alerts work

Orbit sends an alert when an approval has waited a few seconds, and a `clear`
when nothing waits any more. An alert is sealed with a key only this phone and
that computer share, and says only that something needs you, never what.

- **Through the relay** (default, no Google): a foreground service with a quiet
  "Orbit is connected" notification keeps one websocket per paired computer to
  `/v1/wait`. It reconnects with backoff, tries again as soon as the network is
  back, and starts after a reboot if you allow it. Android's battery saving can
  delay it; Settings offers to exempt Orbit.
- **Firebase** (builds with `google-services.json`): no background connection.
  Orbit sends the same sealed frame as a data message; the app opens it with the
  same key. The FCM token goes to Orbit in `hello.push` and is sent again when
  it changes.

Either way the app then opens a short encrypted session to fetch what waits,
so the notification can say "Backups needs you: rm -rf ./old-snapshots/2025-*"
and offer **Allow** and **Deny**. Those work without opening the app: another
short session sends the decision and checks that Orbit took it. Tapping the
notification opens that workspace. A `clear` alert removes the notification.

## Security notes

- The phone's X25519 private key is made on first pairing and stored wrapped
  by an AES key that lives in the Android Keystore; it is excluded from backups.
- Every frame is AES-256-GCM with a counter nonce; a skipped, replayed or
  changed frame closes the session.
- Relays must use https. Plain http is accepted only for `localhost`,
  `127.0.0.1` and the emulator's `10.0.2.2`, for trying a relay locally.
- A pairing link's room must match its key, or the link is refused.

## Tests

`core` has JVM tests for every value in `docs/remote-vectors.json`, frame
sealing and counters, pairing links, alerts, request ids and timeouts, and the
event reducer (fed a run recorded from a real Orbit). `app` renders every
screen's preview to `screenshots/`.

The integration test pairs with a real Orbit through a real relay and uses
the API the way the app does: pairing, refusing an unknown phone and a used
code, requests, live events, an approval answered from the phone, `needs` and
`clear` alerts through the relay, and noticing that the phone was forgotten.

```sh
# a relay
cd relay && go run . token --rotate --token-file /tmp/orbit-relay-token
go run . serve --behind-proxy --port 8787 --token-file /tmp/orbit-relay-token &

# Orbit with the mock model
ORBIT_HOME=$(mktemp -d) ORBIT_MOCK=1 ORBIT_NO_OPEN=1 bun server/index.ts --port 7811 &
C=$(curl -si localhost:7811/ | sed -n 's/.*orbit_token=\([^;]*\).*/\1/p')
H="-H Cookie:orbit_token=$C -H Origin:http://localhost:7811 -H Content-Type:application/json"
curl -s $H -X PUT localhost:7811/api/remote -d "{\"relay_url\":\"http://localhost:8787\",\"token\":\"$(cat /tmp/orbit-relay-token)\"}"
LINK=$(curl -s $H -X POST localhost:7811/api/remote/pair -d '{}' | sed 's/.*"uri":"\([^"]*\)".*/\1/')

cd android && ./gradlew :core:test --tests '*IntegrationTest*' \
  "-Porbit.it.link=$LINK" -Porbit.it.url=http://localhost:7811 "-Porbit.it.cookie=$C"
```
