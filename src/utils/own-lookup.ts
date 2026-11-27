// 不可信字串查表只認表自己的 key：一般物件查表會沿原型鏈拿到 `constructor`、`toString` 之類的函式。
export function lookupOwn<Table extends object>(table: Table, key: string): Table[keyof Table] | undefined {
  return Object.hasOwn(table, key) ? table[key as keyof Table] : undefined
}
