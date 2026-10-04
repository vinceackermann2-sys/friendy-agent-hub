import SwiftUI
import WebKit

@main
struct BelnaApp: App {
    @StateObject private var model = NativeModel()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(model)
                .onChange(of: phase) { _, value in
                    model.foreground = value == .active
                    if value != .active { model.cancelPrompt() }
                    if value == .active { model.refresh() }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var model: NativeModel
    var body: some View {
        NavigationStack {
            Group {
                if !model.aiConsent {
                    ConsentView()
                } else {
                    ZStack {
                        BelnaWebView(model: model)
                        if model.loading { ProgressView("Opening Belna…").padding(24).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18)) }
                        if let error = model.loadError {
                            ContentUnavailableView {
                                Label("Couldn’t open Belna", systemImage: "wifi.exclamationmark")
                            } description: { Text(error) } actions: {
                                Button("Try again") { model.reload() }.buttonStyle(.borderedProminent)
                            }.background(Color(.systemBackground))
                        }
                    }
                }
            }
            .navigationTitle("Belna")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { model.showSettings = true } label: { Image(systemName: "apple.logo") }
                        .accessibilityLabel("Apple apps and privacy")
                }
            }
            .sheet(isPresented: $model.showSettings) { AppleAppsView() }
            .sheet(item: $model.prompt, onDismiss: { model.cancelPrompt() }) { prompt in
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 20) {
                            Text(prompt.title).font(.title2.bold())
                            Text(prompt.detail).font(.body)
                            if prompt.health { Text("Only share this result for your own fitness and wellness. It will be sent to Belna’s server and Microsoft Azure AI to answer your request, and may appear in your saved chat. It is never used for advertising.").font(.callout) }
                            Button(prompt.health ? "Share this summary" : "Allow this change") { model.resolvePrompt(true) }.buttonStyle(.borderedProminent)
                            Button("Cancel", role: .cancel) { model.resolvePrompt(false) }.buttonStyle(.bordered)
                        }.padding(24)
                    }.navigationTitle("Review request").navigationBarTitleDisplayMode(.inline)
                }.interactiveDismissDisabled(false)
            }
        }
    }
}

struct ConsentView: View {
    @EnvironmentObject private var model: NativeModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Image(systemName: "sparkles").font(.system(size: 44)).foregroundStyle(.blue)
                Text("Your agent, on your Apple devices").font(.largeTitle.bold())
                Text("Belna sends the messages, attachments and app results you choose to share to Belna’s servers and Microsoft Azure AI for processing. Conversations are saved in your Belna account. You can use the app without connecting Apple apps.")
                Text("Calendar, Reminders and Contacts stay on your device until you ask your agent to use them. Each connection is optional. Health is read-only and you review every wellness summary before sharing it.")
                Link("Read the Privacy Policy", destination: AppConfiguration.origin.appendingPathComponent("privacy"))
                Button("I agree — continue to Belna") { model.aiConsent = true }.buttonStyle(.borderedProminent)
                Text("You can withdraw consent under Apple apps → Privacy. Declining leaves this screen available without loading the agent.").font(.footnote).foregroundStyle(.secondary)
            }.padding(28)
        }
    }
}

struct AppleAppsView: View {
    @EnvironmentObject private var model: NativeModel
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?
    @State private var busy: String?
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Connect the apps you want your agent to use. Keep Belna open on this device for agent requests. iCloud calendars, reminders and contacts appear here when synced to this device.")
                }
                ForEach(AppleScope.allCases) { scope in
                    Section {
                        HStack {
                            Label(scope.title, systemImage: scope.icon)
                            Spacer()
                            if busy == scope.rawValue { ProgressView() }
                            else if model.services.connected(scope) {
                                Button("Disconnect") { model.services.disconnect(scope); model.refresh() }
                            } else {
                                Button("Connect") {
                                    busy = scope.rawValue
                                    Task { @MainActor in
                                        do { try await model.services.connect(scope) } catch { self.error = error.localizedDescription }
                                        busy = nil; model.refresh()
                                    }
                                }.disabled(!model.services.available(scope) || !model.aiConsent)
                            }
                        }
                        Text(model.services.statusText(scope)).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
                Section("Privacy") {
                    Text("Apple permissions and consent to share data with AI are separate. Disconnecting blocks future agent requests. Previously shared data may remain in your chats; delete it in your account.")
                    Link("Privacy Policy", destination: AppConfiguration.origin.appendingPathComponent("privacy"))
                    Button("Open Apple permission settings") { model.openSystemSettings() }
                    Button("Withdraw AI consent", role: .destructive) { model.withdrawConsent(); dismiss() }
                }
                Section("Account") {
                    Button("Delete my Belna account", role: .destructive) { model.showDeletion = true }
                    Text("Permanently deletes your account and associated account data. Financial records required by law may be retained. Cancel paid subscriptions before deleting.").font(.footnote)
                }
                Section { Text("Apple Notes, Mail and Messages do not offer general third-party access through these connections. Health availability depends on the device; it is usually accessed on iPhone or iPad.").font(.footnote) }
            }.navigationTitle("Apple apps")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
                .confirmationDialog("Permanently delete your Belna account?", isPresented: $model.showDeletion, titleVisibility: .visible) {
                    Button("Delete account", role: .destructive) { Task { do { try await model.deleteAccount(); dismiss() } catch { self.error = error.localizedDescription } } }
                }
        }.onAppear { model.refresh() }
    }
}
