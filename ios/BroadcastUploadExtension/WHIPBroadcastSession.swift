import CoreMedia
import Foundation
import ReplayKit
import UIKit
import WebRTC

final class WHIPBroadcastSession: NSObject {
    private let publishURL: URL
    private let factory: RTCPeerConnectionFactory
    private let videoSource: RTCVideoSource
    private let capturer: RTCVideoCapturer
    private var peerConnection: RTCPeerConnection?
    private var resourceURL: URL?
    private var gatherContinuation: CheckedContinuation<Void, Never>?
    private let stateLock = NSLock()
    private var paused = false

    init(publishURL: URL) {
        self.publishURL = publishURL
        RTCInitializeSSL()

        let encoderFactory = RTCDefaultVideoEncoderFactory()
        encoderFactory.preferredCodec = RTCVideoCodecInfo(name: kRTCVideoCodecH264Name)
        let decoderFactory = RTCDefaultVideoDecoderFactory()
        factory = RTCPeerConnectionFactory(encoderFactory: encoderFactory, decoderFactory: decoderFactory)
        videoSource = factory.videoSource(forScreenCast: true)
        capturer = RTCVideoCapturer(delegate: videoSource)
        super.init()
        videoSource.adaptOutputFormat(toWidth: 720, height: 1280, fps: 30)
    }

    func start() async throws {
        let configuration = RTCConfiguration()
        configuration.sdpSemantics = .unifiedPlan
        configuration.bundlePolicy = .maxBundle
        configuration.rtcpMuxPolicy = .require
        configuration.continualGatheringPolicy = .gatherContinually

        let constraints = RTCMediaConstraints(
            mandatoryConstraints: nil,
            optionalConstraints: ["DtlsSrtpKeyAgreement": "true"]
        )
        guard let peer = factory.peerConnection(
            with: configuration,
            constraints: constraints,
            delegate: self
        ) else {
            throw WHIPError.peerConnectionFailed
        }
        peerConnection = peer

        let videoTrack = factory.videoTrack(with: videoSource, trackId: "screen-video")
        guard peer.add(videoTrack, streamIds: ["iphone-screen"]) != nil else {
            throw WHIPError.videoTrackFailed
        }

        let offer = try await createOffer(peer)
        try await setLocalDescription(offer, on: peer)
        await waitForIceGathering(peer)

        guard let localSDP = peer.localDescription?.sdp else {
            throw WHIPError.missingLocalDescription
        }

        var request = URLRequest(url: publishURL)
        request.httpMethod = "POST"
        request.setValue("application/sdp", forHTTPHeaderField: "Content-Type")
        request.setValue("application/sdp", forHTTPHeaderField: "Accept")
        request.httpBody = Data(localSDP.utf8)
        request.timeoutInterval = 15

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw WHIPError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw WHIPError.serverRejected(http.statusCode)
        }
        guard let answerSDP = String(data: data, encoding: .utf8), !answerSDP.isEmpty else {
            throw WHIPError.invalidResponse
        }

        if let location = http.value(forHTTPHeaderField: "Location") {
            resourceURL = URL(string: location, relativeTo: publishURL)?.absoluteURL
        }

        try await setRemoteDescription(RTCSessionDescription(type: .answer, sdp: answerSDP), on: peer)
    }

    func sendVideo(_ sampleBuffer: CMSampleBuffer) {
        stateLock.lock()
        let shouldDrop = paused
        stateLock.unlock()
        guard !shouldDrop,
              CMSampleBufferDataIsReady(sampleBuffer),
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let timestampNs: Int64
        if timestamp.isValid && !timestamp.isIndefinite {
            timestampNs = Int64(CMTimeGetSeconds(timestamp) * 1_000_000_000)
        } else {
            timestampNs = Int64(ProcessInfo.processInfo.systemUptime * 1_000_000_000)
        }

        let frame = RTCVideoFrame(
            buffer: RTCCVPixelBuffer(pixelBuffer: pixelBuffer),
            rotation: rotation(for: sampleBuffer),
            timeStampNs: timestampNs
        )
        videoSource.capturer(capturer, didCapture: frame)
    }

    func setPaused(_ value: Bool) {
        stateLock.lock()
        paused = value
        stateLock.unlock()
    }

    func stop() async {
        peerConnection?.close()
        peerConnection = nil

        guard let resourceURL else { return }
        var request = URLRequest(url: resourceURL)
        request.httpMethod = "DELETE"
        request.timeoutInterval = 5
        _ = try? await URLSession.shared.data(for: request)
        self.resourceURL = nil
    }

    private func rotation(for sampleBuffer: CMSampleBuffer) -> RTCVideoRotation {
        guard let value = CMGetAttachment(
            sampleBuffer,
            key: RPVideoSampleOrientationKey as CFString,
            attachmentModeOut: nil
        ) as? NSNumber,
        let orientation = UIInterfaceOrientation(rawValue: value.intValue) else { return ._0 }

        switch orientation {
        case .portrait: return ._0
        case .portraitUpsideDown: return ._180
        case .landscapeLeft: return ._90
        case .landscapeRight: return ._270
        default: return ._0
        }
    }

    private func createOffer(_ peer: RTCPeerConnection) async throws -> RTCSessionDescription {
        let constraints = RTCMediaConstraints(
            mandatoryConstraints: ["OfferToReceiveAudio": "false", "OfferToReceiveVideo": "false"],
            optionalConstraints: nil
        )
        return try await withCheckedThrowingContinuation { continuation in
            peer.offer(for: constraints) { description, error in
                if let error { continuation.resume(throwing: error) }
                else if let description { continuation.resume(returning: description) }
                else { continuation.resume(throwing: WHIPError.missingLocalDescription) }
            }
        }
    }

    private func setLocalDescription(_ description: RTCSessionDescription, on peer: RTCPeerConnection) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peer.setLocalDescription(description) { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: ()) }
            }
        }
    }

    private func setRemoteDescription(_ description: RTCSessionDescription, on peer: RTCPeerConnection) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peer.setRemoteDescription(description) { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: ()) }
            }
        }
    }

    private func waitForIceGathering(_ peer: RTCPeerConnection) async {
        if peer.iceGatheringState == .complete { return }
        await withCheckedContinuation { continuation in
            gatherContinuation = continuation
            DispatchQueue.global().asyncAfter(deadline: .now() + 3) { [weak self] in
                self?.finishGatheringWait()
            }
        }
    }

    private func finishGatheringWait() {
        guard let continuation = gatherContinuation else { return }
        gatherContinuation = nil
        continuation.resume()
    }
}

extension WHIPBroadcastSession: RTCPeerConnectionDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
        if newState == .complete { finishGatheringWait() }
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}

enum WHIPError: LocalizedError {
    case peerConnectionFailed
    case videoTrackFailed
    case missingLocalDescription
    case invalidResponse
    case serverRejected(Int)

    var errorDescription: String? {
        switch self {
        case .peerConnectionFailed: return "Could not create the WebRTC connection."
        case .videoTrackFailed: return "Could not attach the iPhone screen to the stream."
        case .missingLocalDescription: return "WebRTC did not generate a publishing offer."
        case .invalidResponse: return "The streaming server returned an invalid response."
        case .serverRejected(let status): return "The streaming server rejected the broadcast (HTTP \(status))."
        }
    }
}
