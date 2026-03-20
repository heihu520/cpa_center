import { defineStore } from 'pinia'
import { EventsOff, EventsOn } from '@/lib/web-runtime'
import { api } from '@/lib/web-api'
import { i18n, setI18nLocale } from '@/i18n'
import type { AppSettings, ConnectionResult, ConnectionsResponse, ConnectionSummary, CreateConnectionResponse, SchedulerStatus } from '@/types'
import { createDefaultScheduleSettings, createDefaultSettings, validateSettings } from '@/utils/settings'
import { toErrorMessage } from '@/utils/errors'
import { detectPreferredLocale, normalizeLocaleCode } from '@/utils/locale'
import { useTasksStore } from '@/stores/tasks'

interface SettingsState {
  settings: AppSettings
  connection: ConnectionResult | null
  connections: ConnectionSummary[]
  activeConnectionId: string
  schedulerStatus: SchedulerStatus
  loading: boolean
  saving: boolean
  errors: Record<string, string>
  schedulerBridgeReady: boolean
}

function createDefaultSchedulerStatus(): SchedulerStatus {
  return {
    enabled: false,
    mode: 'scan',
    cron: '',
    valid: true,
    validationMessage: '',
    running: false,
    nextRunAt: '',
    lastStartedAt: '',
    lastFinishedAt: '',
    lastStatus: '',
    lastMessage: '',
  }
}

