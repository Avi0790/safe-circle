// Safe Circle on CarPlay (modules/safecircle-carplay). Registers the car
// screen's scene in Info.plist, always: without Apple's CarPlay entitlement it
// simply never appears.
//
// The entitlement (Driving Task category) is added only when
// SAFECIRCLE_CARPLAY=1. Apple grants it per app, through a paid developer
// account; signing for a real iPhone with an entitlement the team doesn't have
// fails, so normal phone builds leave it out. iOS Simulator builds don't check
// it, so build those with SAFECIRCLE_CARPLAY=1 to try CarPlay in the
// Simulator's CarPlay window (I/O > External Displays > CarPlay).
const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

const withCarPlayScene = (config) =>
  withInfoPlist(config, (c) => {
    const manifest = c.modResults.UIApplicationSceneManifest ?? {};
    c.modResults.UIApplicationSceneManifest = {
      ...manifest,
      UISceneConfigurations: {
        ...(manifest.UISceneConfigurations ?? {}),
        CPTemplateApplicationSceneSessionRoleApplication: [
          {
            UISceneClassName: 'CPTemplateApplicationScene',
            UISceneConfigurationName: 'CarPlay',
            UISceneDelegateClassName: 'SCCarPlaySceneDelegate',
          },
        ],
      },
    };
    return c;
  });

const withCarPlayEntitlement = (config) =>
  process.env.SAFECIRCLE_CARPLAY === '1'
    ? withEntitlementsPlist(config, (c) => {
        c.modResults['com.apple.developer.carplay-driving-task'] = true;
        return c;
      })
    : config;

module.exports = (config) => withCarPlayEntitlement(withCarPlayScene(config));
