import Foundation

enum AppConfiguration {
    static let origin: URL = {
        let value = Bundle.main.object(forInfoDictionaryKey: "BelnaOrigin") as? String ?? ""
        guard let url = URL(string: value), url.scheme == "https", url.host != nil, url.user == nil,
              url.password == nil, url.path.isEmpty || url.path == "/" else {
            preconditionFailure("BelnaOrigin must be a production HTTPS origin")
        }
        return url
    }()
    static func trusted(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
    }
    static var platform: String {
        #if targetEnvironment(macCatalyst)
        return "mac"
        #else
        return "ios"
        #endif
    }
}
