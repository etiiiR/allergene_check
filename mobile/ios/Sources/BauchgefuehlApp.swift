import SwiftUI

@main
struct BauchgefuehlApp: App {
    var body: some Scene { WindowGroup { DiaryRootView() } }
}

struct DiaryRootView: View {
    @AppStorage("diaryServerURL") private var server = ""
    @State private var draft = ""
    @State private var editing = false
    @State private var validationError = ""
    private var serverURL: URL? {
        guard let url = URL(string: server), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil else { return nil }
        return url
    }
    var body: some View {
        VStack(spacing: 0) {
            if let url = serverURL, !editing {
                HStack {
                    Text(url.host ?? "Tagebuch").font(.caption).lineLimit(1)
                    Spacer()
                    Button("Server ändern") { draft = server; editing = true }
                }.padding(10)
                DiaryWebView(server: url).id(server)
            } else {
                Form {
                    Section("Dein privater Tagebuch-Server") {
                        TextField("https://tagebuch.example", text: $draft)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .keyboardType(.URL)
                        Text("Wähle nur deinen eigenen, geschützten Server. Gesundheitsdaten werden bei der Synchronisation dorthin übertragen. Die App stellt selbst keinen öffentlichen Server bereit.")
                        Button("Mit Tagebuch verbinden") {
                            guard let url = URL(string: draft.trimmingCharacters(in: .whitespacesAndNewlines)),
                                  url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else {
                                validationError = "Bitte eine gültige HTTPS-Adresse ohne eingebettete Zugangsdaten eingeben."; return
                            }
                            server = url.absoluteString; editing = false; validationError = ""
                        }
                        if !validationError.isEmpty { Text(validationError).foregroundStyle(.red) }
                    }
                    Section { Text("Die HealthKit-Freigabe erfolgt erst unter Profil → Health. Nur Lesen, keine Änderungen an Apple Health.") }
                }
            }
        }.tint(.indigo)
    }
}
