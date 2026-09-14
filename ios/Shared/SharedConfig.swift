import Foundation

enum SharedConfig {
    static let appGroup = "group.com.bloibloi.iphoneremote"
    static let broadcastExtensionBundleID = "com.bloibloi.iphoneremote.broadcast"

    private enum Key {
        static let publishURL = "whipPublishURL"
        static let sessionToken = "pairingSessionToken"
    }

    private static var defaults: UserDefaults {
        guard let defaults = UserDefaults(suiteName: appGroup) else {
            fatalError("App Group \(appGroup) is not configured")
        }
        return defaults
    }

    static var pairingAPIURL: URL? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: "PAIRING_API_URL") as? String,
              !rawValue.isEmpty,
              !rawValue.contains("YOUR-WORKER"),
              let url = URL(string: rawValue) else { return nil }
        return url
    }

    static var publishURL: URL? {
        guard let value = defaults.string(forKey: Key.publishURL) else { return nil }
        return URL(string: value)
    }

    static var sessionToken: String? {
        defaults.string(forKey: Key.sessionToken)
    }

    static func save(session: PairingJoinResponse) {
        defaults.set(session.whipPublishURL.absoluteString, forKey: Key.publishURL)
        defaults.set(session.sessionToken, forKey: Key.sessionToken)
    }

    static func clearSession() {
        defaults.removeObject(forKey: Key.publishURL)
        defaults.removeObject(forKey: Key.sessionToken)
    }
}

