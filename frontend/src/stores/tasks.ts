import { defineStore } from 'pinia'
import { EventsOff, EventsOn } from '@/lib/web-runtime'
import { api } from '@/lib/web-api'
import { i18n } from '@/i18n'
import type { CodexQuotaSnapshot, LogEntry, MaintainOptions, TaskFinished, TaskProgress } from '@/types'
import { toErrorMessage } from '@/utils/errors'
import { useAccountsStore } from '@/stores/accounts'
import { useQuotasStore } from '@/stores/quotas'
import { useSettingsStore } from '@/stores/settings'
import { taskPhaseLabel } from '@/utils/status'

interface TaskTracker {
  active: boolean
  phase: string
  current: number
  total: number
  message: string
}

interface ConnectionTaskState {
  scan: TaskTracker
  maintain: TaskTracker
  inventory: TaskTracker
  quota: TaskTracker
  inventoryQueued: boolean
  logs: LogEntry[]
}

interface TasksState {
  scan: TaskTracker
  maintain: TaskTracker
  inventory: TaskTracker
  quota: TaskTracker
  inventoryQueued: boolean
  logs: LogEntry[]
  activeConnectionId: string
  connectionStates: Record<string, ConnectionTaskState>
  initialised: boolean
  refreshScheduled: boolean
}

function emptyTracker(): TaskTracker {
  return {
    active: false,
    phase: 'idle',
    current: 0,
    total: 0,
    message: '',
  }
}

function emptyConnectionTaskState(): ConnectionTaskState {
  return {
    scan: emptyTracker(),
    maintain: emptyTracker(),
    inventory: emptyTracker(),
    quota: emptyTracker(),
    inventoryQueued: false,
    logs: [],
  }
}

function progressMessage(payload: TaskProgress): string {
  const phase = taskPhaseLabel(payload.phase)
  if (payload.total > 0) {
    return payload.message ? `${phase} ${payload.current}/${payload.total} · ${payload.message}` : `${phase} ${payload.current}/${payload.total}`
  }
  return payload.message || phase
}

function progressEntryId(connectionId: string | undefined, kind: 'scan' | 'maintain' | 'inventory' | 'quota'): string {
  return `${connectionId || 'default'}:${kind}:progress`
}

function scopedToConnection(connectionId: string | undefined, activeConnectionId: string) {
  return !connectionId || connectionId === activeConnectionId
}

