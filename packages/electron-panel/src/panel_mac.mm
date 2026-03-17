#ifdef PLATFORM_OSX
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#include <cstdio>

static const void *kDragViewKey = &kDragViewKey;

#define RUN_ON_MAIN(block)                           \
  if ([NSThread isMainThread]) {                     \
    block();                                         \
  } else {                                           \
    dispatch_sync(dispatch_get_main_queue(), block); \
  }

// ---------------------------------------------------------------------------
// DragView — transparent overlay that intercepts mouse events for window drag
// ---------------------------------------------------------------------------
@interface PanelDragView : NSView
@end

@implementation PanelDragView

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}

- (void)mouseDown:(NSEvent *)event {
  [self.window performWindowDragWithEvent:event];
}

- (NSView *)hitTest:(NSPoint)point {
  NSPoint local = [self convertPoint:point fromView:self.superview];
  if (NSPointInRect(local, self.bounds)) {
    return self;
  }
  return nil;
}

@end

// ---------------------------------------------------------------------------
// panelize — set NSPanel-grade properties on an NSWindow
// ---------------------------------------------------------------------------
extern "C" bool panelize(unsigned char *buffer) {
  if (!buffer) return false;

  __block bool success = false;

  RUN_ON_MAIN(^{
    NSView *rootView = *reinterpret_cast<NSView **>(buffer);
    if (!rootView) return;

    NSWindow *window = [rootView window];
    if (!window) return;

    if ([window respondsToSelector:@selector(setFloatingPanel:)]) {
      [(id)window setFloatingPanel:YES];
    }

    if ([window respondsToSelector:@selector(setBecomesKeyOnlyIfNeeded:)]) {
      [(id)window setBecomesKeyOnlyIfNeeded:YES];
    }

    if ([window respondsToSelector:@selector(setHidesOnDeactivate:)]) {
      [window setHidesOnDeactivate:NO];
    }

    window.collectionBehavior |=
        NSWindowCollectionBehaviorCanJoinAllSpaces |
        NSWindowCollectionBehaviorFullScreenAuxiliary;

    window.level = NSFloatingWindowLevel;

    success = true;
  });

  return success;
}

// ---------------------------------------------------------------------------
// enableNativeDrag — add a transparent drag overlay at the specified rect
// ---------------------------------------------------------------------------
extern "C" bool enableNativeDrag(unsigned char *buffer,
                                  double x, double y,
                                  double width, double height) {
  if (!buffer) return false;

  __block bool success = false;

  RUN_ON_MAIN(^{
    NSView *rootView = *reinterpret_cast<NSView **>(buffer);
    if (!rootView) return;

    NSWindow *window = [rootView window];
    if (!window) return;

    NSView *contentView = window.contentView;
    if (!contentView) return;

    NSView *oldDrag = objc_getAssociatedObject(contentView, kDragViewKey);
    if (oldDrag) {
      [oldDrag removeFromSuperview];
    }

    // Convert top-left origin (web) to bottom-left origin (macOS)
    NSRect contentBounds = contentView.bounds;
    double flippedY = contentBounds.size.height - y - height;
    NSRect dragRect = NSMakeRect(x, flippedY, width, height);

    PanelDragView *dragView = [[PanelDragView alloc] initWithFrame:dragRect];
    dragView.autoresizingMask = NSViewWidthSizable | NSViewMinYMargin;

    [contentView addSubview:dragView positioned:NSWindowAbove relativeTo:nil];
    objc_setAssociatedObject(contentView, kDragViewKey, dragView,
                             OBJC_ASSOCIATION_RETAIN);

    success = true;
  });

  return success;
}

// ---------------------------------------------------------------------------
// disableNativeDrag — remove the drag overlay
// ---------------------------------------------------------------------------
extern "C" bool disableNativeDrag(unsigned char *buffer) {
  if (!buffer) return false;

  __block bool success = false;

  RUN_ON_MAIN(^{
    NSView *rootView = *reinterpret_cast<NSView **>(buffer);
    if (!rootView) return;

    NSWindow *window = [rootView window];
    if (!window) return;

    NSView *contentView = window.contentView;
    if (!contentView) return;

    NSView *dragView = objc_getAssociatedObject(contentView, kDragViewKey);
    if (dragView) {
      [dragView removeFromSuperview];
      objc_setAssociatedObject(contentView, kDragViewKey, nil,
                               OBJC_ASSOCIATION_ASSIGN);
    }

    success = true;
  });

  return success;
}

// ---------------------------------------------------------------------------
// animateResize — smoothly animate window to a new frame
// ---------------------------------------------------------------------------
extern "C" bool animateResize(unsigned char *buffer,
                               double x, double y,
                               double width, double height,
                               double duration) {
  if (!buffer) return false;

  __block bool success = false;

  RUN_ON_MAIN(^{
    NSView *rootView = *reinterpret_cast<NSView **>(buffer);
    if (!rootView) return;

    NSWindow *window = [rootView window];
    if (!window) return;

    NSRect newFrame = NSMakeRect(x, y, width, height);

    if (duration <= 0) {
      [window setFrame:newFrame display:YES];
    } else {
      [NSAnimationContext runAnimationGroup:^(NSAnimationContext *ctx) {
        ctx.duration = duration;
        ctx.timingFunction = [CAMediaTimingFunction
            functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
        [[window animator] setFrame:newFrame display:YES];
      }];
    }

    success = true;
  });

  return success;
}

#endif // PLATFORM_OSX
