// Ponte com a versão desktop (Electron, ver electron/preload.cjs). No navegador, `desktop` é null.

export interface DesktopConfig {
  uncappedFps: boolean;
  fullscreen: boolean;
  platform: string;
  versions: { electron: string; chrome: string };
}

export interface DesktopBridge {
  getConfig(): Promise<DesktopConfig>;
  setConfig(patch: Partial<Pick<DesktopConfig, 'uncappedFps' | 'fullscreen'>>): Promise<DesktopConfig>;
  gpuInfo(): Promise<{ devices: { vendorId: number; deviceId: number; active: boolean; driverVendor?: string }[]; webgl2: string; webgpu: string }>;
  relaunch(): void;
  quit(): void;
}

export const desktop: DesktopBridge | null = (window as unknown as { desktop?: DesktopBridge }).desktop ?? null;
