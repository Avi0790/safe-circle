const dotenv = require('dotenv');
const path = require('path');

// Share one .env with the web dashboard instead of duplicating
// EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY per-package.
const rootEnv = dotenv.config({ path: path.resolve(__dirname, '..', '.env') }).parsed ?? {};

module.exports = {
  expo: {
    name: 'Safe Circle',
    slug: 'safecircle',
    scheme: 'safecircle',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    ios: {
      supportsTablet: true,
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'Safe Circle uses your location to share it with the people in your circle.',
      },
    },
    android: {
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
      'expo-router',
      'expo-status-bar',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Safe Circle uses your location to share it with the people in your circle.',
          isAndroidBackgroundLocationEnabled: false,
          isIosBackgroundLocationEnabled: false,
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
    },
  },
};