export const useSettingsStore = defineStore('settingsStore', {
  state: (): SettingsState => ({
    settings: createDefaultSettings(),
    connection: null,
    connections: [],
    activeConnectionId: '',
    schedulerStatus: createDefaultSchedulerStatus(),
    loading: false,
    saving: false,
    errors: {},
    schedulerBridgeReady: false,
  }),
  getters: {
    connectionTone: (state) => {
      if (!state.connection) {
        return 'idle'
      }
      return state.connection.ok ? 'ok' : 'error'
    },
    currentLocale: (state) => normalizeLocaleCode(state.settings.locale || i18n.global.locale.value),
  },
  actions: {
    mergeSettings(result: Partial<AppSettings>) {
      const previousToken = this.settings.managementToken
      this.settings = {
        ...createDefaultSettings(),
        ...result,
        managementToken: result.managementToken && result.managementToken.trim()
          ? result.managementToken
          : previousToken,
        hasSavedManagementToken: Boolean(result.hasSavedManagementToken || previousToken),
        schedule: {
          ...createDefaultScheduleSettings(),
          ...(result.schedule ?? {}),
        },
      }
      this.applyLocale(this.settings.locale)
    },
    applyConnections(payload?: Partial<ConnectionsResponse> | null) {
      this.activeConnectionId = payload?.activeConnectionId ?? ''
      this.connections = Array.isArray(payload?.connections) ? payload.connections as ConnectionSummary[] : []
    },
    applySchedulerStatus(status?: Partial<SchedulerStatus> | null) {
      this.schedulerStatus = {
        ...createDefaultSchedulerStatus(),
        ...(status ?? {}),
      }
    },
    initSchedulerBridge() {
      if (this.schedulerBridgeReady) {
        return
      }
      EventsOn('scheduler:status', (status: SchedulerStatus) => this.applySchedulerStatus(status))
      this.schedulerBridgeReady = true
    },
    destroySchedulerBridge() {
      if (!this.schedulerBridgeReady) {
        return
      }
      EventsOff('scheduler:status')
      this.schedulerBridgeReady = false
    },
    async loadConnections() {
      const result = await api.getConnections()
      this.applyConnections(result)
      return this.connections
    },
    async switchConnection(connectionId: string) {
      const result = await api.setActiveConnection(connectionId)
      this.applyConnections(result)
      useTasksStore().switchActiveConnection(connectionId)
      await this.loadSettings()
      await this.verifyActiveConnection()
      return this.activeConnectionId
    },
    async verifyActiveConnection() {
      this.connection = await api.testConnection(this.settings)
      return this.connection
    },
    async createConnection(name: string, settings: AppSettings): Promise<CreateConnectionResponse> {
      const result = await api.createConnection(name, settings)
      this.applyConnections(result.connections)
      await this.loadSettings()
      this.connection = result.connectionResult
      return result
    },
    async renameConnection(connectionId: string, name: string) {
      const result = await api.renameConnection(connectionId, name)
      this.applyConnections(result)
      return this.connections
    },
    async deleteConnection(connectionId: string) {
      const result = await api.deleteConnection(connectionId)
      this.applyConnections(result)
      await this.loadSettings()
      return this.connections
    },
    applyLocale(locale?: string) {
      const next = setI18nLocale(locale || detectPreferredLocale())
      this.settings.locale = next
    },
    async loadSchedulerStatus() {
      const status = await api.getSchedulerStatus()
      this.applySchedulerStatus(status as unknown as Partial<SchedulerStatus>)
      return this.schedulerStatus
    },
    async persistSettings() {
      const saved = await api.saveSettings(this.settings)
      const submittedToken = this.settings.managementToken
      this.mergeSettings(saved as unknown as Partial<AppSettings>)
      if (submittedToken.trim()) {
        this.settings.managementToken = submittedToken
        this.settings.hasSavedManagementToken = true
      }
      await this.loadSchedulerStatus()
      return this.settings
    },
    async loadSettings() {
      this.loading = true
      try {
        await this.loadConnections()
        const result = await api.getSettings()
        this.mergeSettings(result as unknown as Partial<AppSettings>)
        if (this.activeConnectionId) {
          useTasksStore().switchActiveConnection(this.activeConnectionId)
        }
        await this.loadSchedulerStatus()
      } finally {
        this.loading = false
      }
    },
    async saveLocalePreference(locale: string) {
      const previous = this.currentLocale
      this.applyLocale(locale)
      try {
        await this.persistSettings()
      } catch (error) {
        this.applyLocale(previous)
        throw new Error(toErrorMessage(error))
      }
    },
    async saveLayoutModePreference(layoutMode: AppSettings['layoutMode']) {
      const previous = this.settings.layoutMode
      this.settings.layoutMode = layoutMode
      try {
        await this.persistSettings()
      } catch (error) {
        this.settings.layoutMode = previous
        throw new Error(toErrorMessage(error))
      }
    },
    async testConnectionWithSettings(input: AppSettings) {
      const errors = validateSettings(input, i18n.global.t)
      if (Object.keys(errors).length > 0) {
        throw new Error(i18n.global.t('validation.fixBeforeTesting'))
      }
      return await api.testConnection(input)
    },
    async testConnection() {
      this.errors = validateSettings(this.settings, i18n.global.t)
      if (Object.keys(this.errors).length > 0) {
        throw new Error(i18n.global.t('validation.fixBeforeTesting'))
      }
      this.connection = await api.testConnection(this.settings)
      return this.connection
    },
    async saveSettings() {
      this.errors = validateSettings(this.settings, i18n.global.t)
      if (Object.keys(this.errors).length > 0) {
        throw new Error(i18n.global.t('validation.fixBeforeSaving'))
      }
      this.saving = true
      try {
        return await this.persistSettings()
      } finally {
        this.saving = false
      }
    },
    async testAndSave() {
      try {
        this.errors = validateSettings(this.settings, i18n.global.t)
        if (Object.keys(this.errors).length > 0) {
          throw new Error(i18n.global.t('validation.fixBeforeSaving'))
        }
        this.saving = true
        const connection = await api.testAndSaveSettings(this.settings)
        const submittedToken = this.settings.managementToken
        await this.loadSettings()
        if (submittedToken.trim()) {
          this.settings.managementToken = submittedToken
          this.settings.hasSavedManagementToken = true
        }
        this.connection = connection
        return connection
      } catch (error) {
        throw new Error(toErrorMessage(error))
      } finally {
        this.saving = false
      }
    },
  },
})
