// iOS 27 stops apps built with its SDK at launch unless they use the scene
// lifecycle (UIScene). Expo SDK 57's project template doesn't yet, so a
// development or release build crashed on open with
// "_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption" (Expo Go was
// fine: Expo builds that app itself). This plugin adds the scene setup to the
// generated iOS project, so it survives `expo prebuild`.
//
// React Native still starts in AppDelegate's didFinishLaunching, exactly as
// before: iOS can launch the app in the background for location updates with
// no scene at all, and the location task's JavaScript must still run then.
// The scene only takes the already-started screen into its window, and passes
// any link that opened the app on to the AppDelegate's existing handlers.
const fs = require('fs');
const path = require('path');
const { IOSConfig, withDangerousMod, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

const SCENE_DELEGATE = `import UIKit
import React

// Added by plugins/withSceneLifecycle.js (iOS 27 requires the scene lifecycle).
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }

    // React Native was already started by the AppDelegate (into a window
    // with no scene); move its screen into this scene's window.
    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = appDelegate.window?.rootViewController
    appDelegate.window?.rootViewController = nil
    appDelegate.window = window
    self.window = window
    window.makeKeyAndVisible()

    // A link or universal link that launched the app.
    for context in connectionOptions.urlContexts {
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])
    }
    for activity in connectionOptions.userActivities {
      _ = appDelegate.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }
  }

  // Links that arrive while the app is running.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in URLContexts {
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = appDelegate.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;

const withSceneManifest = (config) =>
  withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return c;
  });

const withSceneDelegateFile = (config) =>
  withDangerousMod(config, [
    'ios',
    async (c) => {
      const projectName = c.modRequest.projectName;
      const file = path.join(c.modRequest.platformProjectRoot, projectName, 'SceneDelegate.swift');
      fs.writeFileSync(file, SCENE_DELEGATE);
      return c;
    },
  ]);

const withSceneDelegateInProject = (config) =>
  withXcodeProject(config, (c) => {
    const projectName = c.modRequest.projectName;
    const filepath = `${projectName}/SceneDelegate.swift`;
    if (!c.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName: projectName, project: c.modResults });
    }
    return c;
  });

module.exports = (config) => withSceneDelegateInProject(withSceneDelegateFile(withSceneManifest(config)));
