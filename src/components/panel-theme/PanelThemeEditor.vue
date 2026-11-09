<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import { te, type ThemeEditorKey } from '@/utils/theme-editor-i18n'
import Button from '@/components/ui/Button.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Select from '@/components/ui/Select.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import PanelThemeColorField, { type ColorFieldIssue } from '@/components/panel-theme/PanelThemeColorField.vue'
import PanelThemeEditorPreview from '@/components/panel-theme/PanelThemeEditorPreview.vue'
import PanelThemeEditorBackground from '@/components/panel-theme/PanelThemeEditorBackground.vue'
import PanelThemeEditorShape from '@/components/panel-theme/PanelThemeEditorShape.vue'
import { resolvedTheme } from '@/composables/useTheme'
import { panelThemeMedia, panelThemeState, refreshPanelThemeState } from '@/composables/usePanelTheme'
import { usePanelThemeActions } from '@/composables/usePanelThemeActions'
import { refreshUserPanelThemes, userPanelThemes, useUserThemeActions, type PanelThemeEditorRequest } from '@/composables/useMyPanelThemes'
import {
  applyFix,
  canSave,
  colorToHex,
  commitChange,
  createDraft,
  definitionFromCatalog,
  definitionKey,
  fixFor,
  hasUnsavedChanges,
  isDirty,
  issuesByPath,
  markSaved,
  parseColorInput,
  previewEntry,
  resetDraft,
  undoChange,
  type EditorDraft,
} from '@/utils/panel-theme-editor'
import { describeIssue } from '@/utils/panel-theme-issue-text'
import { extractDominantColors, paletteFromSeed, sampleSize, seedFromClusters } from '@/utils/panel-theme-palette'
import { builtinPanelThemeProperties, parsePanelThemeColor } from '@/utils/panel-theme-host'
import { PANEL_THEME_MODES, type PanelThemeMode } from '@/types/panel-theme'
import { isPanelThemeAssetUrl } from '@/utils/panel-theme-css'
import {
  USER_PANEL_THEME_COLOR_GROUPS,
  USER_PANEL_THEME_COLOR_KEYS,
  USER_PANEL_THEME_NAME_MAX,
  USER_PANEL_THEME_OWNER,
  USER_PANEL_THEME_PET_STATUS_KEYS,
  type PanelThemeValidateIpcResult,
  type PanelThemeValidation,
  type UserPanelThemeDefinition,
  type UserPanelThemePetStatusKey,
} from '@/types/panel-theme-user'
import type { PluginPanelThemeColorKey } from '@/types/plugin'

// 主機繪製的主題編輯器（spec R24）。沒有任何插件程式碼：草稿是一份資料結構，預覽以與面板
// 相同的已驗證屬性畫出，驗證在主程序（debounce 150 ms，以內容雜湊快取）。存檔與套用只在
// 「目前的草稿已驗證且全部通過」時可用；關閉前若有未存變更會先確認。

const props = defineProps<{ request: PanelThemeEditorRequest }>()
const emit = defineEmits<{ close: [] }>()

const VALIDATE_DEBOUNCE_MS = 150
const MODE_NAME: Record<PanelThemeMode, TranslationKey> = { light: 'design.panelTheme.modeLight', dark: 'design.panelTheme.modeDark' }
const MODE_SHORT: Record<PanelThemeMode, TranslationKey> = { light: 'design.panelTheme.modeShortLight', dark: 'design.panelTheme.modeShortDark' }
const GROUP_LABEL: Record<string, ThemeEditorKey> = {
  text: 'themeEditor.group.text',
  surfaces: 'themeEditor.group.surfaces',
  accent: 'themeEditor.group.accent',
  borders: 'themeEditor.group.borders',
  status: 'themeEditor.group.status',
  effects: 'themeEditor.group.effects',
}
/** 灰色種子：「空白」起點是中性灰的完整色盤。 */
const NEUTRAL_SEED = { r: 128, g: 128, b: 128, a: 1 }

const themeActions = usePanelThemeActions()
const userActions = useUserThemeActions()
const busy = computed(() => themeActions.busy.value || userActions.busy.value || generating.value)

