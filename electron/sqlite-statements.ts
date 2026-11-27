// SQL 字串都是原始碼內的有限常數集合，快取不會無限成長。
export class StatementCache<Statement> {
  private readonly statements = new Map<string, Statement>()
  private readonly prepare: (sql: string) => Statement

  // 不用 parameter property：測試以 Node strip-types 直接執行，不支援該語法。
  constructor(prepare: (sql: string) => Statement) {
    this.prepare = prepare
  }

  get(sql: string): Statement {
    let statement = this.statements.get(sql)
    if (!statement) {
      statement = this.prepare(sql)
      this.statements.set(sql, statement)
    }
    return statement
  }

  clear(): void {
    this.statements.clear()
  }
}
