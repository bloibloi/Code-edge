import Foundation

enum SharedConfig {
    static let appGroup = "group.com.bloibloi.iphoneremote"
    static let broadcastExtensionBundleID = "com.bloibloi.iphoneremote.broadcast"

    private enum Key {
        static let publishURL = "whipPublishURL"
        static let publisherToken = "publisherSessionToken"
        static let joinCode = "streamJoinCode"
        static let password = "streamPassword"
        static let expiresAt = "streamExpiresAt"
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

    static var publisherToken: String? {
        defaults.string(forKey: Key.publisherToken)
    }

    static var joinCode: String? {
        defaults.string(forKey: Key.joinCode)
    }

    static var password: String? {
        defaults.string(forKey: Key.password)
    }

    static var sessionIsActive: Bool {
        guard publishURL != nil,
              let rawDate = defaults.string(forKey: Key.expiresAt) else { return false }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let expiry = formatter.date(from: rawDate) else { return false }
        return expiry > Date()
    }

    static func save(session: IPhoneStreamSessionResponse, password: String) {
        defaults.set(session.whipPublishURL.absoluteString, forKey: Key.publishURL)
        defaults.set(session.publisherToken, forKey: Key.publisherToken)
        defaults.set(session.code, forKey: Key.joinCode)
        defaults.set(password, forKey: Key.password)
        defaults.set(session.expiresAt, forKey: Key.expiresAt)
    }

    static func clearSession() {
        defaults.removeObject(forKey: Key.publishURL)
        defaults.removeObject(forKey: Key.publisherToken)
        defaults.removeObject(forKey: Key.joinCode)
        defaults.removeObject(forKey: Key.password)
        defaults.removeObject(forKey: Key.expiresAt)
    }
}
