import Foundation

protocol ShotTrackerTimerCancellation: AnyObject {
  func cancel()
}

private final class DispatchWorkItemCancellation:
  ShotTrackerTimerCancellation {
  private let workItem: DispatchWorkItem

  init(_ workItem: DispatchWorkItem) {
    self.workItem = workItem
  }

  func cancel() {
    workItem.cancel()
  }
}

/// Token-aware, injectable timer used by production and pure Swift fixtures.
final class ShotTrackerAttemptTimer {
  typealias Scheduler = (
    _ delay: TimeInterval,
    _ action: @escaping () -> Void
  ) -> any ShotTrackerTimerCancellation

  private let delay: TimeInterval
  private let scheduler: Scheduler
  private let lock = NSLock()
  private var cancellation: (any ShotTrackerTimerCancellation)?
  private var currentToken: UInt64?

  var armedToken: UInt64? {
    lock.lock()
    defer { lock.unlock() }
    return currentToken
  }

  init(
    delay: TimeInterval = 2,
    scheduler: @escaping Scheduler = ShotTrackerAttemptTimer.dispatchScheduler
  ) {
    self.delay = delay
    self.scheduler = scheduler
  }

  func synchronize(
    token: UInt64?,
    onFire: @escaping (_ token: UInt64) -> Void
  ) {
    lock.lock()
    guard token != currentToken else {
      lock.unlock()
      return
    }
    cancellation?.cancel()
    cancellation = nil
    currentToken = nil
    guard let token else {
      lock.unlock()
      return
    }
    currentToken = token
    cancellation = scheduler(delay) { [weak self] in
      guard let self else { return }
      self.lock.lock()
      guard self.currentToken == token else {
        self.lock.unlock()
        return
      }
      self.cancellation = nil
      self.currentToken = nil
      self.lock.unlock()
      onFire(token)
    }
    lock.unlock()
  }

  func cancel() {
    lock.lock()
    cancellation?.cancel()
    cancellation = nil
    currentToken = nil
    lock.unlock()
  }

  private static func dispatchScheduler(
    delay: TimeInterval,
    action: @escaping () -> Void
  ) -> any ShotTrackerTimerCancellation {
    let workItem = DispatchWorkItem(block: action)
    DispatchQueue(
      label: "com.hoopplan.shot-tracker.attempt-timer",
      qos: .userInitiated
    ).asyncAfter(deadline: .now() + delay, execute: workItem)
    return DispatchWorkItemCancellation(workItem)
  }
}
