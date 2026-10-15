import SwiftUI
import UIKit
import WebKit

struct DiaryWebView: UIViewRepresentable {
    let server: URL
    func makeCoordinator() -> Coordinator { Coordinator(server: server) }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator, name: "bauchHealth")
        configuration.userContentController.addUserScript(WKUserScript(source: Self.bridgeScript,
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        context.coordinator.webView = view
        view.load(URLRequest(url: server))
        return view
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "bauchHealth")
        uiView.stopLoading()
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let server: URL
        weak var webView: WKWebView?
        private let health = HealthKitReader()
        private var reading = false
        init(server: URL) { self.server = server }
        private func trusted(_ url: URL?) -> Bool {
            guard let url else { return false }
            return url.scheme == "https" && url.host == server.host && (url.port ?? 443) == (server.port ?? 443)
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if trusted(action.request.url), action.targetFrame?.isMainFrame != false { decisionHandler(.allow) }
            else {
                decisionHandler(.cancel)
                if let url = action.request.url, url.scheme == "https", action.navigationType == .linkActivated { UIApplication.shared.open(url) }
            }
        }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, trusted(message.frameInfo.request.url),
                  let body = message.body as? [String: Any], body["action"] as? String == "read",
                  let id = body["id"] as? String, id.count < 100 else { return }
            guard !reading else { reply(id, records: nil, error: "Eine Abfrage läuft bereits."); return }
            reading = true
            health.readLastWeek { [weak self] result in
                guard let self else { return }
                self.reading = false
                switch result {
                case .success(let records): self.reply(id, records: records, error: nil)
                case .failure(let error): self.reply(id, records: nil, error: error.localizedDescription)
                }
            }
        }
        private func reply(_ id: String, records: [[String: Any]]?, error: String?) {
            guard trusted(webView?.url) else { return }
            let payload: [String: Any] = ["id": id, "records": records ?? [], "error": error ?? ""]
            guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
            webView?.evaluateJavaScript("window.__bauchHealthReply(\(json));", completionHandler: nil)
        }
    }

    private static let bridgeScript = """
    (() => {
      const pending = new Map();
      window.__bauchHealthReply = data => {
        const p = pending.get(data.id); if (!p) return;
        clearTimeout(p.timer); pending.delete(data.id);
        data.error ? p.reject(new Error(data.error)) : p.resolve({records:data.records});
      };
      window.BauchHealth = { platform:'ios', read:() => new Promise((resolve,reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Health-Abfrage dauert zu lange. Bitte erneut versuchen.')); }, 90000);
        pending.set(id,{resolve,reject,timer});
        window.webkit.messageHandlers.bauchHealth.postMessage({id,action:'read'});
      })};
    })();
    """
}
