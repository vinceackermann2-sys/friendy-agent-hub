import SwiftUI
import WebKit
import AuthenticationServices
import CryptoKit

struct NativePrompt: Identifiable {
    let id = UUID()
    let title: String
    let detail: String
    let health: Bool
}

@MainActor
final class NativeModel: NSObject, ObservableObject {
    @Published var aiConsent = UserDefaults.standard.bool(forKey: "belna.aiConsent.v1") {
        didSet { UserDefaults.standard.set(aiConsent, forKey: "belna.aiConsent.v1") }
    }
    @Published var showSettings = false
    @Published var showDeletion = false
    @Published var loading = true
    @Published var loadError: String?
    @Published var prompt: NativePrompt?
    let services = DeviceServices()
    weak var webView: WKWebView?
    var foreground = true
    private var promptContinuation: CheckedContinuation<Bool, Never>?
    private var signingIn: AppleSignIn?
    private var completed = [String: [String: Any]]()
    private var executing = Set<String>()
    private var revision = 0

    func refresh() {
        objectWillChange.send()
        webView?.evaluateJavaScript("window.dispatchEvent(new Event('belna-apple-changed'))", completionHandler: nil)
    }
    func reload() {
        loadError = nil; loading = true
        webView?.load(URLRequest(url: AppConfiguration.origin.appendingPathComponent("app")))
    }
    func resolvePrompt(_ allow: Bool) {
        let continuation = promptContinuation
        promptContinuation = nil; prompt = nil
        continuation?.resume(returning: allow)
    }
    func cancelPrompt() { resolvePrompt(false) }
    func review(title: String, detail: String, health: Bool = false) async -> Bool {
        guard promptContinuation == nil, foreground else { return false }
        if showSettings {
            showSettings = false
            try? await Task.sleep(for: .milliseconds(350))
            guard foreground else { return false }
        }
        return await withCheckedContinuation { continuation in
            promptContinuation = continuation
            prompt = NativePrompt(title: title, detail: detail, health: health)
        }
    }
    func withdrawConsent() {
        revision += 1; cancelPrompt(); services.disconnectAll(); aiConsent = false
        webView?.stopLoading()
        webView?.loadHTMLString("", baseURL: nil)
        refresh()
    }
    func openSystemSettings() {
        #if targetEnvironment(macCatalyst)
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy") { UIApplication.shared.open(url) }
        #else
        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
        #endif
    }
    func deleteAccount() async throws {
        guard let webView else { throw DeviceError.message("Open Belna and sign in first.") }
        _ = try await webView.callAsyncJavaScript("if (!window.LingonAuth?.signedIn()) throw new Error('Sign in first.'); const result = await window.LingonAuth.api('/api/auth/delete-account', {method:'POST', body:JSON.stringify({confirmation:'DELETE'})}); window.LingonAuth.set(null); window.location.replace('/app'); return result;", arguments: [:], in: nil, in: .page)
        services.disconnectAll(); completed.removeAll(); refresh()
    }
    private func lock() {
        revision += 1; cancelPrompt(); services.accountId = ""; completed.removeAll()
    }
    private func commandActive(_ id: String) async -> Bool {
        guard let webView else { return false }
        return (try? await webView.callAsyncJavaScript("return await window.BelnaApple?.commandActive(id);", arguments: ["id":id], in: nil, in: .page)) as? Bool ?? false
    }
    func request(_ body: [String: Any]) async throws -> Any {
        let method = body["method"] as? String ?? ""
        if method == "lock" { lock(); return ["ok": true] }
        if method == "settings" { showSettings = true; return ["ok": true] }
        if method == "disconnect" { revision += 1; cancelPrompt(); services.disconnectAll(); refresh(); return ["ok": true] }
        guard aiConsent, foreground else { throw DeviceError.message("Open Belna and agree to AI data sharing first.") }
        if method == "signIn" {
            guard signingIn == nil else { throw DeviceError.message("Apple sign-in is already open.") }
            let signIn = AppleSignIn(); signingIn = signIn
            defer { signingIn = nil }
            return try await signIn.start()
        }
        if method == "status" {
            let accountId = body["accountId"] as? String ?? ""
            guard UUID(uuidString: accountId) != nil else { throw DeviceError.message("Sign in first.") }
            if services.accountId != accountId { lock(); services.accountId = accountId; objectWillChange.send() }
            return ["name": AppConfiguration.platform == "mac" ? "Mac" : UIDevice.current.model, "capabilities": services.capabilities()]
        }
        guard method == "execute", let accountId = body["accountId"] as? String, accountId == services.accountId,
              let commandId = body["commandId"] as? String, UUID(uuidString: commandId) != nil,
              let action = body["action"] as? String, let args = body["args"] as? [String: Any],
              let expiry = body["expiresAt"] as? String, let expiresAt = DeviceServices.date(expiry), expiresAt > Date() else {
            throw DeviceError.message("Invalid or expired Apple request.")
        }
        if let result = completed[commandId] { return result }
        guard !executing.contains(commandId) else { throw DeviceError.message("This Apple request is already running.") }
        executing.insert(commandId); defer { executing.remove(commandId) }
        let currentRevision = revision
        let isWrite = !["calendar.list","reminders.list","contacts.search","health.summary"].contains(action)
        if isWrite {
            let description = try services.describe(action, args: args)
            guard await review(title: "Allow \(action)?", detail: description) else { throw DeviceError.message("The owner cancelled this Apple change.") }
        }
        let allowedBefore = await commandActive(commandId)
        guard allowedBefore, foreground, aiConsent, services.accountId == accountId, revision == currentRevision, expiresAt > Date() else {
            throw DeviceError.message("The request expired or permission was withdrawn. Inspect the Apple app before retrying.")
        }
        let result = try await services.execute(action, args: args)
        if action == "health.summary" {
            let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
            guard await review(title: "Share this wellness summary with your agent?", detail: String(decoding: data, as: UTF8.self), health: true) else { throw DeviceError.message("The owner declined to share the health summary.") }
        }
        let allowedAfter = await commandActive(commandId)
        guard allowedAfter, foreground, aiConsent, services.accountId == accountId, revision == currentRevision, expiresAt > Date() else { throw DeviceError.message("Request no longer active. Inspect the Apple app before retrying any changes.") }
        // A duplicate delivery returns the original outcome instead of repeating a write.
        if completed.count >= 100 { completed.removeAll() }
        completed[commandId] = result
        return result
    }
}

@MainActor
final class AppleSignIn: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<[String: String], Error>?
    private let nonce = UUID().uuidString + UUID().uuidString
    private var controller: ASAuthorizationController?
    func start() async throws -> [String: String] {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.email, .fullName]
            request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
            let controller = ASAuthorizationController(authorizationRequests: [request])
            self.controller = controller
            controller.delegate = self; controller.presentationContextProvider = self; controller.performRequests()
        }
    }
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let token = credential.identityToken, let text = String(data: token, encoding: .utf8),
              let code = credential.authorizationCode, let codeText = String(data: code, encoding: .utf8) else {
            finish(.failure(DeviceError.message("Apple did not return a sign-in token."))); return
        }
        finish(.success(["identityToken": text, "authorizationCode": codeText, "nonce": nonce]))
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) { finish(.failure(error)) }
    private func finish(_ result: Result<[String: String], Error>) {
        continuation?.resume(with: result); continuation = nil; controller = nil
    }
}