// --- 草稿 ------------------------------------------------------------------
function initialDraft(): EditorDraft {
  const record = props.request.id ? userPanelThemes.value.find(theme => theme.id === props.request.id) : undefined
  if (record) return createDraft(record.id, record.name, record.definition)
  const from = props.request.from
  const entry = from ? panelThemeState.value?.themes.find(theme => theme.ref.pluginId === from.pluginId && theme.ref.themeId === from.themeId) : undefined
  if (entry) return createDraft(null, entry.displayName[locale.value].slice(0, USER_PANEL_THEME_NAME_MAX), definitionFromCatalog({ builtin: builtinPalettes() }, entry))
  return createDraft(null, te('themeEditor.defaultName'), definitionFromCatalog({ builtin: builtinPalettes() }, null))
}

/** 目錄還沒載入時（例如面板剛重新載入）用主機的內建色盤。 */
function builtinPalettes() {
  return panelThemeState.value?.builtin ?? { light: builtinPanelThemeProperties('light'), dark: builtinPanelThemeProperties('dark') }
}

const draft = shallowRef<EditorDraft>(initialDraft())
const name = ref(draft.value.name)
const mode = ref<PanelThemeMode>(resolvedTheme.value)
const status = ref('')
const generating = ref(false)
const confirmingDiscard = ref(false)
// 種子色從草稿目前的淺色強調色開始，產生的色盤與現況最接近。
const seed = ref(colorToHex(draft.value.definition.modes.light.colors.accent))
const startChoice = ref('')

watch(name, value => { draft.value = { ...draft.value, name: value } })

function change(mutate: (definition: UserPanelThemeDefinition) => void): void {
  const next = structuredClone(draft.value.definition)
  mutate(next)
  draft.value = commitChange(draft.value, next)
}

const currentKey = computed(() => definitionKey(draft.value.definition))
const nameValid = computed(() => {
  const length = name.value.trim().length
  return length > 0 && length <= USER_PANEL_THEME_NAME_MAX
})

// --- 驗證（debounce）---------------------------------------------------------
const validation = shallowRef<PanelThemeValidation | null>(null)
const validatedKey = ref('')
/** 目前草稿的驗證請求失敗（IPC 拒絕或回傳 ok:false）；顯示錯誤與「重試」，而不是一直「檢查中」。 */
const validationFailed = ref(false)
let validateTimer: ReturnType<typeof setTimeout> | undefined
/** 每次排程遞增；回應回來時序號不是最新的就丟掉（較舊草稿的回應可能比新的晚到）。 */
let validateSeq = 0

async function runValidation(seq: number): Promise<void> {
  const key = currentKey.value
  let result: PanelThemeValidateIpcResult | undefined
  try {
    result = await window.electronAPI?.validatePanelTheme(structuredClone(draft.value.definition))
  } catch {
    result = undefined
  }
  if (seq !== validateSeq || key !== currentKey.value) return
  if (!result?.ok) {
    validationFailed.value = true
    return
  }
  validation.value = result.value
  validatedKey.value = key
}

function scheduleValidation(): void {
  clearTimeout(validateTimer)
  validateSeq += 1
  validationFailed.value = false
  const seq = validateSeq
  validateTimer = setTimeout(() => { void runValidation(seq) }, VALIDATE_DEBOUNCE_MS)
}

watch(currentKey, scheduleValidation, { immediate: true })

const validationCurrent = computed(() => validatedKey.value === currentKey.value)
const saveEnabled = computed(() => canSave({ validationCurrent: validationCurrent.value, validation: validation.value, busy: busy.value, nameValid: nameValid.value }))
const modeIssues = computed(() => issuesByPath(validationCurrent.value ? validation.value : null, mode.value))

const summary = computed(() => {
  if (validationFailed.value) return te('themeEditor.checkFailed')
  if (!validationCurrent.value || !validation.value) return te('themeEditor.checking')
  if (validation.value.schemaError) return te('themeEditor.schemaError', { path: validation.value.schemaError.path })
  if (validation.value.valid) return te('themeEditor.allPass')
  return PANEL_THEME_MODES
    .map(candidate => ({ candidate, count: validation.value!.issues.filter(issue => issue.mode === candidate).length }))
    .filter(row => row.count > 0)
    .map(row => te('themeEditor.issueSummary', { count: row.count, mode: t(MODE_NAME[row.candidate]) }))
    .join(' · ')
})

