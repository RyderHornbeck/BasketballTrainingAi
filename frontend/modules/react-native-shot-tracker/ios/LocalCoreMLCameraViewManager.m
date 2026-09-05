#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(LocalCoreMLCameraViewManager, RCTViewManager)

RCT_EXPORT_VIEW_PROPERTY(isActive, BOOL)
RCT_EXPORT_VIEW_PROPERTY(ballConfidence, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(trackRim, BOOL)
RCT_EXPORT_VIEW_PROPERTY(onTrackerEvent, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onModelStatus, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onCameraStatus, RCTDirectEventBlock)

@end
