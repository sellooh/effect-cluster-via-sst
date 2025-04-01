#!/usr/bin/env npx tsx

/**
 * This script is used to run the cluster in dev mode.
 * It will run the shard manager and a runner.
 * It will then wait for the user to press [x] or [q] to terminate the cluster.
 * It will then wait for the user to press [r] to restart the runner.
 * It will then wait for the user to press [c] to crash the runner.
 */

import { Effect, Console, Match, Layer } from "effect";
import { NodeRuntime, NodeTerminal } from "@effect/platform-node";
import { spawn } from "child_process";
import { Terminal } from "@effect/platform";
import { identity } from "effect/Function";

class DevCommand extends Effect.Service<DevCommand>()("app/DevCommand", {
  effect: Effect.gen(function* () {
    return {
      execute: (args: string[]) => {
        const childProcess = spawn("npx", args, {
          cwd: process.cwd(),
          stdio: "inherit",
          detached: true,
        });

        return {
          terminate: () => {
            childProcess.kill("SIGINT");
          },
        };
      },
    };
  }),
}) {}

const program = Effect.gen(function* () {
  const terminal = yield* Terminal.Terminal;
  const { execute } = yield* DevCommand;

  let shardManagerProcess: { terminate: () => void } | undefined;
  let runnerProcess: { terminate: () => void } | undefined;

  yield* Effect.addFinalizer(() =>
    Console.log("Application is about to exit!").pipe(
      Effect.tap(() => {
        runnerProcess?.terminate();
        shardManagerProcess?.terminate();
      })
    )
  );

  yield* Console.log("Press [x] or [q] to terminate");
  yield* Console.log("Press [r] to restart the runner");
  yield* Console.log("Press [c] to crash the runner");
  shardManagerProcess = execute(["tsx", "src/shard-manager.ts"]);

  // This delay allows the shard manager to start
  // before the runner is started.
  yield* Effect.sleep("1 second");
  const executeRunner = Effect.suspend(() =>
    Effect.sync(
      () => (
        runnerProcess?.terminate(),
        (runnerProcess = execute(["tsx", "src/runner.ts"]))
      )
    )
  );
  yield* executeRunner;

  // On press of x or q, terminate all processes
  // On press of r, restart the runner
  // On press of c, crash the runner
  yield* terminal.readInput.pipe(
    Effect.map((input) => input.key.name),
    Effect.flatMap((key) =>
      Match.value(key).pipe(
        Match.when("r", () =>
          executeRunner.pipe(Effect.zipRight(Effect.succeed(false)))
        ),
        Match.when("x", () => Effect.succeed(true)),
        Match.when("q", () => Effect.succeed(true)),
        Match.when("c", () => Effect.sync(() => runnerProcess?.terminate()).pipe(Effect.as(false))),
        Match.orElse(() => Effect.succeed(false))
      )
    ),
    Effect.repeat({
      until: identity<boolean>,
    })
  );

  yield* Console.log("Terminating services...");
  runnerProcess?.terminate();
  yield* Effect.sleep("3 seconds");
  shardManagerProcess.terminate();
});

program.pipe(
  Effect.provide(NodeTerminal.layer.pipe(Layer.merge(DevCommand.Default))),
  Effect.scoped,
  NodeRuntime.runMain
);