function keyLabel(key: string): string {
  return te(`themeEditor.key.${key}` as ThemeEditorKey)
}

/** 驗證器的顏色鍵名換成介面名稱；不是顏色鍵（合成的表面）時回傳 null。 */
function knownKeyLabel(key: string): string | null {
  if ((USER_PANEL_THEME_COLOR_KEYS as readonly string[]).includes(key)) return keyLabel(key)
  return null
}

const translateIssue = (key: string, params?: Record<string, string | number>) => te(key as ThemeEditorKey, params)

function fieldIssues(path: string, label: string): ColorFieldIssue[] {
  return (modeIssues.value.get(path) ?? []).map(issue => {
    const fix = fixFor(issue, validation.value)
    return {
      text: describeIssue(issue, knownKeyLabel, translateIssue),
      fix: fix ? { ...fix, label: te('themeEditor.useSuggestedLabel', { value: String(fix.value), key: label }) } : null,
    }
  })
}

function applySuggested(path: string, value: string | number): void {
  draft.value = commitChange(draft.value, applyFix(draft.value.definition, mode.value, path, value))
}

// --- 顏色 ------------------------------------------------------------------
const modeDefinition = computed(() => draft.value.definition.modes[mode.value])

function setColor(key: PluginPanelThemeColorKey, value: string): void {
  change(definition => { definition.modes[mode.value].colors[key] = value })
}

function setPetColor(key: UserPanelThemePetStatusKey, value: string): void {
  change(definition => {
    const status = definition.modes[mode.value].petStatus
    if (status) status[key] = value
  })
}

/** 開啟自訂膠囊時以目前色盤為起點（與寵物視窗由色盤衍生的膠囊一致）。 */
function togglePetStatus(enabled: boolean): void {
  change(definition => {
    const target = definition.modes[mode.value]
    if (!enabled) {
      target.petStatus = null
      return
    }
    const colors = target.colors
    const surface = parsePanelThemeColor(colors.surface)
    const text = parsePanelThemeColor(colors.text)
    const translucent = (value: typeof surface, alpha: number) => (value.ok ? `rgb(${value.color.r} ${value.color.g} ${value.color.b} / ${alpha})` : colors.surface)
    target.petStatus = {
      background: translucent(surface, 0.92),
      text: colors.text,
      textMuted: colors.textSecondary,
      border: translucent(text, 0.18),
      quotaFill: colors.sageDeep,
      quotaTrack: translucent(text, 0.18),
      quotaWarn: colors.warnText,
    }
  })
}

// --- 起點與產生器 --------------------------------------------------------------
const startOptions = computed(() => {
  const options = [
    { value: 'blank', label: te('themeEditor.startBlank') },
    { value: 'builtin', label: te('themeEditor.startBuiltin') },
  ]
  for (const entry of panelThemeState.value?.themes ?? []) {
    if (entry.ref.pluginId === USER_PANEL_THEME_OWNER) continue
    options.push({ value: `plugin:${entry.ref.pluginId}/${entry.ref.themeId}`, label: te('themeEditor.startPlugin', { theme: entry.displayName[locale.value], plugin: entry.pluginName[locale.value] }) })
  }
  for (const record of userPanelThemes.value) {
    if (record.id === draft.value.id) continue
    options.push({ value: `mine:${record.id}`, label: t('design.themeEditor.ownedLabel', { name: record.name }) })
  }
  return options
})

const START_HANDLERS: Record<string, (rest: string) => UserPanelThemeDefinition | null> = {
  blank: () => paletteFromSeed(NEUTRAL_SEED, draft.value.definition).definition,
  builtin: () => definitionFromCatalog({ builtin: builtinPalettes() }, null),
  plugin: rest => {
    const entry = panelThemeState.value?.themes.find(theme => `${theme.ref.pluginId}/${theme.ref.themeId}` === rest)
    return entry && panelThemeState.value ? definitionFromCatalog(panelThemeState.value, entry) : null
  },
  mine: rest => structuredClone(userPanelThemes.value.find(record => record.id === rest)?.definition ?? null),
}

