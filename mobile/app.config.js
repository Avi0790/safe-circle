const dotenv = require('dotenv');
const path = require('path');

// Share one .env with the web dashboard instead of duplicating
// EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY per-package.
const rootEnv = dotenv.config({ path: path.resolve(__dirname, '..', '.env') }).parsed ?? {};

// Push notifications need Apple's paid developer program: a free Personal
// Team can't sign an app that asks for them ("Personal development teams ...
// do not support the Push Notifications capability"). So the push entitlement
// is left out unless SAFECIRCLE_PUSH=1, which eas.json sets for its builds.
// Without it the app still runs; only remote push (SOS, arrival alerts) is
// unavailable, and the app says so when you try to turn push on. On-phone
// reminders (walk, check-in) are local notifications and still work.
const { withEntitlementsPlist } = require('expo/config-plugins');
const withPushOnlyWhenPaid = (config) =>
  process.env.SAFECIRCLE_PUSH === '1'
    ? config
    : withEntitlementsPlist(config, (c) => {
        delete c.modResults['aps-environment'];
        return c;
      });

module.exports = {
  expo: {
    name: 'Safe Circle',
    slug: 'safecircle',
    scheme: 'safecircle',
    owner: 'suren.7a',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    ios: {
      // The app's unique name on iOS; needed to build it in Xcode.
      bundleIdentifier: 'com.surendrabk.safecircle',
      // Signing team (Xcode → Settings → Apple Accounts). Not a secret: it's in
      // every app signed with it.
      appleTeamId: 'W7PA9ZY7S9',
      supportsTablet: true,
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'Safe Circle uses your location to share it with the people in your circle.',
      },
    },
    android: {
      package: 'com.surendrabk.safecircle',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      // First on purpose: Expo runs entitlement steps last-plugin-first, so
      // this one runs after expo-notifications has added the push entitlement.
      withPushOnlyWhenPaid,
      // iOS 27 requires the scene lifecycle; Expo 57's template lacks it.
      './plugins/withSceneLifecycle',
      // CarPlay screens; the entitlement only with SAFECIRCLE_CARPLAY=1.
      './plugins/withCarPlay',
      'expo-router',
      'expo-status-bar',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Safe Circle uses your location to share it with the people in your circle.',
          locationAlwaysAndWhenInUsePermission:
            'Safe Circle shares your location with your circle in the background, even when the app is closed.',
          isAndroidBackgroundLocationEnabled: true,
          isIosBackgroundLocationEnabled: true,
        },
      ],
      'expo-notifications',
      [
        'expo-image-picker',
        {
          photosPermission: 'Safe Circle uses your photos so you can choose a profile picture.',
        },
      ],
      [
        'expo-local-authentication',
        {
          faceIDPermission: 'Safe Circle uses Face ID to keep your family\'s locations private if someone else picks up your phone.',
        },
      ],
      [
        'expo-sensors',
        {
          motionPermission: 'Safe Circle uses motion data so you can shake your phone to send an SOS.',
        },
      ],
      'expo-sharing',
      [
        'expo-camera',
        {
          cameraPermission: 'Safe Circle uses the camera to scan a circle invite QR code.',
          microphonePermission: false,
          recordAudioAndroid: false,
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? rootEnv.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey:
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? rootEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      // Where the web dashboard is hosted — guest tracking links point at
      // its /track/<token> page, so it has to be a URL other people's
      // browsers can reach (not localhost) for links to work for them.
      webUrl: process.env.EXPO_PUBLIC_WEB_URL ?? rootEnv.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:5173',
      eas: {
        projectId: '242bb342-021e-4f7e-a78d-d13941d9fd28',
      },
    },
  },
};
