import SwiftUI

struct ContentView: View {
    @State private var joinCode = SharedConfig.joinCode ?? ""
    @State private var sessionPassword = SharedConfig.password ?? ""
    @State private var status = SharedConfig.sessionIsActive
        ? "Send both details to the person watching."
        : "Create a private stream for your Chromebook."
    @State private var isCreating = false
    @State private var isReady = SharedConfig.sessionIsActive

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    Image(systemName: isReady ? "iphone.radiowaves.left.and.right" : "lock.iphone")
                        .font(.system(size: 56, weight: .light))
                        .foregroundStyle(isReady ? .green : .indigo)
                        .accessibilityHidden(true)
                        .padding(.top, 34)

                    VStack(spacing: 8) {
                        Text(isReady ? "Ready to stream" : "Stream your iPhone")
                            .font(.title2.bold())
                        Text(status)
                            .font(.subheadline)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.secondary)
                    }

                    if isReady {
                        VStack(spacing: 12) {
                            credentialCard(title: "JOIN CODE", value: formattedCode)
                            credentialCard(title: "PASSWORD", value: sessionPassword)
                        }

                        ShareLink(item: accessMessage) {
                            Label("Share code and password", systemImage: "square.and.arrow.up")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)

                        BroadcastPickerButton()
                            .frame(height: 54)

                        Button("End session", role: .destructive) {
                            SharedConfig.clearSession()
                            joinCode = ""
                            sessionPassword = ""
                            isReady = false
                            status = "Create a private stream for your Chromebook."
                        }
                        .buttonStyle(.borderless)
                    } else {
                        Button(action: createStream) {
                            HStack {
                                if isCreating { ProgressView().tint(.white) }
                                Text(isCreating ? "Creating secure stream…" : "Create private stream")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(isCreating)

                        VStack(alignment: .leading, spacing: 11) {
                            Label("A six-digit join code", systemImage: "number")
                            Label("A separate secure password", systemImage: "key")
                            Label("Only one viewer can join", systemImage: "person.crop.circle.badge.checkmark")
                        }
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(18)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
                    }

                    Text("Enable Focus before sharing. Apple always asks you to confirm before the broadcast starts.")
                        .font(.caption)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 12)
                }
                .padding(.horizontal, 24)
            }
            .navigationTitle("iPhone Remote")
        }
    }

    private var formattedCode: String {
        guard joinCode.count == 6 else { return joinCode }
        return "\(joinCode.prefix(3)) \(joinCode.suffix(3))"
    }

    private var accessMessage: String {
        "Watch my iPhone at https://bloibloi.github.io/Code-edge/#watch-iphone\nCode: \(joinCode)\nPassword: \(sessionPassword)"
    }

    private func credentialCard(title: String, value: String) -> some View {
        VStack(spacing: 7) {
            Text(title)
                .font(.caption2.bold())
                .tracking(1.5)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(.title2, design: .monospaced, weight: .bold))
                .textSelection(.enabled)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
        .padding(18)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    private func createStream() {
        guard let apiURL = SharedConfig.pairingAPIURL else {
            status = "The connection server has not been configured in this build."
            return
        }

        let password = makePassword()
        isCreating = true
        status = "Creating your private stream…"

        Task {
            do {
                let response = try await PairingClient.createStream(password: password, apiURL: apiURL)
                SharedConfig.save(session: response, password: password)
                await MainActor.run {
                    joinCode = response.code
                    sessionPassword = password
                    isReady = true
                    isCreating = false
                    status = "Enter both details on the Chromebook, then tap Start Broadcast."
                }
            } catch {
                await MainActor.run {
                    isCreating = false
                    status = error.localizedDescription
                }
            }
        }
    }

    private func makePassword() -> String {
        let characters = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        var generator = SystemRandomNumberGenerator()
        return String((0..<10).compactMap { _ in characters.randomElement(using: &generator) })
    }
}
