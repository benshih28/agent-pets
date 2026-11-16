#!/usr/bin/env bash
# 判斷 electron-builder 的輸出（log 檔）是不是「下載 Electron／打包工具時的暫時性網路錯誤」。
# 用法：bash scripts/is-download-error.sh <log 檔>
# 結束碼：0 = 像下載或網路錯誤（可改走 API mirror 重試）；1 = 不是（呼叫端應直接失敗）。
# 只給 .github/workflows/release.yml 的 Package 步驟使用；這支腳本不輸出任何 log 內容。
#
# 字串來源：
#   - builder-util-runtime：`HttpError: 504 Gateway Timeout`、`Cannot download "<url>", status 504: ...`
#   - @electron/get（got）：`Response code 504 (Gateway Timeout)`
#   - Node 的 errno：ECONNRESET／ETIMEDOUT／ENOTFOUND／EAI_AGAIN 等
#   - app-builder（Go）下載工具：`i/o timeout`、`TLS handshake timeout`、`connection reset by peer`、`unexpected EOF`
set -u

log="${1:?usage: is-download-error.sh <log file>}"
[ -r "$log" ] || exit 1

# 公證已開始或已被判定：一律不重試。公證耗時長（每次最多數十分鐘），重跑會超過 job 的 45 分鐘上限，
# 也會用第二次的失敗蓋掉真正的拒絕原因。electron-builder 成功時印 "notarization successful"，
# @electron/notarize 失敗時是 "Failed to notarize via notarytool"；ad-hoc 路徑的 "skipped macOS notarization" 不算。
if grep -Eiq 'notarytool|failed to notarize|notarization (successful|failed)|stapler' "$log"; then
  exit 1
fi

grep -Eiq \
  'ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EPIPE|socket hang up|i/o timeout|TLS handshake timeout|connection reset by peer|unexpected EOF|HttpError: 5[0-9]{2}|Response code 5[0-9]{2}|Cannot download .*status 5[0-9]{2}|Bad Gateway|Gateway Time-?out|Service Unavailable|(failed|error) (to )?download|download(ing)? .*(failed|error)' \
  "$log"
