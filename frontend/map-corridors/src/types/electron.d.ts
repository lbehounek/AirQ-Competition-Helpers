// Augment the ElectronStorageAPI interface from @airq/shared-storage with the
// additional methods that this app consumes via window.electronAPI. The shared
// package only declares the storage subset; desktop preload.js exposes these extra
// methods (see frontend/desktop/preload.js for the source of truth). TypeScript
// interface merging combines this declaration with the one in shared-storage/types.ts
// so a single `window.electronAPI?.<method>` call compiles everywhere.

declare module '@airq/shared-storage' {
  interface ElectronCompetitionsAPI {
    list: () => Promise<{ competitions?: Array<{ id: string; name: string }> }>
    setWorkingDir?: (id: string, workingDir: string) => Promise<unknown>
    getWorkingDir?: (id: string) => Promise<string | null>
  }

  interface ElectronStorageAPI {
    goHome?: () => void
    navigateToApp?: (app: string, competitionId: string) => void
    openMapboxSettings?: () => void
    saveMapImage?: (base64: string, defaultDir?: string) => Promise<void>
    savePdf?: (base64: string, fileName: string, defaultDir?: string) => Promise<string | null>
    getConfig?: (key: string) => Promise<string | undefined>
    setConfig?: (key: string, value: string) => Promise<void>
    setMenuLocale?: (locale: string) => void
    competitions?: ElectronCompetitionsAPI
  }
}

export {}
