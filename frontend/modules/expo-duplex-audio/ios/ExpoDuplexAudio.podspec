require "json"

package = JSON.parse(File.read(File.join(__dir__, "..", "package.json")))

Pod::Spec.new do |s|
  s.name           = "ExpoDuplexAudio"
  s.version        = package["version"]
  s.summary        = package["description"]
  s.description    = package["description"]
  s.license        = package["license"]
  s.author         = "Court Coach"
  s.homepage       = "https://example.invalid/expo-duplex-audio"
  s.platforms      = { :ios => "16.4" }
  s.swift_version  = "5.9"
  s.source         = { :git => "https://example.invalid/expo-duplex-audio.git" }
  s.static_framework = true

  s.dependency "ExpoModulesCore"
  s.source_files = "**/*.swift"
end
