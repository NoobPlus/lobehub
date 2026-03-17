import { ipcMain, screen } from 'electron';

import { BrowsersIdentifiers } from '@/appBrowsers';

import { ControllerModule, IpcMethod, shortcut } from './index';

export default class SpotlightCtr extends ControllerModule {
  static override readonly groupName = 'spotlight';

  afterAppReady() {
    // Listen for renderer ready signal
    ipcMain.on('spotlight:ready', () => {
      const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
      spotlight?.markReady();
    });

    // Listen for renderer hide request
    ipcMain.on('spotlight:hide', () => {
      const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
      spotlight?.hide();
    });

    // Listen for renderer resize request
    ipcMain.on('spotlight:resize', (_event, params: { height: number; width: number }) => {
      const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
      if (!spotlight) return;

      const currentBounds = spotlight.browserWindow.getBounds();
      spotlight.browserWindow.setBounds(
        {
          height: params.height,
          width: params.width,
          x: currentBounds.x,
          y: currentBounds.y,
        },
        true,
      );
    });

    // Setup blur handler
    this.setupBlurHandler();

    // Setup crash recovery
    this.setupCrashRecovery();
  }

  @shortcut('showSpotlight')
  async toggleSpotlight() {
    const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
    if (!spotlight) return;

    if (spotlight.browserWindow.isVisible()) {
      spotlight.hide();
      return;
    }

    await spotlight.whenReady();

    const cursor = screen.getCursorScreenPoint();
    spotlight.showAt(cursor);

    spotlight.broadcast('spotlightFocus' as any);
  }

  @IpcMethod()
  async resize(params: { height: number; width: number }) {
    const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
    if (!spotlight) return;

    const currentBounds = spotlight.browserWindow.getBounds();
    spotlight.browserWindow.setBounds(
      {
        height: params.height,
        width: params.width,
        x: currentBounds.x,
        y: currentBounds.y,
      },
      true,
    );
  }

  @IpcMethod()
  async hide() {
    const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
    spotlight?.hide();
  }

  private setupBlurHandler() {
    const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
    if (spotlight) {
      spotlight.browserWindow.on('blur', () => {
        if (spotlight.browserWindow.isVisible()) {
          spotlight.hide();
        }
      });
    }
  }

  private setupCrashRecovery() {
    const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
    if (spotlight) {
      spotlight.browserWindow.webContents.on('render-process-gone', () => {
        console.error('[SpotlightCtr] Spotlight renderer crashed, recreating...');
        spotlight.resetReady();
        spotlight.destroy();
        this.app.browserManager.retrieveByIdentifier(BrowsersIdentifiers.spotlight);
      });
    }
  }
}