function startFrom(choice: string): void {
  const separator = choice.indexOf(':')
  const kind = separator < 0 ? choice : choice.slice(0, separator)
  const next = START_HANDLERS[kind]?.(separator < 0 ? '' : choice.slice(separator + 1))
  if (next) draft.value = commitChange(draft.value, next)
  startChoice.value = ''
}

watch(startChoice, choice => { if (choice) startFrom(choice) })

function generateFromSeed(): void {
  const color = parseColorInput(seed.value)
  const parsed = color ? parsePanelThemeColor(color) : null
  if (!parsed?.ok) return
  draft.value = commitChange(draft.value, paletteFromSeed(parsed.color, draft.value.definition).definition)
  status.value = te('themeEditor.generated')
}

const savedEntry = computed(() => (draft.value.id
  ? panelThemeState.value?.themes.find(theme => theme.ref.pluginId === USER_PANEL_THEME_OWNER && theme.ref.themeId === draft.value.id) ?? null
  : null))
const currentImageUrl = computed(() => savedEntry.value?.modes[mode.value]?.userImage?.current?.url ?? null)

/** 以 crossOrigin 載入（主機只對面板來源回 CORS），縮到 ≤ 128 px 後在記憶體中取色。 */
async function readImagePixels(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  if (!isPanelThemeAssetUrl(url)) return null
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.decoding = 'async'
  image.src = url
  await image.decode()
  const size = sampleSize(image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, size.width, size.height)
  return { data: context.getImageData(0, 0, size.width, size.height).data, width: size.width, height: size.height }
}

async function generateFromImage(): Promise<void> {
  const url = currentImageUrl.value
  if (!url || generating.value) return
  generating.value = true
  try {
    const pixels = await readImagePixels(url)
    const picked = pixels ? seedFromClusters(extractDominantColors(pixels.data, pixels.width, pixels.height)) : null
    if (!picked) {
      status.value = te('themeEditor.generateFailed')
      return
    }
    draft.value = commitChange(draft.value, paletteFromSeed(picked.seed, draft.value.definition, { neutralHue: picked.neutralHue }).definition)
    status.value = te('themeEditor.generated')
  } catch {
    status.value = te('themeEditor.generateFailed')
  } finally {
    generating.value = false
  }
}

// --- 存檔、套用、圖片、匯出 ----------------------------------------------------
async function save(): Promise<string | null> {
  if (!saveEnabled.value) {
    status.value = te('themeEditor.fixFirst')
    return null
  }
  // 送出的快照。IPC 往返期間輸入框沒有停用，使用者可能繼續修改；存檔完成後只移動基準，
  // 不覆寫目前的內容與名稱，那些新的修改仍算未儲存（markSaved）。
  const typedName = name.value
  const saved = { name: typedName.trim(), definition: structuredClone(draft.value.definition) }
  const id = draft.value.id
  // 既有主題：名稱與內容由主程序一次寫入（同一個 IPC），不會出現只改了名稱、內容卻存失敗的半套狀態。
  const result = id === null
    ? await userActions.run(() => window.electronAPI?.createUserPanelTheme(saved.name, saved.definition), t('design.themeEditor.saved'))
    : await userActions.run(() => window.electronAPI?.updateUserPanelTheme(id, saved.definition, saved.name !== draft.value.baseline.name ? saved.name : undefined), t('design.themeEditor.saved'))
  if (!result?.ok) return null
  const savedId = result.value.id ?? id
  if (!savedId) return null
  draft.value = markSaved(draft.value, savedId, saved)
  // 只有在往返期間沒有再改名稱時，才把輸入框換成去空白後的名稱。
  if (name.value === typedName) name.value = saved.name
  status.value = t('design.themeEditor.saved')
  return savedId
}

/** 存好（需要時）再取得目錄裡的參照；套用與匯入圖片都需要主題已存在於主程序。 */
async function ensureSaved(): Promise<string | null> {
  if (draft.value.id && !isDirty(draft.value)) return draft.value.id
  return save()
}

