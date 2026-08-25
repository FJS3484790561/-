import { constants } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { backupSqliteDatabase, openSqliteDatabase, sqliteSchemaVersion, verifySqliteDatabase } from './sqlite-database.js'

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

function required(name, position) {
  const value = option(name) ?? process.argv[position]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function main() {
  const command = process.argv[2]
  if (command === 'migrate') {
    const database = openSqliteDatabase({ filename: required('--database', 3) })
    database.close()
    return { ok: true, command, schemaVersion: sqliteSchemaVersion }
  }
  if (command === 'verify') {
    const database = openSqliteDatabase({ filename: required('--database', 3), readonly: true })
    try {
      const verification = verifySqliteDatabase(database)
      if (!verification.ok) throw new Error('Database verification failed')
      return { ok: true, command, verification }
    } finally {
      database.close()
    }
  }
  if (command === 'backup') {
    const database = openSqliteDatabase({ filename: required('--database', 3) })
    try {
      const result = await backupSqliteDatabase(database, required('--output', 4))
      return { ok: true, command, ...result }
    } finally {
      database.close()
    }
  }
  if (command === 'restore-check') {
    const source = resolve(required('--backup', 3))
    const destination = resolve(required('--destination', 4))
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination, constants.COPYFILE_EXCL)
    const database = openSqliteDatabase({ filename: destination, readonly: true })
    try {
      const verification = verifySqliteDatabase(database)
      if (!verification.ok) throw new Error('Restored database verification failed')
      return { ok: true, command, destination, verification }
    } finally {
      database.close()
    }
  }
  throw new Error('Expected migrate, verify, backup or restore-check command')
}

try {
  console.log(JSON.stringify(await main()))
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }))
  process.exitCode = 1
}
