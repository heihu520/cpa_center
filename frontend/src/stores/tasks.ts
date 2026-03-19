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

interface TasksState {
  scan: TaskTracker
  maintain: TaskTracker
  inventory: TaskTracker
  quota: TaskTracker
  inventoryQueued: boolean
  logs: LogEntry[]
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

function progressEntryId(kind: 'scan' | 'maintain' | 'inventory' | 'quota'): string {
  return `${kind}:progress`
}

function progressMessage(payload: TaskProgress): string {
  const phase = taskPhaseLabel(payload.phase)
  if (payload.total > 0) {
    return payload.message ? `${phase} ${payload.current}/${payload.total} · ${payload.message}` : `${phase} ${payload.current}/${payload.total}`
  }
  return payload.message || phase
}

function scopedToActiveConnection(connectionId?: string) {
  return !connectionId || connectionId === useSettingsStore().activeConnectionId
}

export const useTasksStore = defineStore('tasksStore', {
  state: (): TasksState => ({
    scan: emptyTracker(),
    maintain: emptyTracker(),
    inventory: emptyTracker(),
    quota: emptyTracker(),
    inventoryQueued: false,
    logs: [],
    initialised: false,
    refreshScheduled: false,
  }),
  getters: {
    hasActiveTask: (state) => state.scan.active || state.maintain.active || state.inventory.active || state.quota.active,
  },
  actions: {
    initEventBridge() {
      if (this.initialised) {
        return
      }

      EventsOn('scan:log', (entry: LogEntry) => { if (scopedToActiveConnection(entry.connectionId)) this.pushLog(entry) })
      EventsOn('maintain:log', (entry: LogEntry) => { if (scopedToActiveConnection(entry.connectionId)) this.pushLog(entry) })
      EventsOn('inventory:log', (entry: LogEntry) => { if (scopedToActiveConnection(entry.connectionId)) this.pushLog(entry) })
      EventsOn('quota:log', (entry: LogEntry) => { if (scopedToActiveConnection(entry.connectionId)) this.pushLog(entry) })
      EventsOn('scan:progress', (payload: TaskProgress) => {
        if (!scopedToActiveConnection(payload.connectionId)) {
          return
        }
        const message = progressMessage(payload)
        this.scan = {
          active: !payload.done,
          phase: payload.phase,
          current: payload.current,
          total: payload.total,
          message,
        }
        this.upsertProgressLog('scan', payload, message)
      })
      EventsOn('maintain:progress', (payload: TaskProgress) => {
        if (!scopedToActiveConnection(payload.connectionId)) {
          return
        }
        const message = progressMessage(payload)
        this.maintain = {
          active: !payload.done,
          phase: payload.phase,
          current: payload.current,
          total: payload.total,
          message,
        }
        this.upsertProgressLog('maintain', payload, message)
      })
      EventsOn('inventory:progress', (payload: TaskProgress) => {
        if (!scopedToActiveConnection(payload.connectionId)) {
          return
        }
        const message = progressMessage(payload)
        this.inventory = {
          active: !payload.done,
          phase: payload.phase,
          current: payload.current,
          total: payload.total,
          message,
        }
        this.upsertProgressLog('inventory', payload, message)
      })
      EventsOn('quota:progress', (payload: TaskProgress) => {
        if (!scopedToActiveConnection(payload.connectionId)) {
          return
        }
        const message = progressMessage(payload)
        this.quota = {
          active: !payload.done,
          phase: payload.phase,
          current: payload.current,
          total: payload.total,
          message,
        }
        this.upsertProgressLog('quota', payload, message)
      })
      EventsOn('quota:snapshot', (snapshot: CodexQuotaSnapshot & { connectionId?: string }) => {
        if (scopedToActiveConnection(snapshot.connectionId)) {
          useQuotasStore().applySnapshot(snapshot)
        }
      })
      EventsOn('task:finished', (payload: TaskFinished) => {
        if (!scopedToActiveConnection(payload.connectionId)) {
          return
        }
        if (payload.kind === 'scan') {
          this.scan.active = false
        } else if (payload.kind === 'maintain') {
          this.maintain.active = false
        } else if (payload.kind === 'inventory') {
          this.inventory.active = false
        } else if (payload.kind === 'quota') {
          this.quota.active = false
        }
        if (payload.kind !== 'quota') {
          this.scheduleAccountsRefresh()
        }
        if (this.inventoryQueued && !this.scan.active && !this.maintain.active && !this.inventory.active && !this.quota.active) {
          this.inventoryQueued = false
          void this.runInventory().catch(() => {})
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
    clearTransientState() {
      this.scan = emptyTracker()
      this.maintain = emptyTracker()
      this.inventory = emptyTracker()
      this.quota = emptyTracker()
      this.inventoryQueued = false
      this.logs = []
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
      if (entry.id) {
        const existing = this.logs.findIndex((item) => item.id === entry.id)
        if (existing >= 0) {
          this.logs.splice(existing, 1)
        }
      }
      this.logs.unshift(entry)
      this.logs = this.logs.slice(0, 500)
    },
    upsertProgressLog(kind: 'scan' | 'maintain' | 'inventory' | 'quota', payload: TaskProgress, message: string) {
      this.pushLog({
        id: progressEntryId(kind),
        kind,
        level: 'info',
        message,
        timestamp: new Date().toISOString(),
        progress: true,
      })
    },
    async runScan() {
      const message = i18n.global.t('tasks.queuedScan')
      this.scan = { ...emptyTracker(), active: true, phase: 'queued', message }
      this.upsertProgressLog('scan', { kind: 'scan', phase: 'queued', current: 0, total: 0, message, done: false }, message)
      try {
        return await api.runScan()
      } catch (error) {
        this.pushLog({
          kind: 'scan',
          level: 'error',
          message: toErrorMessage(error),
          timestamp: new Date().toISOString(),
        })
        throw error
      } finally {
        this.scan.active = false
      }
    },
    async runMaintain(options: MaintainOptions) {
      const message = i18n.global.t('tasks.queuedMaintain')
      this.maintain = { ...emptyTracker(), active: true, phase: 'queued', message }
      this.upsertProgressLog('maintain', { kind: 'maintain', phase: 'queued', current: 0, total: 0, message, done: false }, message)
      try {
        return await api.runMaintain(options)
      } catch (error) {
        this.pushLog({
          kind: 'maintain',
          level: 'error',
          message: toErrorMessage(error),
          timestamp: new Date().toISOString(),
        })
        throw error
      } finally {
        this.maintain.active = false
      }
    },
    scheduleInventorySync() {
      if (this.scan.active || this.maintain.active || this.inventory.active || this.quota.active) {
        this.inventoryQueued = true
        return 'queued' as const
      }
      this.inventoryQueued = false
      void this.runInventory().catch(() => {})
      return 'started' as const
    },
    async runInventory() {
      const accountsStore = useAccountsStore()
      const message = i18n.global.t('tasks.queuedInventory')
      this.inventory = { ...emptyTracker(), active: true, phase: 'queued', message }
      this.upsertProgressLog('inventory', { kind: 'inventory', phase: 'queued', current: 0, total: 0, message, done: false }, message)
      try {
        return await accountsStore.syncInventory()
      } catch (error) {
        this.pushLog({
          kind: 'inventory',
          level: 'error',
          message: toErrorMessage(error),
          timestamp: new Date().toISOString(),
        })
        throw error
      } finally {
        this.inventory.active = false
      }
    },
    async cancelCurrentTask() {
      return await api.cancelScan()
    },
  },
})
