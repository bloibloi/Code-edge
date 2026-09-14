import SwiftUI

struct ContentView: View {
    @State private var pairingCode = ""
    @State private var status = "Enter the code shown on your Chromebook."
    @State private var isPairing = false
    @State private var isReady = SharedConfig.publishURL != nil

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()

                Image(systemName: isReady ? "iphone.radiowaves.left.and.right" : "rectangle.connected.to.line.below")
                    .font(.system(size: 56, weight: .light))
                    .foregroundStyle(isReady ? .green : .indigo)
                    .accessibilityHidden(true)

                VStack(spacing: 8) {
                    Text(isReady ? "Ready to stream" : "Connect to Chromebook")
                        .font(.title2.bold())
                    Text(status)
                        .font(.subheadline)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                }

                if !isReady {
                    TextField("6-digit code", text: $pairingCode)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .font(.system(.title2, design: .monospaced, weight: .semibold))
                        .multilineTextAlignment(.center)
                        .padding()
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
                        .onChange(of: pairingCode) { newValue in
                            pairingCode = String(newValue.filter(\.isNumber).prefix(6))
                        }

                    Button(action: pair) {
                        HStack {
                            if isPairing { ProgressView().tint(.white) }
                            Text(isPairing ? "Connecting…" : "Connect")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(pairingCode.count != 6 || isPairing)
                } else {
                    BroadcastPickerButton()
                        .frame(height: 54)

                    Button("Disconnect", role: .destructive) {
                        SharedConfig.clearSession()
                        isReady = false
                        pairingCode = ""
                        status = "Enter the code shown on your Chromebook."
                    }
                    .buttonStyle(.borderless)
                }

                Spacer()

                Text("For privacy, enable Focus before sharing. Apple always requires confirmation before a broadcast begins.")
                    .font(.caption)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            .padding(24)
            .navigationTitle("iPhone Remote")
        }
    }

    private func pair() {
        guard let apiURL = SharedConfig.pairingAPIURL else {
            status = "The pairing server has not been configured in this build."
            return
        }

        isPairing = true
        status = "Connecting securely…"

        Task {
            do {
                let response = try await PairingClient.join(code: pairingCode, apiURL: apiURL)
                SharedConfig.save(session: response)
                await MainActor.run {
                    isReady = true
                    isPairing = false
                    status = "Tap Start Broadcast, then confirm iPhone Remote."
                }
            } catch {
                await MainActor.run {
                    isPairing = false
                    status = error.localizedDescription
                }
            }
        }
    }
}

