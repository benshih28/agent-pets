# 哪些 GitHub 專案值得 Agent Pets 借鑑？

研究日期為 2026-11-18，比對基準為本機 Agent Pets 1.14.4。以下的「上游做法」來自維護者文件、格式規格或原始碼。「試作」與優先順序是對 Agent Pets 的產品判斷。研究未安裝這些專案，也沒有在 Windows 或 macOS 實測其效果。

## 首選：讓寵物的動作說明 Agent 正在做什麼

工作姿態與子代理跟班的分期、畫面規則、父子事件歸屬、相容性與驗收案例已整理為[獨立設計提案](./Work-Postures-and-Subagent-Companions.zh-TW.md)。

使用者看見「工作中」時，往往還想知道 Agent 正在讀資料、改檔案，還是跑驗證。**thgoas/ai-pet** 分別用翻文件、打字與看執行紀錄三個桌面場景表達，另用小企鵝呈現子代理，最多顯示三隻，超出的以數字收合。前一個做法很適合 Agent Pets 現有資料，後一個則需要額外證據才能正確呈現。[上游的活動與子代理示例](https://github.com/thgoas/ai-pet#what-the-assistants-up-to)

| 可試作的功能 | Agent Pets 已經有什麼 | 新增價值與驗證方式 |
| --- | --- | --- |
| 讀取、編輯、執行三種工作姿態 | 工作階段已有選填的工具名稱，動作規劃目前以 Agent 狀態決定播放順序 | 僅將語意明確的工具對映到姿態。例如讀檔用文件、改檔用筆、執行程序用終端圖示。通用 shell 只表示執行；已知測試工具才顯示測試。沿用原圖集，先用可拆的道具或固定圖示驗證辨識度，未知工具回到一般工作姿態。 |
| 子代理跟班 | 多寵物目前按 Codex、Claude、OpenCode 家族分組。同一家族可以同時跑多個彼此無關的工作階段 | 先用有父子識別與結束事件的單一 adapter 驗證。重播兩個獨立工作階段與一個有子代理的工作階段，只有後者出現跟班。還要測重送、亂序與中途結束。 |
| 手機上的唯讀寵物 | 桌面已有完成標記、勿擾、工作階段狀態 | **ttokttok-pet** 由電腦監看，手機配對後顯示狀態，支援完成推播。適合常離桌等長任務的人。試作只傳「執行中／需你處理／完成」與更新時間，先驗證撤銷配對與過期狀態。網路與裝置授權讓這項成本高於桌面動作。[上游手機配對與運作條件](https://github.com/hyukjunlim/ttokttok-pet#phone) |

目前的動作規劃已會安排閒置揮手、工作動作輪替及等待時的動作，圖集也有 v1、v2 與自訂列。工作姿態可先限定在工具執行中，權限與錯誤沿用原本顯示。可用同一段事件錄製「現況」與「三種工作姿態」兩個版本，在一般、Mini、減少動態與無自訂素材四種設定下，比較辨識正確率、辨識時間，以及是否錯過等待提示。[事件正規化](../../electron/event-normalizer.ts) · [動作規劃](../../src/utils/pet-motion-plan.ts) · [圖集定義](../../src/types/pet-atlas.ts)

## 桌面行為與養成

| 專案 | 上游做法 | Agent Pets 的試作與取捨 |
| --- | --- | --- |
| DeskPet | Friendly、Focused、Playful 三種性格，會改變走動與游標互動。它也讀取與 Agent Pets 同系列的精靈圖包，但會將失敗列用於睡覺。[性格與圖集語意](https://github.com/ikentrock/deskpet#personalities) | 讓使用者為每隻寵物選「安靜」或「好動」，沿用 Shimeji 的低頻排程與省電條件。用同一份圖包驗證兩種性格，並確認工作狀態與睡覺仍使用各自的動作。成本低。 |
| Shimeji-Desktop | 創作者透過 XML 描述動作與行為，角色圖片可獨立替換。[專案說明](https://github.com/DalekCraft2/Shimeji-Desktop#shimeji-ee-shimeji-english-enhanced) | 用現有 `behaviorManifest` 製作可下載的作者範例，示範同一張圖用不同的動作列、格數與逐格停留時間呈現兩種性格。跨動作播放順序由 Agent Pets 的動作規劃決定。[素材宣告解析](../../electron/pet-behavior-manifest.ts)成本低；直接相容上游行為語言的成本高。 |
| OpenPets | 提供虛擬寵物、專注、運動提醒等官方插件，主程式提供沙盒能力與顯示表面。[官方插件清單](https://github.com/OpenPetsHQ/openpets#shipped-official-lineup) | Agent Pets 已有番茄鐘與休息提醒範例。較有增量的是做一個陪伴插件，例如點一下「一起休息」提升親密度，從插件徽章看到進度；先比對使用者會否主動再次互動。 |
| tama96 | 照護選擇影響進化；桌面與終端共用模擬核心，以鎖協調實例。[照護循環與架構](https://github.com/siegerts/tama96#how-it-works) | 若照護結果要跨日保存，每次互動只記一次。測試雙視窗同時點擊和重啟。工作桌寵可讓離線期間暫停，保留使用者選擇養成方向的樂趣，避免長假後回來要處理一堆欠帳。 |

## 創作者怎麼做出更有個性的寵物

| 專案 | 上游做法 | 最值得移植的部分 |
| --- | --- | --- |
| Simple PNGTuber | Skin manifest 記錄圖層順序、座標與狀態變體；作者能拖曳部件校準位置並回存。[作者工作流程與格式](https://github.com/metruzanca/pngtuber/blob/main/docs/custom-skins.md) | 做一個圖集編輯器。作者可點選動作列、拖動時間調整播放節奏，並列預覽「待機／工作／等待／失敗」後匯出現有寵物包。第一版可直接重用圖集規則。 |
| PyNGtuber | 依說話狀態切換表情，角色集合與逐層動畫讓同一角色可組出不同裝扮。[專案功能](https://github.com/Gemmstone/PyNGtuber) | 編輯器若要支援換裝，可先在匯出時把衣服和角色合成一張圖，既有客戶端即可顯示。執行時即時換裝才需要新增繪圖能力。 |
| SSP／Ukagaka | Shell 規格分開定義角色的表情、動畫、換裝與可碰觸區域。[UKADOC Shell 規格原文](https://github.com/ukatech/ukadoc-spec/tree/main/descript/shell-surfaces) | 如果作者最想做的是「摸頭」與「點道具」有不同反應，可先用固定區域試驗。工作中的點擊開面板、拖移和鍵盤操作都要保持可用；到這一步才值得擴充素材格式。 |

**編輯器的驗收點**是讓作者拿一張自製圖集，完全透過介面設定走路與睡覺，匯出後在乾淨的 Agent Pets 安裝中匯入，確認節奏、列號與預覽一致；再用 v1、v2 各做一次。現有匯入畫面已能預覽，新增價值在「修改、試播、匯出、再次匯入」。上游程式碼與範例美術應各自核對授權；原型可全程用自製素材。[Agent Pets 素材格式](../../README.zh-TW.md#自訂寵物)

## 專注、習慣與語音陪伴

| 專案 | 上游做法 | Agent Pets 的試作與取捨 |
| --- | --- | --- |
| Habitica | Daily 支援按星期、週期與起始日排程，任務還能附 checklist。[任務控制器](https://github.com/HabitRPG/habitica/blob/develop/website/server/controllers/api-v3/tasks.js) | 用插件做一項自訂例行活動，例如「週一三五下班前整理筆記」。完成後由寵物短暫回應；測跨日、改排程與漏一天的情況。 |
| TamoStudy | 完成使用者開始的專注時段可取得代幣，換取食物與裝飾。上游已封存，可作設計參考。[專案與操作示例](https://github.com/narlock/TamoStudy/blob/main/README.md) | 把「人正在閱讀／思考」也納入陪伴。現有番茄鐘範例只在 Agent 思考或執行工具時累計；新插件可讓使用者手動開始，結束後留下一筆本機摘要。選配一件可見裝飾即可驗證吸引力。[既有番茄鐘範例](../plugins/examples/pomodoro/dist/main.js) |
| meow | Focus Pals 會隨計時狀態改變，並提供休息提醒。[Focus Pals 與提醒](https://github.com/sajdakabir/meow/blob/master/README.md) | 專注時讓寵物一起看書，短休息時放下書。驗證即使沒有執行中的 Agent，也可完成專注與休息；權限請求到達時仍可辨識。 |
| Project AIRI | Core Agent 把回覆中斷與輸出生命週期分開，能將中斷對到特定回覆。[Core Agent 文件](https://github.com/moeru-ai/airi/blob/main/packages/core-agent/README.md) | 若日後加入語音，播放中的短句也要能被新的權限提示中止。可沿用 Agent Pets 既有展示佇列優先序，再將取消信號接到音訊播放端。 |
| Open-LLM-VTuber | 將語音辨識、語音合成、角色呈現及可打斷對話串起來。[功能說明](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/blob/main/README.md) | 最小可測的能力是按一下朗讀既有短句，支援立即停止。先量 Windows、macOS 在勿擾切換、裝置無語音或播放中被打斷時的結果，再決定是否值得投入對話與角色記憶。 |

## 真實寵物、實體機器人與桌面之間

| 專案 | 上游做法 | Agent Pets 的試作與成本 |
| --- | --- | --- |
| Kittyhack | 在區域網路記錄貓門事件，以 RFID 區分貓，可查特定貓的事件，並透過 MQTT 整合 Home Assistant。[專案功能](https://github.com/floppyFK/kittyhack#what-you-can-do-with-kittyhack) | 「家裡的貓回來，桌上的貓就揮手」是可單獨評估的功能。先重播一筆匿名事件，只讓寵物反應一次，再測斷線重送。連真機時需要 Kittyflap、Kittyhack 及使用者啟用的橋接；原始影像、RFID 與門鎖控制都可以留在設備端。 |
| Stack-chan | JavaScript 驅動的桌上機器人，提供可在瀏覽器模擬器執行的 MOD，實機採用 M5Stack 硬體。[模擬器與實機流程](https://github.com/stack-chan/stack-chan#getting-started) | 先在模擬器用三種臉表達「工作中、等你、完成」，驗證在桌邊能否一眼辨識。接到 Agent Pets 需另建選用的狀態橋接；只輸出狀態類別就足以測價值。原型成本中，實機另計。 |
| Petoi OpenCat | 四足機器寵物把姿態、步態與伺服控制放在機器端；舊款 NyBoard 與現行 ESP32 平台有不同實作。[平台說明](https://github.com/PetoiCamp/OpenCat-Quadruped-Robot/blob/main/README.md) | 若實體表情實驗證明有吸引力，再研究機器端如何把「完成」對應到一個預設動作。需硬體、韌體、校正與實機驗證，成本高。桌面端只發有界的呈現狀態。 |

## 無障礙與低干擾互動

| 專案 | 上游做法 | Agent Pets 的試作與驗證 |
| --- | --- | --- |
| BEXAI/Pet | 原生 macOS 桌寵的減少動態模式會停止漫遊與動作動畫，但仍可用眼神回應使用者。[寵物視圖](https://github.com/BEXAI/Pet/blob/main/Sources/PetView.swift) · [測試](https://github.com/BEXAI/Pet/blob/main/Tests/DesktopTests.swift) | 讓「讀取／編輯／執行」在靜止模式各有可辨識的姿勢或道具。測一張靜止畫格能否傳達任務，並確認鍵盤仍可開啟面板。 |
| Sight-Free-Talon | 語音操作工具將一般語音、螢幕閱讀器和點字當作可分開使用的回饋通道。[偏好設定](https://github.com/C-Loftus/sight-free-talon/blob/main/docs/src/commands.md) · [NVDA 輸出](https://github.com/C-Loftus/sight-free-talon/blob/main/nvda/nvda.py) | Agent Pets 已有狀態宣讀區域。可增加「只播需要處理」與「按鍵查目前摘要」，並把點選朗讀和自動宣讀分開。在 NVDA、Narrator、VoiceOver 分別測焦點、同一事件是否只讀一次、普通狀態是否打斷重要提示。[既有宣讀區域](../../src/components/desktop-pet/PetBubbleStack.vue) |

## 如何選第一個試作

| 目標 | 建議優先項目 | 投入估計及判斷依據 |
| --- | --- | --- |
| 讓每天使用的人更快讀懂 Agent | **工作姿態＋靜止圖示** | 低至中。現有事件已帶可選工具名稱、已有動作規劃；需要設計三種尺寸也看得懂的視覺語彙。可先在一次盲測比較辨識時間與正確率。 |
| 鼓勵更多人製作寵物 | **現有圖集的可視化編輯與匯出** | 中。素材契約和匯入驗證已存在，新增工作集中在編輯與往返驗證。用兩位初次製作素材的人測能否獨立完成匯出。 |
| 提高非編碼時段的陪伴價值 | **手動專注與休息插件** | 低至中。現有排程、徽章、通知與私有儲存可以支撐原型。用沒有 Agent 執行的閱讀時段測完整流程，再觀察是否有人主動再次啟用。 |
| 多代理工作可視化 | **可追溯的子代理跟班** | 中至高，取決於各來源是否提供父子生命週期。先選單一可驗證的 adapter；資料完整率會直接影響功能可信度。 |
| 試出跨域特色 | **真貓回家通知或桌邊機器人表情** | 模擬成本低，接真機成本較高。兩個方向都能先用錄製事件或模擬器驗證，之後再按需要投入配對與裝置維護。 |

若只能選一項，先做工作姿態。它直接改善 Agent Pets 的主要用途，也能在同一次試驗回答兩個問題：使用者能否辨識工作內容，以及多出來的動作是否反而妨礙注意到「需要你」。上述投入是依現有程式邊界估計，尚未量測工時或使用者成效。
