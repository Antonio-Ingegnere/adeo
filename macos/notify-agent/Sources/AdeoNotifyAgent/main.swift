import Foundation
import AppKit
import UserNotifications
import Network
import Darwin

struct NotifyPayload: Decodable {
  let id: String
  let title: String
  let body: String
}

setbuf(stdout, nil)
setbuf(stderr, nil)
print("AdeoNotifyAgent boot")

final class ConnectionState {
  var buffer = Data()
}

final class NotificationAgent {
  private let port: UInt16
  private var listener: NWListener?
  private let queue = DispatchQueue(label: "com.yourcompany.adeo.notify2")
  private let logFilePath: String
  private let shouldPrompt: Bool

  init(port: UInt16) {
    self.port = port
    self.shouldPrompt = ProcessInfo.processInfo.environment["ADEO_NOTIFY_PROMPT"] == "1"
    if let custom = ProcessInfo.processInfo.environment["ADEO_NOTIFY_LOG"], !custom.isEmpty {
      self.logFilePath = custom
    } else {
      let home = FileManager.default.homeDirectoryForCurrentUser.path
      self.logFilePath = "\(home)/Library/Logs/AdeoNotifyAgent.log"
    }
    appendLog("AdeoNotifyAgent init")
  }

  func start() {
    logBundleInfo()
    configureAppIfNeeded()
    if shouldPrompt {
      requestNotificationPermission(waitForResult: true)
      exit(0)
    }
    requestNotificationPermission(waitForResult: false)
    startListener()
    dispatchMain()
  }

  private func configureAppIfNeeded() {
    guard shouldPrompt else { return }
    _ = NSApplication.shared
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
    log("Prompt mode enabled: activated app to request permissions.")
  }

  private func appendLog(_ message: String) {
    let line = "\(message)\n"
    guard let data = line.data(using: .utf8) else { return }
    if !FileManager.default.fileExists(atPath: logFilePath) {
      FileManager.default.createFile(atPath: logFilePath, contents: data)
      return
    }
    if let handle = try? FileHandle(forWritingTo: URL(fileURLWithPath: logFilePath)) {
      handle.seekToEndOfFile()
      handle.write(data)
      try? handle.close()
    }
  }

  private func log(_ message: String) {
    NSLog(message)
    appendLog(message)
  }

  private func logBundleInfo() {
    let bundleId = Bundle.main.bundleIdentifier ?? "unknown"
    let bundlePath = Bundle.main.bundlePath
    log("Bundle identifier: \(bundleId)")
    log("Bundle path: \(bundlePath)")
  }

  private func requestNotificationPermission(waitForResult: Bool) {
    let center = UNUserNotificationCenter.current()
    let done = DispatchSemaphore(value: 0)
    center.requestAuthorization(options: [.alert, .sound]) { granted, error in
      if let error = error {
        self.log("Notification permission error: \(error)")
      } else {
        self.log("Notification permission granted: \(granted)")
      }
      self.logNotificationSettings()
      done.signal()
    }
    if waitForResult {
      _ = done.wait(timeout: .now() + 5)
    }
  }

  private func logNotificationSettings() {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      self.log("Notification settings: authorization=\(settings.authorizationStatus.rawValue) alert=\(settings.alertSetting.rawValue)")
    }
  }

  private func startListener() {
    do {
      let params = NWParameters.tcp
      params.allowLocalEndpointReuse = true
      listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
    } catch {
      log("Failed to start listener: \(error)")
      exit(1)
    }

    listener?.newConnectionHandler = { [weak self] connection in
      self?.handle(connection: connection)
    }

    listener?.stateUpdateHandler = { state in
      switch state {
      case .ready:
        self.log("Notification agent listening on 127.0.0.1:\(self.port)")
      case .failed(let error):
        self.log("Listener failed: \(error)")
        exit(1)
      default:
        break
      }
    }

    listener?.start(queue: queue)
  }

  private func handle(connection: NWConnection) {
    connection.start(queue: queue)
    let state = ConnectionState()
    receiveRequest(connection, state: state)
  }

  private func receiveRequest(_ connection: NWConnection, state: ConnectionState) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
      if let error = error {
        self?.log("Connection error: \(error)")
        connection.cancel()
        return
      }

      if let data = data, !data.isEmpty {
        state.buffer.append(data)
        if self?.tryHandleBuffer(state.buffer, connection) == true {
          return
        }
      }

      if isComplete {
        connection.cancel()
      } else {
        self?.receiveRequest(connection, state: state)
      }
    }
  }

  private func tryHandleBuffer(_ buffer: Data, _ connection: NWConnection) -> Bool {
    let separator = Data([13, 10, 13, 10])
    guard let headerRange = buffer.range(of: separator) else {
      return false
    }

    let headerData = buffer.subdata(in: 0..<headerRange.lowerBound)
    guard let headerText = String(data: headerData, encoding: .utf8) else {
      sendResponse(connection, status: "400 Bad Request")
      return true
    }
    let headers = headerText.split(separator: "\r\n")
    guard let requestLine = headers.first?.split(separator: " "), requestLine.count >= 2 else {
      sendResponse(connection, status: "400 Bad Request")
      return true
    }
    let method = String(requestLine[0])
    let path = String(requestLine[1])

    let bodyOffset = headerRange.upperBound
    let contentLength = headerText
      .components(separatedBy: "\r\n")
      .compactMap { line -> Int? in
        let parts = line.split(separator: ":", maxSplits: 1)
        if parts.count == 2 && parts[0].lowercased() == "content-length" {
          return Int(parts[1].trimmingCharacters(in: .whitespaces))
        }
        return nil
      }
      .first ?? 0

    if buffer.count < bodyOffset + contentLength {
      return false
    }

    let bodyData = buffer.subdata(in: bodyOffset..<(bodyOffset + contentLength))
    if method == "GET" && path == "/health" {
      sendResponse(connection, status: "200 OK")
      return true
    }
    if method != "POST" || path != "/notify" {
      sendResponse(connection, status: "404 Not Found")
      return true
    }

    do {
      let payload = try JSONDecoder().decode(NotifyPayload.self, from: bodyData)
      postNotification(payload)
      sendResponse(connection, status: "200 OK")
    } catch {
      log("Failed to decode payload: \(error). Body=\(String(data: bodyData, encoding: .utf8) ?? "<non-utf8>")")
      sendResponse(connection, status: "400 Bad Request")
    }
    return true
  }

  private func sendResponse(_ connection: NWConnection, status: String) {
    let response = "HTTP/1.1 \(status)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    connection.send(content: response.data(using: .utf8), completion: .contentProcessed({ _ in
      connection.cancel()
    }))
  }

  private func postNotification(_ payload: NotifyPayload) {
    let content = UNMutableNotificationContent()
    content.title = payload.title
    content.body = payload.body
    content.sound = .default

    let request = UNNotificationRequest(identifier: payload.id, content: content, trigger: nil)
    UNUserNotificationCenter.current().add(request) { error in
      if let error = error {
        self.log("Failed to post notification: \(error)")
      } else {
        self.log("Posted notification \(payload.id)")
      }
    }
  }
}

let portValue = UInt16(ProcessInfo.processInfo.environment["ADEO_NOTIFY_PORT"] ?? "48623") ?? 48623
let agent = NotificationAgent(port: portValue)
agent.start()
