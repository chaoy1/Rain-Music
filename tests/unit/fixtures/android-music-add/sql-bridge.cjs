// Test-only Android DB adapter: run SQL in a real SQLite engine, not a SQL mock.
const fs = require('node:fs')
const readline = require('node:readline')
const { DatabaseSync } = require('node:sqlite')
const schema = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
let db
const reset = () => {
  db?.close()
  db = new DatabaseSync(':memory:')
  for (const sql of schema) db.exec(sql)
}
reset()
readline.createInterface({ input: process.stdin }).on('line', line => {
  try {
    const { op, sql, params = [] } = JSON.parse(line)
    let result = {}
    if (op === 'reset') reset()
    else if (op === 'query') {
      const statement = db.prepare(sql)
      result = { columns: statement.columns().map(column => column.name), rows: statement.all(...params) }
    } else if (op === 'exec') db.prepare(sql).run(...params)
    else db.exec(op)
    process.stdout.write(JSON.stringify({ ok: true, ...result }) + '\n')
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }) + '\n')
  }
})