async function apply(modes: readonly PanelThemeMode[]): Promise<void> {
  const id = await ensureSaved()
  if (id) await themeActions.applyTheme({ pluginId: USER_PANEL_THEME_OWNER, themeId: id }, modes)
}

/** 套用前會先存檔，所以未存的草稿也要通過驗證才能套用。 */
const applyEnabled = computed(() => !busy.value && (saveEnabled.value || (draft.value.id !== null && !isDirty(draft.value))))
const APPLY_BUTTONS: ReadonlyArray<{ id: string; label: TranslationKey; modes: readonly PanelThemeMode[] }> = [
  { id: 'light', label: 'design.panelTheme.useLight', modes: ['light'] },
  { id: 'dark', label: 'design.panelTheme.useDark', modes: ['dark'] },
  { id: 'both', label: 'design.panelTheme.useForBoth', modes: PANEL_THEME_MODES },
]

async function chooseImage(): Promise<void> {
  status.value = te('themeEditor.imageSaveFirst')
  const id = await ensureSaved()
  // 匯入結果（成功或錯誤）由 themeActions 的狀態與錯誤文字呈現。
  if (id && await themeActions.importImage({ pluginId: USER_PANEL_THEME_OWNER, themeId: id }, mode.value)) status.value = ''
}

function exportTheme(): void {
  const id = draft.value.id
  if (id && !isDirty(draft.value)) void userActions.run(() => window.electronAPI?.exportUserPanelTheme(id), t('design.themeEditor.exported'))
}

// --- 復原、重設、關閉 -----------------------------------------------------------
function undo(): void {
  draft.value = undoChange(draft.value)
}

function reset(): void {
  draft.value = resetDraft(draft.value)
  name.value = draft.value.baseline.name
}

function requestClose(): void {
  if (hasUnsavedChanges(draft.value)) confirmingDiscard.value = true
  else emit('close')
}

function discard(): void {
  confirmingDiscard.value = false
  emit('close')
}

const modeOptions = computed(() => PANEL_THEME_MODES.map(value => ({ value, label: t(MODE_SHORT[value]) })))
// 兩個模式的預覽共用同一個目錄項目（previewEntry 本身就含兩個模式），只算一次。
const previewCatalogEntry = computed(() => previewEntry(draft.value.definition, name.value, savedEntry.value))
const previews = computed(() => PANEL_THEME_MODES.map(value => ({
  mode: value,
  label: te('themeEditor.previewLabel', { mode: t(MODE_NAME[value]) }),
})))
// --- 預覽區：可收合；固定在頂端時把它的高度交給 scroll-padding-top ---------------
const previewOpen = ref(true)
const previewsRef = ref<HTMLElement | null>(null)
const stickyHeight = ref(0)
const editorStyle = computed(() => ({ '--editor-sticky-height': `${stickyHeight.value}px` }))
let previewsObserver: ResizeObserver | null = null

/** 窄版（容器查詢）時預覽不固定，捲動時不會擋住任何東西。 */
function measureSticky(): void {
  const element = previewsRef.value
  stickyHeight.value = element && previewOpen.value && getComputedStyle(element).position === 'sticky' ? Math.ceil(element.getBoundingClientRect().height) : 0
}

const errorText = computed(() => userActions.error.value || themeActions.error.value)
const liveStatus = computed(() => status.value || themeActions.status.value || userActions.status.value)

watch(previewOpen, measureSticky, { flush: 'post' })

onMounted(async () => {
  previewsObserver = new ResizeObserver(measureSticky)
  if (previewsRef.value) previewsObserver.observe(previewsRef.value)
  await Promise.all([refreshUserPanelThemes(), refreshPanelThemeState()])
  // 清單在開啟後才載入完成：要編輯的主題那時才找得到。
  if (props.request.id && draft.value.id !== props.request.id) {
    draft.value = initialDraft()
    name.value = draft.value.name
  }
})

onBeforeUnmount(() => {
  previewsObserver?.disconnect()
  clearTimeout(validateTimer)
  // 讓卸載後才回來的驗證回應被丟掉。
  validateSeq += 1
})
</script>