export const useTasksStore = defineStore('tasksStore', {
  state: (): TasksState => ({
    scan: emptyTracker(),
    maintain: emptyTracker(),
    inventory: emptyTracker(),
    quota: emptyTracker(),
    inventoryQueued: false,
    logs: [],
    activeConnectionId: '',
    connectionStates: {},
    initialised: false,
    refreshScheduled: false,
  }),
  getters: {
    hasActiveTask: (state) => state.scan.active || state.maintain.active || state.inventory.active || state.quota.active,
  },
  actions: {
    ensureConnectionState(connectionId: string) {
      if (!this.connectionStates[connectionId]) {
        this.connectionStates[connectionId] = emptyConnectionTaskState()
      }
      return this.connectionStates[connectionId]
    },
    syncConnectionState(connectionId: string) {
      const state = this.ensureConnectionState(connectionId)
      state.scan = { ...this.scan }
      state.maintain = { ...this.maintain }
      state.inventory = { ...this.inventory }
      state.quota = { ...this.quota }
      state.inventoryQueued = this.inventoryQueued
      state.logs = [...this.logs]
    },
    hydrateConnectionState(connectionId: string) {
      const state = this.ensureConnectionState(connectionId)
      this.activeConnectionId = connectionId
      this.scan = { ...state.scan }
      this.maintain = { ...state.maintain }
      this.inventory = { ...state.inventory }
      this.quota = { ...state.quota }
      this.inventoryQueued = state.inventoryQueued
      this.logs = [...state.logs]
    },
    switchActiveConnection(connectionId: string) {
      const settingsStore = useSettingsStore()
      const previousConnectionId = this.activeConnectionId || settingsStore.activeConnectionId
      if (previousConnectionId) {
        this.syncConnectionState(previousConnectionId)
      }
      this.hydrateConnectionState(connectionId)
    },
    updateConnectionTracker(connectionId: string, kind: 'scan' | 'maintain' | 'inventory' | 'quota', tracker: TaskTracker) {
      const state = this.ensureConnectionState(connectionId)
      state[kind] = { ...tracker }
      if (connectionId === this.activeConnectionId) {
        switch (kind) {
          case 'scan':
            this.scan = { ...tracker }
            break
          case 'maintain':
            this.maintain = { ...tracker }
            break
          case 'inventory':
            this.inventory = { ...tracker }
            break
          case 'quota':
            this.quota = { ...tracker }
            break
        }
      }
    },
    appendConnectionLog(connectionId: string, entry: LogEntry) {
      const state = this.ensureConnectionState(connectionId)
      const logs = [...state.logs]
      if (entry.id) {
        const existing = logs.findIndex((item) => item.id === entry.id)
        if (existing >= 0) {
          logs.splice(existing, 1)
        }
      }
      logs.unshift(entry)
      state.logs = logs.slice(0, 500)
      if (connectionId === this.activeConnectionId) {
        this.logs = [...state.logs]
      }
    },
    initEventBridge() {
      if (this.initialised) {
        return
      }

      EventsOn('scan:log', (entry: LogEntry) => {
        const connectionId = entry.connectionId || useSettingsStore().activeConnectionId
        if (!connectionId) {
          return
        }
        this.appendConnectionLog(connectionId, { ...entry, connectionId })
      })
      EventsOn('maintain:log', (entry: LogEntry) => {
        const connectionId = entry.connectionId || useSettingsStore().activeConnectionId
        if (!connectionId) {
          return
        }
        this.appendConnectionLog(connectionId, { ...entry, connectionId })
      })
      EventsOn('inventory:log', (entry: LogEntry) => {
        const connectionId = entry.connectionId || useSettingsStore().activeConnectionId
        if (!connectionId) {
          return
        }
        this.appendConnectionLog(connectionId, { ...entry, connectionId })
      })
      EventsOn('quota:log', (entry: LogEntry) => {
        const connectionId = entry.connectionId || useSettingsStore().activeConnectionId
        if (!connectionId) {
          return
        }
        this.appendConnectionLog(connectionId, { ...entry, connectionId })
      })
      EventsOn('scan:progress', (payload: TaskProgress) => {
        const settingsStore = useSettingsStore()
        const connectionId = payload.connectionId || settingsStore.activeConnectionId
        if (!connectionId) {
          return
        }
        const message = progressMessage(payload)
        const tracker = {
          active: !payload.done,
          phase: payload.phase,
          current: payload.current,
          total: payload.total,
          message,
        }
        this.updateConnectionTracker(connectionId, 'scan', tracker)
        this.upsertProgressLog(connectionId, 'scan', payload, message)
      })
      EventsOn('maintain:progress', (payload: TaskProgress) => {
        const settingsStore = useSettingsStore()
        const connectionId = payload.connectionId || settingsStore.activeConnectionId
        if (!connectionId) {
          return
        }
        const message = progressMessage(payload)
        const tracker = {
          active: !payload.done,
          phase: payload.phase,
          current: payload.current,
          total: payload.total,
          message,
        }
        this.updateConnectionTracker(connectionId, 'maintain', tracker)
        this.upsertProgressLog(connectionId, 'maintain', payload, message)
      })
      EventsOn('inventory:progress', (payload: TaskProgress) => {
        const settingsStore = useSettingsStore()
        const connectionId = payload.connectionId || settingsStore.activeConnectionId
        if (!connectionId) {
          return
        }
        const message = progressMessage(payload)
        const tracker = {
          active: !payload.done,
          phase: payload.phase,
          current: payload.current,
          total: payload.total,
          message,
        }
        this.updateConnectionTracker(connectionId, 'inventory', tracker)
        this.upsertProgressLog(connectionId, 'inventory', payload, message)
      })
      EventsOn('quota:progress', (payload: TaskProgress) => {
        const settingsStore = useSettingsStore()
        const connectionId = payload.connectionId || settingsStore.activeConnectionId
        if (!connectionId) {
          return
        }
        const message = progressMessage(payload)
        const tracker = {
          active: !payload.done,
          phase: payload.phase,
          current: payload.current,
          total: payload.total,
          message,
        }
        this.updateConnectionTracker(connectionId, 'quota', tracker)
        this.upsertProgressLog(connectionId, 'quota', payload, message)
      })
      EventsOn('quota:snapshot', (snapshot: CodexQuotaSnapshot & { connectionId?: string }) => {
        if (scopedToConnection(snapshot.connectionId, useSettingsStore().activeConnectionId)) {
          useQuotasStore().applySnapshot(snapshot)
        }
      })
      EventsOn('task:finished', (payload: TaskFinished) => {
        const settingsStore = useSettingsStore()
        const connectionId = payload.connectionId || settingsStore.activeConnectionId
        if (!connectionId) {
          return
        }
        const state = this.ensureConnectionState(connectionId)
        if (payload.kind === 'scan') {
          state.scan = { ...state.scan, active: false }
        } else if (payload.kind === 'maintain') {
          state.maintain = { ...state.maintain, active: false }
        } else if (payload.kind === 'inventory') {
          state.inventory = { ...state.inventory, active: false }
        } else if (payload.kind === 'quota') {
          state.quota = { ...state.quota, active: false }
        }
        if (connectionId === this.activeConnectionId) {
          this.hydrateConnectionState(connectionId)
        }
        if (payload.kind !== 'quota' && connectionId === settingsStore.activeConnectionId) {
          this.scheduleAccountsRefresh()
        }
        if (state.inventoryQueued && !state.scan.active && !state.maintain.active && !state.inventory.active && !state.quota.active) {
          state.inventoryQueued = false
          if (connectionId === this.activeConnectionId) {
            this.inventoryQueued = false
            void this.runInventory().catch(() => {})
          }
        }
      })

      this.initialised = true
    },
    destroyEventBridge() {
      if (!this.initialised) {
        return
      }
      EventsOff('scan:log')
      EventsOff('maintain:log')
      EventsOff('inventory:log')
      EventsOff('quota:log')
      EventsOff('scan:progress')
      EventsOff('maintain:progress')
      EventsOff('inventory:progress')
      EventsOff('quota:progress')
      EventsOff('quota:snapshot')
      EventsOff('task:finished')
      this.initialised = false
    },
    clearTransientState(connectionId?: string) {
      if (connectionId) {
        this.connectionStates[connectionId] = emptyConnectionTaskState()
        if (connectionId === this.activeConnectionId) {
          this.hydrateConnectionState(connectionId)
        }
        this.refreshScheduled = false
        return
      }
      this.scan = emptyTracker()
      this.maintain = emptyTracker()
      this.inventory = emptyTracker()
      this.quota = emptyTracker()
      this.inventoryQueued = false
      this.logs = []
      this.connectionStates = {}
      this.refreshScheduled = false
    },
    scheduleAccountsRefresh() {
      if (this.refreshScheduled) {
        return
      }
      this.refreshScheduled = true
      window.setTimeout(() => {
        this.refreshScheduled = false
        void useAccountsStore().refreshAll()
      }, 120)
    },
    pushLog(entry: LogEntry) {
      const connectionId = entry.connectionId || this.activeConnectionId || useSettingsStore().activeConnectionId
      if (!connectionId) {
        return
      }
      this.appendConnectionLog(connectionId, { ...entry, connectionId })
    },
    upsertProgressLog(connectionId: string, kind: 'scan' | 'maintain' | 'inventory' | 'quota', payload: TaskProgress, message: string) {
      this.pushLog({
        id: progressEntryId(connectionId, kind),
        connectionId,
        kind,
        level: 'info',
        message,
        timestamp: new Date().toISOString(),
        progress: true,
      })
    },
    async runScan() {
      const settingsStore = useSettingsStore()
      const connectionId = settingsStore.activeConnectionId
      const message = i18n.global.t('tasks.queuedScan')
      const tracker = { ...emptyTracker(), active: true, phase: 'queued', message }
      if (connectionId) {
        this.updateConnectionTracker(connectionId, 'scan', tracker)
        this.upsertProgressLog(connectionId, 'scan', { connectionId, kind: 'scan', phase: 'queued', current: 0, total: 0, message, done: false }, message)
      } else {
        this.scan = tracker
      }
      try {
        return await api.runScan()
      } catch (error) {
        this.pushLog({
          connectionId,
          kind: 'scan',
          level: 'error',
          message: toErrorMessage(error),
          timestamp: new Date().toISOString(),
        })
        throw error
      } finally {
        if (connectionId) {
          const state = this.ensureConnectionState(connectionId)
          state.scan = { ...state.scan, active: false }
          if (connectionId === this.activeConnectionId) {
            this.scan = { ...state.scan }
          }
        } else {
          this.scan.active = false
        }
      }
    },
    async runMaintain(options: MaintainOptions) {
      const settingsStore = useSettingsStore()
      const connectionId = settingsStore.activeConnectionId
      const message = i18n.global.t('tasks.queuedMaintain')
      const tracker = { ...emptyTracker(), active: true, phase: 'queued', message }
      if (connectionId) {
        this.updateConnectionTracker(connectionId, 'maintain', tracker)
        this.upsertProgressLog(connectionId, 'maintain', { connectionId, kind: 'maintain', phase: 'queued', current: 0, total: 0, message, done: false }, message)
      } else {
        this.maintain = tracker
      }
      try {
        return await api.runMaintain(options)
      } catch (error) {
        this.pushLog({
          connectionId,
          kind: 'maintain',
          level: 'error',
          message: toErrorMessage(error),
          timestamp: new Date().toISOString(),
        })
        throw error
      } finally {
        if (connectionId) {
          const state = this.ensureConnectionState(connectionId)
          state.maintain = { ...state.maintain, active: false }
          if (connectionId === this.activeConnectionId) {
            this.maintain = { ...state.maintain }
          }
        } else {
          this.maintain.active = false
        }
      }
    },
    scheduleInventorySync() {
      const connectionId = useSettingsStore().activeConnectionId
      const state = connectionId ? this.ensureConnectionState(connectionId) : null
      const hasActiveTask = state
        ? state.scan.active || state.maintain.active || state.inventory.active || state.quota.active
        : this.scan.active || this.maintain.active || this.inventory.active || this.quota.active
      if (hasActiveTask) {
        if (state) {
          state.inventoryQueued = true
          if (connectionId === this.activeConnectionId) {
            this.inventoryQueued = true
          }
        } else {
          this.inventoryQueued = true
        }
        return 'queued' as const
      }
      if (state) {
        state.inventoryQueued = false
        if (connectionId === this.activeConnectionId) {
          this.inventoryQueued = false
        }
      } else {
        this.inventoryQueued = false
      }
      void this.runInventory().catch(() => {})
      return 'started' as const
    },
    async runInventory() {
      const accountsStore = useAccountsStore()
      const connectionId = useSettingsStore().activeConnectionId
      const message = i18n.global.t('tasks.queuedInventory')
      const tracker = { ...emptyTracker(), active: true, phase: 'queued', message }
      if (connectionId) {
        this.updateConnectionTracker(connectionId, 'inventory', tracker)
        this.upsertProgressLog(connectionId, 'inventory', { connectionId, kind: 'inventory', phase: 'queued', current: 0, total: 0, message, done: false }, message)
      } else {
        this.inventory = tracker
      }
      try {
        return await accountsStore.syncInventory()
      } catch (error) {
        this.pushLog({
          connectionId,
          kind: 'inventory',
          level: 'error',
          message: toErrorMessage(error),
          timestamp: new Date().toISOString(),
        })
        throw error
      } finally {
        if (connectionId) {
          const state = this.ensureConnectionState(connectionId)
          state.inventory = { ...state.inventory, active: false }
          if (connectionId === this.activeConnectionId) {
            this.inventory = { ...state.inventory }
          }
        } else {
          this.inventory.active = false
        }
      }
    },
    async cancelCurrentTask() {
      return await api.cancelScan()
    },
  },
})
