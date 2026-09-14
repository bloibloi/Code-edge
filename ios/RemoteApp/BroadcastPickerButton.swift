import ReplayKit
import SwiftUI

struct BroadcastPickerButton: UIViewRepresentable {
    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let picker = RPSystemBroadcastPickerView(frame: .zero)
        picker.preferredExtension = SharedConfig.broadcastExtensionBundleID
        picker.showsMicrophoneButton = false
        picker.backgroundColor = .systemIndigo
        picker.layer.cornerRadius = 14

        if let systemButton = picker.subviews.compactMap({ $0 as? UIButton }).first {
            systemButton.setImage(nil, for: .normal)
            systemButton.setTitle("Start Broadcast", for: .normal)
            systemButton.setTitleColor(.white, for: .normal)
            systemButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        }
        return picker
    }

    func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {}
}

