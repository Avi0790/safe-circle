// Walk me home, Check on me and your shift on the iPhone lock screen and in
// the Dynamic Island (expo-live-activity, which adds a widget extension).
//
// Off unless SAFECIRCLE_LIVE_ACTIVITY=1 when the iOS project is generated:
//   SAFECIRCLE_LIVE_ACTIVITY=1 npx expo prebuild --platform ios --clean
// A normal prebuild leaves the extension out, so a phone build that worked
// before keeps working. The app checks extra.liveActivity (app.config.js)
// before starting one (lib/liveActivity.ts).
//
// The package's extension target has no signing team; this gives it the
// app's (appleTeamId), so a free Personal Team can sign it too.
const { withXcodeProject } = require('expo/config-plugins');

const TARGET = 'LiveActivity';

const withExtensionTeam = (config) =>
  withXcodeProject(config, (c) => {
    const team = c.ios?.appleTeamId;
    if (!team) return c;
    const project = c.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const settings = configurations[key]?.buildSettings;
      if (settings && String(settings.PRODUCT_BUNDLE_IDENTIFIER ?? '').replace(/"/g, '').endsWith(`.${TARGET}`)) {
        settings.DEVELOPMENT_TEAM = team;
        settings.CODE_SIGN_STYLE = 'Automatic';
      }
    }
    return c;
  });

module.exports = function withLiveActivity(config) {
  if (process.env.SAFECIRCLE_LIVE_ACTIVITY !== '1') return config;
  // registered first so it runs after the package's own Xcode changes
  config = withExtensionTeam(config);
  const plugin = require('expo-live-activity/app.plugin');
  return (plugin.default ?? plugin)(config);
};
