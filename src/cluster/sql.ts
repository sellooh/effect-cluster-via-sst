import { PgClient } from "@effect/sql-pg"
import { Config } from "effect"
import { constVoid } from "effect/Function"

export const SqlLayer = PgClient.layerConfig({
  database: Config.string("DB_DATABASE"),
  username: Config.string("DB_USER"),
  password: Config.redacted("DB_PASSWORD"),
  host: Config.string("DB_HOST"),
  port: Config.number("DB_PORT"),
  onnotice: Config.succeed(constVoid),
})
