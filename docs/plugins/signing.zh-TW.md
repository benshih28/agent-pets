# 插件套件簽章

套件可在根目錄加入選填的 `signature.json`，與 `plugin.json` 放在同一層：

```json
{
  "alg": "ed25519",
  "publicKey": "<base64 編碼的 32-byte Ed25519 公鑰>",
  "signature": "<base64 編碼的 64-byte Ed25519 簽章>"
}
```

簽章涵蓋除根目錄 `signature.json` 以外的所有套件檔案。依套件相對路徑做不依賴語系的字典序排序；每個檔案附加一行 UTF-8 文字，並以 `\n` 結尾：

```text
<路徑>\t<檔案內容的小寫 SHA-256 十六進位值>\n
```

以 Ed25519 對完整行列表的 UTF-8 位元組簽章。驗證器會拒絕格式錯誤的 JSON、多餘欄位、未知演算法、非標準 base64、長度錯誤的金鑰或簽章，以及與套件內容不符的簽章。有效簽章只證明套件內容符合對應私鑰產生的簽章，不能證明作者真實身分，也不能證明程式安全。

## Node.js 範例

此範例只用 Node 內建的 `node:crypto`，不使用第三方簽章套件。`files` 必須包含將要封裝的套件相對路徑與原始位元組；`privateKey` 必須是從作者受保護的本機金鑰存放處載入的 `KeyObject`。不要把私鑰放進套件、原始碼儲存庫或目錄。

```js
import { createHash, createPublicKey, sign } from 'node:crypto'

export function createSignatureFile(files, privateKey, publicKey) {
  const payload = Buffer.from(
    [...files.entries()]
      .filter(([path]) => path !== 'signature.json')
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([path, bytes]) => `${path}\t${createHash('sha256').update(bytes).digest('hex')}\n`)
      .join(''),
    'utf8',
  )
  const rawPublicKey = createPublicKey(publicKey).export({ type: 'spki', format: 'der' }).subarray(-32)
  const signature = sign(null, payload, privateKey)
  return Buffer.from(JSON.stringify({
    alg: 'ed25519',
    publicKey: rawPublicKey.toString('base64'),
    signature: signature.toString('base64'),
  }), 'utf8')
}
```

產生 payload 後，把回傳的位元組加入套件並命名為 `signature.json`。任何其他套件檔案變更後都要重新產生簽章。請將私鑰離線保存，或放在專用的密鑰儲存區並限制存取、保留備份。金鑰遺失或外洩時，使用者必須檢查新指紋並明確確認是否信任新金鑰。

## 首次使用信任

首次安裝已簽章插件時，Agent Pets 會顯示簽章狀態，並把作者公鑰指紋綁定到該插件。指紋是原始 32-byte 公鑰的 SHA-256 小寫十六進位值前 16 碼；介面每 4 碼分組顯示。後續已簽章更新必須使用同一把金鑰。金鑰變更或從已簽章變為未簽章都必須明確確認，且預設聚焦「取消」。未簽章套件仍可安裝，但會顯示警告。開發者資料夾載入會略過簽章驗證，並標示為未驗證。
