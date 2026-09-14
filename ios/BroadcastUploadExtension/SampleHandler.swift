import CoreMedia
import ReplayKit

final class SampleHandler: RPBroadcastSampleHandler {
    private var session: WHIPBroadcastSession?

    override func broadcastStarted(withSetupInfo setupInfo: [String : NSObject]?) {
        guard let publishURL = SharedConfig.publishURL else {
            finishBroadcastWithError(BroadcastError.missingConfiguration)
            return
        }

        let session = WHIPBroadcastSession(publishURL: publishURL)
        self.session = session

        Task {
            do {
                try await session.start()
            } catch {
                finishBroadcastWithError(error)
            }
        }
    }

    override func broadcastPaused() {
        session?.setPaused(true)
    }

    override func broadcastResumed() {
        session?.setPaused(false)
    }

    override func broadcastFinished() {
        let activeSession = session
        session = nil
        Task { await activeSession?.stop() }
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        guard sampleBufferType == .video else { return }
        session?.sendVideo(sampleBuffer)
    }
}

enum BroadcastError: LocalizedError {
    case missingConfiguration

    var errorDescription: String? {
        "Open iPhone Remote and connect it to the Chromebook before broadcasting."
    }
}

