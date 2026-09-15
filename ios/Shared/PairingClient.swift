import Foundation

struct IPhoneStreamSessionResponse: Decodable {
    let code: String
    let whipPublishURL: URL
    let publisherToken: String
    let expiresAt: String
}

enum PairingError: LocalizedError {
    case invalidResponse
    case rejected(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "The pairing server returned an invalid response."
        case .rejected(let message): return message
        }
    }
}

enum PairingClient {
    static func createStream(password: String, apiURL: URL) async throws -> IPhoneStreamSessionResponse {
        let endpoint = apiURL.appendingPathComponent("v1/iphone/create")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["password": password])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PairingError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data).error)
                ?? "The stream could not be created."
            throw PairingError.rejected(message)
        }
        return try JSONDecoder().decode(IPhoneStreamSessionResponse.self, from: data)
    }
}

private struct ErrorResponse: Decodable {
    let error: String
}
