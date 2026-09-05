import CoreML
import CoreGraphics

enum ShotTrackerCoreMLDecoder {
  static let expectedShape = [1, 300, 6]
  static let classNames = ["ball", "human", "rim"]

  /// Exact local decoder semantics from `LocalCoreMLCameraView.swift` at the
  /// pinned source commit. Boxes may be model-space pixels or normalized.
  static func decode(
    _ tensor: MLMultiArray,
    inputSize: CGSize,
    minimumBallConfidence: Double,
    trackRim: Bool
  ) throws -> (ball: STDetection?, rim: STDetection?) {
    guard tensor.shape.map(\.intValue) == expectedShape else {
      throw NSError(
        domain: "ReactNativeShotTracker",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "Expected Core ML output [1,300,6]."]
      )
    }
    let modelWidth = max(1, Double(inputSize.width))
    let modelHeight = max(1, Double(inputSize.height))
    let confidence = max(0.05, min(0.95, minimumBallConfidence))
    var bestBall: STDetection?
    var bestRim: STDetection?

    for row in 0..<300 {
      let values = (0..<6).map { column in
        tensor[[0, row, column] as [NSNumber]].doubleValue
      }
      guard values.allSatisfy(\.isFinite), values[4] > 0 else { continue }
      let classIndex = Int(values[5].rounded())
      guard classNames.indices.contains(classIndex) else { continue }
      let normalized =
        max(values[0], values[2]) <= 1.5 &&
        max(values[1], values[3]) <= 1.5
      let scaleX = normalized ? 1 : modelWidth
      let scaleY = normalized ? 1 : modelHeight
      let left = max(0, min(1, values[0] / scaleX))
      let top = max(0, min(1, values[1] / scaleY))
      let right = max(0, min(1, values[2] / scaleX))
      let bottom = max(0, min(1, values[3] / scaleY))
      guard right > left, bottom > top else { continue }
      let detection = STDetection(
        rect: STRect(x: left, y: top, width: right - left, height: bottom - top),
        confidence: values[4],
        label: classNames[classIndex]
      )
      if classIndex == 0, detection.confidence >= confidence {
        if bestBall == nil || detection.confidence > bestBall!.confidence {
          bestBall = detection
        }
      } else if trackRim, classIndex == 2 {
        if bestRim == nil || detection.confidence > bestRim!.confidence {
          bestRim = detection
        }
      }
    }
    return (bestBall, bestRim)
  }
}
