require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ReactNativeShotTracker"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.description  = package["description"]
  s.license      = package["license"]
  s.author       = "Court Coach"
  s.homepage     = "https://example.invalid/react-native-shot-tracker"
  s.platforms    = { :ios => "16.4" }
  s.swift_version = "5.9"
  s.source       = {
    :git => "https://example.invalid/react-native-shot-tracker.git",
    :tag => "#{s.version}"
  }

  s.source_files = ["ios/**/*.{swift,m,mm,h,hpp,cpp}"]
  s.exclude_files = ["ios/Tests/**/*"]
  s.frameworks = ["AVFoundation", "CoreML", "CoreVideo", "QuartzCore", "UIKit", "Vision"]

  load "nitrogen/generated/ios/ReactNativeShotTracker+autolinking.rb"
  add_nitrogen_files(s)

  s.dependency "VisionCamera", "5.1.1"
  s.dependency "React-jsi"
  s.dependency "React-callinvoker"
  install_modules_dependencies(s)
end