<template>
  <Dialog :open="true" :title="te('themeEditor.title')" size="full" show-close :dismiss-on-scrim="false" initial-focus="[data-editor-name] input" @close="requestClose">
    <div class="editor" :style="editorStyle" data-testid="panel-theme-editor">
      <div class="editor-top">
        <div class="editor-name" data-editor-name>
          <Input v-model="name" :label="t('design.themeEditor.nameLabel')" :error="nameValid ? '' : t('design.themeEditor.invalidName')" :maxlength="USER_PANEL_THEME_NAME_MAX" data-testid="editor-name" />
        </div>
        <label class="editor-field">
          <span class="editor-field-label">{{ te('themeEditor.startFrom') }}</span>
          <Select v-model="startChoice" :aria-label="te('themeEditor.startFrom')" data-testid="editor-start">
            <option value="" disabled>{{ te('themeEditor.startFrom') }}</option>
            <option v-for="option in startOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </Select>
          <span class="editor-help">{{ te('themeEditor.startHelp') }}</span>
        </label>
      </div>

      <section v-show="previewOpen" id="editor-previews" ref="previewsRef" class="editor-previews" :aria-label="te('themeEditor.preview')" data-testid="editor-previews">
        <PanelThemeEditorPreview v-for="preview in previews" :key="preview.mode" :entry="previewCatalogEntry" :mode="preview.mode" :label="preview.label" :forced-colors="panelThemeMedia.forcedColors" />
      </section>

      <div class="editor-mode">
        <div class="editor-mode-actions">
          <SegmentedControl :model-value="mode" :options="modeOptions" semantics="radio" :ariaLabel="te('themeEditor.modeLabel')" id-prefix="editor-mode-" @update:model-value="value => { mode = value as PanelThemeMode }" />
          <Button size="sm" variant="ghost" aria-controls="editor-previews" :aria-expanded="previewOpen" data-testid="editor-preview-toggle" @click="previewOpen = !previewOpen">{{ te(previewOpen ? 'themeEditor.previewHide' : 'themeEditor.previewShow') }}</Button>
        </div>
        <div class="editor-summary-row">
          <p class="editor-summary" :class="{ ok: !validationFailed && validationCurrent && validation?.valid }" role="status" data-testid="editor-summary">{{ summary }}</p>
          <Button v-if="validationFailed" size="sm" variant="secondary" data-testid="editor-validate-retry" @click="scheduleValidation">{{ te('themeEditor.checkRetry') }}</Button>
        </div>
      </div>

      <section class="editor-section" aria-labelledby="editor-generate-title">
        <h3 id="editor-generate-title" class="editor-section-title">{{ te('themeEditor.generateTitle') }}</h3>
        <p class="editor-help">{{ te('themeEditor.generateHelp') }}</p>
        <div class="editor-generate">
          <input v-model="seed" class="editor-seed" type="color" :aria-label="te('themeEditor.seedLabel')" data-testid="editor-seed" />
          <Button size="sm" variant="secondary" :disabled="busy" data-testid="editor-generate-seed" @click="generateFromSeed">{{ te('themeEditor.generateFromSeed') }}</Button>
          <Button size="sm" variant="secondary" :disabled="busy || !currentImageUrl" data-testid="editor-generate-image" @click="generateFromImage">{{ te('themeEditor.generateFromImage') }}</Button>
        </div>
        <p v-if="!currentImageUrl" class="editor-help">{{ te('themeEditor.generateNeedsImage') }}</p>
      </section>

      <section class="editor-section" aria-labelledby="editor-colours-title">
        <h3 id="editor-colours-title" class="editor-section-title">{{ te('themeEditor.colours') }}</h3>
        <fieldset v-for="group in USER_PANEL_THEME_COLOR_GROUPS" :key="group.id" class="editor-group">
          <legend class="editor-group-title">{{ te(GROUP_LABEL[group.id]!) }}</legend>
          <PanelThemeColorField
            v-for="key in group.keys"
            :key="`${mode}-${key}`"
            :label="keyLabel(key)"
            :usage="te(`themeEditor.usage.${key}` as ThemeEditorKey)"
            :value="modeDefinition.colors[key]"
            :issues="fieldIssues(`colors.${key}`, keyLabel(key))"
            :test-id="key"
            @update="value => setColor(key, value)"
            @fix="applySuggested"
          />
        </fieldset>
        <fieldset class="editor-group">
          <legend class="editor-group-title">{{ te('themeEditor.group.petStatus') }}</legend>
          <ToggleRow :model-value="modeDefinition.petStatus !== null" :label="te('themeEditor.petStatusToggle')" :help="te('themeEditor.petStatusHelp')" @update:model-value="togglePetStatus" />
          <template v-if="modeDefinition.petStatus">
            <PanelThemeColorField
              v-for="key in USER_PANEL_THEME_PET_STATUS_KEYS"
              :key="`${mode}-pet-${key}`"
              :label="te(`themeEditor.petKey.${key}` as ThemeEditorKey)"
              :usage="te(`themeEditor.petUsage.${key}` as ThemeEditorKey)"
              :value="modeDefinition.petStatus[key]"
              :issues="fieldIssues(`petStatus.${key}`, te(`themeEditor.petKey.${key}` as ThemeEditorKey))"
              :test-id="`pet-${key}`"
              @update="value => setPetColor(key, value)"
              @fix="applySuggested"
            />
          </template>
        </fieldset>
      </section>

      <PanelThemeEditorBackground
        :mode="mode"
        :definition="modeDefinition"
        :issues="fieldIssues('userImage.overlay.opacity', te('themeEditor.defaultDim'))"
        :min-dim="validationCurrent ? validation?.minDim[mode] ?? null : null"
        :saved-entry="savedEntry"
        :busy="busy"
        @change="next => change(definition => { definition.modes[mode] = next })"
        @fix="applySuggested"
        @choose-image="chooseImage"
      />

      <PanelThemeEditorShape :definition="draft.definition" @change="next => change(definition => { definition.typography = next.typography; definition.shape = next.shape })" />

      <p class="editor-live" role="status" data-testid="editor-status">{{ liveStatus }}</p>
      <p v-if="errorText" class="editor-error" role="alert">{{ errorText }}</p>
    </div>

    <template #footer>
      <div class="editor-footer">
        <div class="editor-footer-row">
          <Button size="sm" variant="ghost" :disabled="draft.undo.length === 0" data-testid="editor-undo" @click="undo">{{ te('themeEditor.undo') }}</Button>
          <Button size="sm" variant="ghost" data-testid="editor-reset" @click="reset">{{ te('themeEditor.reset') }}</Button>
          <Button v-if="draft.id" size="sm" variant="ghost" :disabled="busy || isDirty(draft)" data-testid="editor-export" @click="exportTheme">{{ t('design.themeEditor.export') }}</Button>
          <span class="editor-footer-spacer" />
          <Button size="sm" variant="primary" :disabled="!saveEnabled || !isDirty(draft)" data-testid="editor-save" @click="save">{{ t('design.themeEditor.save') }}</Button>
        </div>
        <div class="editor-footer-row" role="group" :aria-label="te('themeEditor.applyMenu')">
          <Button v-for="button in APPLY_BUTTONS" :key="button.id" size="sm" variant="secondary" :disabled="!applyEnabled" :data-testid="`editor-apply-${button.id}`" @click="apply(button.modes)">{{ t(button.label) }}</Button>
        </div>
      </div>
    </template>

    <template #overlay>
      <ConfirmDialog
        :open="confirmingDiscard"
        tone="danger"
        focus-cancel
        :title="te('themeEditor.discardTitle')"
        :message="te('themeEditor.discardBody')"
        :confirm-label="te('themeEditor.discard')"
        :cancel-label="te('themeEditor.keepEditing')"
        @confirm="discard"
        @cancel="confirmingDiscard = false"
      />
    </template>
  </Dialog>
</template>

<style scoped src="@/components/panel-theme/PanelThemeEditorSections.css"></style>
<style scoped src="@/components/panel-theme/PanelThemeEditor.css"></style>
