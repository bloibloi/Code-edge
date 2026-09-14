import Foundation

struct PairingJoinResponse: Decodable {
    let whipPublishURL: URL
    let sessionToken: String
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
    static func join(code: String, apiURL: URL) async throws -> PairingJoinResponse {
        let endpoint = apiURL.appendingPathComponent("v1/pair/join")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["code": code])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PairingError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data).error)
                ?? "The code is invalid or expired."
            throw PairingError.rejected(message)
        }
        return try JSONDecoder().decode(PairingJoinResponse.self, from: data)
    }
}

private struct ErrorResponse: Decodable {
    let error: String
}

