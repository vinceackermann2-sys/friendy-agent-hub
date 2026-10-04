import SwiftUI
import WebKit

struct BelnaWebView: UIViewRepresentable {
    @ObservedObject var model: NativeModel
    func makeCoordinator() -> Coordinator { Coordinator(model: model) }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.applicationNameForUserAgent = "BelnaNative/1.0"
        let controller = configuration.userContentController
        controller.addScriptMessageHandler(context.coordinator, contentWorld: .page, name: "belna")
        let origin = AppConfiguration.origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        // JSON serialization, never raw host text interpolated into JavaScript.
        let encoded = String(data: try! JSONSerialization.data(withJSONObject: [origin]), encoding: .utf8)!
        let source = "if (window === window.top && location.origin === \(encoded)[0]) { Object.defineProperty(window,'BelnaNative',{value:Object.freeze({platform:'\(AppConfiguration.platform)',request:body=>window.webkit.messageHandlers.belna.postMessage(body)})}); }"
        controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator; webView.uiDelegate = context.coordinator
        webView.isOpaque = false; webView.backgroundColor = .systemBackground
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        model.webView = webView
        webView.load(URLRequest(url: AppConfiguration.origin.appendingPathComponent("app")))
        return webView
    }
    func updateUIView(_ webView: WKWebView, context: Context) {}
    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.stopLoading(); webView.configuration.userContentController.removeScriptMessageHandler(forName: "belna", contentWorld: .page)
    }
    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, WKDownloadDelegate {
        let model: NativeModel
        var downloadFiles = [ObjectIdentifier: URL]()
        init(model: NativeModel) { self.model = model }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
            guard message.frameInfo.isMainFrame, AppConfiguration.trusted(message.frameInfo.request.url),
                  AppConfiguration.trusted(message.webView?.url), let body = message.body as? [String: Any] else {
                replyHandler(nil, "Apple access is only available in the Belna app."); return
            }
            Task { @MainActor in
                do { replyHandler(try await model.request(body), nil) }
                catch { replyHandler(nil, error.localizedDescription) }
            }
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { model.loading = false; model.loadError = nil }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { model.loading = false; model.loadError = "Check your internet connection, then try again." }
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { self.webView(webView, didFailProvisionalNavigation: navigation, withError: error) }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { model.loading = false; model.loadError = "Belna needs to reload. Your saved account data is still available." }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if navigationAction.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
            if navigationAction.shouldPerformDownload, AppConfiguration.trusted(webView.url),
               AppConfiguration.trusted(url) || url.scheme == "blob" {
                decisionHandler(.download); return
            }
            if AppConfiguration.trusted(url) {
                // The App Store build consumes existing plans and the free plan.
                // No external purchase funnel for digital agent tokens/subscriptions.
                if ["/pricing", "/pricing.html"].contains(url.path) { decisionHandler(.cancel); return }
                decisionHandler(.allow); return
            }
            decisionHandler(.cancel)
            if ["https", "mailto", "tel", "sms"].contains(url.scheme?.lowercased() ?? ""), model.foreground { UIApplication.shared.open(url) }
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            if navigationResponse.isForMainFrame && !navigationResponse.canShowMIMEType && AppConfiguration.trusted(navigationResponse.response.url) { decisionHandler(.download) }
            else { decisionHandler(.allow) }
        }
        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let filename = URL(fileURLWithPath: suggestedFilename).lastPathComponent
                let file = folder.appendingPathComponent(filename.isEmpty ? "Belna-file" : filename)
                downloadFiles[ObjectIdentifier(download)] = file; completionHandler(file)
            } catch { completionHandler(nil) }
        }
        func downloadDidFinish(_ download: WKDownload) {
            guard let file = downloadFiles.removeValue(forKey: ObjectIdentifier(download)), model.foreground,
                  let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
                  var presenter = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController else { return }
            while let presented = presenter.presentedViewController { presenter = presented }
            let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            share.popoverPresentationController?.sourceView = presenter.view
            share.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX,y:presenter.view.bounds.midY,width:1,height:1)
            share.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
            presenter.present(share, animated: true)
        }
        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            if let file = downloadFiles.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        }
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url, AppConfiguration.trusted(url) { webView.load(URLRequest(url: url)) }
            else if let url = navigationAction.request.url, url.scheme == "https" { UIApplication.shared.open(url) }
            return nil
        }
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(frame.isMainFrame && origin.host == AppConfiguration.origin.host && origin.protocol == "https" ? .prompt : .deny)
        }
    }
}
