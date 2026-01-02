// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "AdeoNotifyAgent",
  platforms: [.macOS(.v12)],
  products: [
    .executable(name: "AdeoNotifyAgent", targets: ["AdeoNotifyAgent"])
  ],
  targets: [
    .executableTarget(
      name: "AdeoNotifyAgent",
      path: "Sources/AdeoNotifyAgent"
    )
  ]
)
