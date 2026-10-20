import CarPlay
import ExpoModulesCore

// Safe Circle on CarPlay, in Apple's Driving Task category: a tab of circle
// members (tap one for details) and a tab of quick actions. The app's
// JavaScript (components/CarPlayBridge.tsx) sends the latest state with
// setState and carries out actions sent back as "onAction" events; anything
// to tell the driver comes back as a short alert (showMessage).
//
// The car screen is its own scene (CPTemplateApplicationScene). Its delegate
// is registered in Info.plist by plugins/withCarPlay.js under the
// Objective-C name SCCarPlaySceneDelegate. Apple must grant the
// com.apple.developer.carplay-driving-task entitlement before this shows on a
// real car; the iOS Simulator's CarPlay window works without it.

public final class SafeCircleCarPlayModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SafeCircleCarPlay")

    Events("onAction", "onConnection")

    OnCreate {
      CarPlayHub.shared.module = self
    }

    Function("isConnected") { () -> Bool in
      CarPlayHub.shared.connected
    }

    Function("setState") { (state: [String: Any]) in
      DispatchQueue.main.async { CarPlayHub.shared.update(state) }
    }

    Function("showMessage") { (text: String) in
      DispatchQueue.main.async { CarPlayHub.shared.showMessage(text) }
    }
  }

  func emit(_ name: String, _ body: [String: Any]) {
    sendEvent(name, body)
  }
}

// Owns the CarPlay interface while a car is connected. Main thread only.
final class CarPlayHub {
  static let shared = CarPlayHub()

  weak var module: SafeCircleCarPlayModule?
  private var interface: CPInterfaceController?
  private var state: [String: Any] = [:]
  private var circleTemplate: CPListTemplate?
  private var actionsTemplate: CPListTemplate?
  private(set) var connected = false

  func connect(_ controller: CPInterfaceController) {
    interface = controller
    connected = true
    let circle = CPListTemplate(title: "Circle", sections: circleSections())
    circle.tabTitle = "Circle"
    circle.tabImage = UIImage(systemName: "person.3.fill")
    let actions = CPListTemplate(title: "Actions", sections: actionSections())
    actions.tabTitle = "Actions"
    actions.tabImage = UIImage(systemName: "bolt.fill")
    circleTemplate = circle
    actionsTemplate = actions
    controller.setRootTemplate(CPTabBarTemplate(templates: [circle, actions]), animated: false, completion: nil)
    module?.emit("onConnection", ["connected": true])
  }

  func disconnect() {
    interface = nil
    circleTemplate = nil
    actionsTemplate = nil
    connected = false
    module?.emit("onConnection", ["connected": false])
  }

  func update(_ newState: [String: Any]) {
    state = newState
    circleTemplate?.updateSections(circleSections())
    actionsTemplate?.updateSections(actionSections())
  }

  func showMessage(_ text: String) {
    guard let interface else { return }
    let alert = CPAlertTemplate(titleVariants: [text], actions: [
      CPAlertAction(title: "OK", style: .cancel) { [weak self] _ in
        self?.interface?.dismissTemplate(animated: true, completion: nil)
      },
    ])
    // CarPlay shows one alert at a time; replace any that's still up.
    if interface.presentedTemplate != nil {
      interface.dismissTemplate(animated: false) { _, _ in
        interface.presentTemplate(alert, animated: true, completion: nil)
      }
    } else {
      interface.presentTemplate(alert, animated: true, completion: nil)
    }
  }

  // ---------------------------------------------------------------- lists

  private var signedIn: Bool { state["signedIn"] as? Bool ?? false }

  private func circleSections() -> [CPListSection] {
    guard signedIn else {
      return [CPListSection(items: [CPListItem(text: "Open Safe Circle on your iPhone", detailText: "Sign in to see your circle here")])]
    }
    let members = state["members"] as? [[String: Any]] ?? []
    if members.isEmpty {
      return [CPListSection(items: [CPListItem(text: "No one else in this circle yet", detailText: nil)])]
    }
    let items: [CPListItem] = members.prefix(Int(CPListTemplate.maximumItemCount)).map { member in
      let item = CPListItem(text: member["title"] as? String ?? "", detailText: member["detail"] as? String)
      item.handler = { [weak self] _, completion in
        self?.showMember(member)
        completion()
      }
      return item
    }
    return [CPListSection(items: items, header: state["circleName"] as? String, sectionIndexTitle: nil)]
  }

  private func actionSections() -> [CPListSection] {
    guard signedIn else {
      return [CPListSection(items: [CPListItem(text: "Open Safe Circle on your iPhone", detailText: "Sign in to use quick actions")])]
    }
    let actions = state["actions"] as? [[String: Any]] ?? []
    let items: [CPListItem] = actions.map { action in
      let item = CPListItem(text: action["title"] as? String ?? "", detailText: action["detail"] as? String)
      item.handler = { [weak self] _, completion in
        self?.run(action)
        completion()
      }
      return item
    }
    return [CPListSection(items: items)]
  }

  private func showMember(_ member: [String: Any]) {
    let lines = member["lines"] as? [[String: Any]] ?? []
    let info = CPInformationTemplate(
      title: member["title"] as? String ?? "",
      layout: .leading,
      items: lines.map { CPInformationItem(title: $0["title"] as? String, detail: $0["detail"] as? String) },
      actions: []
    )
    interface?.pushTemplate(info, animated: true, completion: nil)
  }

  private func run(_ action: [String: Any]) {
    guard let id = action["id"] as? String else { return }
    if let confirm = action["confirm"] as? [String: Any] {
      let alert = CPAlertTemplate(
        titleVariants: [confirm["title"] as? String ?? "Are you sure?"],
        actions: [
          CPAlertAction(title: confirm["button"] as? String ?? "OK", style: .destructive) { [weak self] _ in
            self?.interface?.dismissTemplate(animated: true) { _, _ in
              self?.module?.emit("onAction", ["id": id])
            }
          },
          CPAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.interface?.dismissTemplate(animated: true, completion: nil)
          },
        ]
      )
      interface?.presentTemplate(alert, animated: true, completion: nil)
    } else {
      module?.emit("onAction", ["id": id])
    }
  }
}

// The car screen's scene. Registered in Info.plist by this name.
@objc(SCCarPlaySceneDelegate)
public final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  public func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    CarPlayHub.shared.connect(interfaceController)
  }

  public func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    CarPlayHub.shared.disconnect()
  }
}
