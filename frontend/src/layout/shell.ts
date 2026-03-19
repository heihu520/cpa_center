import type { ComputedRef, InjectionKey } from 'vue'

export type ShellMode = 'wide' | 'desktop' | 'compact' | 'mobile'

export const shellModeKey: InjectionKey<ComputedRef<ShellMode>> = Symbol('shell-mode')

export const wideWidthThreshold = 1900
export const wideHeightThreshold = 900
export const compactWidthThreshold = 1366
export const compactHeightThreshold = 820
export const mobileWidthThreshold = 920

export function resolveShellMode(width: number, height: number, devicePixelRatio = 1): ShellMode {
  const effectiveWidth = width * Math.max(devicePixelRatio, 1)
  const effectiveHeight = height * Math.max(devicePixelRatio, 1)

  if (width <= mobileWidthThreshold) {
    return 'mobile'
  }
  if (effectiveWidth >= wideWidthThreshold && effectiveHeight >= wideHeightThreshold) {
    return 'wide'
  }
  if (width < compactWidthThreshold || height < compactHeightThreshold) {
    return 'compact'
  }
  return 'desktop'
}

export function resolveDashboardDrawerSize(mode: ShellMode): string {
  switch (mode) {
    case 'wide':
      return 'min(1200px, calc(100vw - 48px))'
    case 'compact':
      return 'min(calc(100vw - 16px), 96vw)'
    case 'mobile':
      return '100vw'
    default:
      return 'min(1120px, calc(100vw - 32px))'
  }
}

export function resolveDonutLayoutMode(mode: ShellMode, width: number, height: number): ShellMode {
  if (mode === 'compact' || width < 420 || height < 250) {
    return 'compact'
  }
  if (mode === 'wide' && width >= 480 && height >= 300) {
    return 'wide'
  }
  return 'desktop'
}
