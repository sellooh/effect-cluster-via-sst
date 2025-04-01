#!/usr/bin/env npx tsx

import { NodeClusterRunnerSocket } from "@effect/platform-node";
import { Duration, Effect, Exit, Fiber } from "effect";
import {
  ClusterProblem,
  Mathematician,
  ProblemMathing,
  TooMuchMath,
} from "../src/domain/mathematician";

const getNodeId = () => `node-${Math.floor(Math.random() * 1000)}`;
const getTarget = () => Math.floor(Math.random() * 7) + 10;

const program = Effect.gen(function* () {
  const client = yield* Mathematician.client;

  const nodeId = getNodeId();
  const target = getTarget();
  const result = yield* Effect.log(
    `Requesting ${nodeId} to calculate fibonacci(${target})`
  ).pipe(
    Effect.zipRight(
      client(nodeId).CalculateFibonacci({ target }).pipe(Effect.exit)
    ),
    Effect.flatMap((exit) => {
      // no mathematician will calculate such a large number
      // avoid retrying
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        if (exit.cause.error instanceof TooMuchMath) {
          return Exit.succeed({
            message: "No mathematician will calculate such a large number",
            // TODO should return an Option
            result: 0,
            mathematician: "",
          });
        }
        if (exit.cause.error instanceof ProblemMathing) {
          return Exit.succeed({
            message: "Can't recover from a mathing problem",
            // TODO should return an Option
            result: 0,
            mathematician: "",
          });
        }
        // all other error could be recoverable
        return Effect.fail(exit.cause.error);
      }
      return exit;
    }),
    Effect.timeout(Duration.seconds(3)),
    Effect.retry({
      times: 0,
    }),
    // Something catastrophic happened
    Effect.catchAll((e) =>
      Effect.fail(
        new ClusterProblem({
          message: "Something catastrophic happened -> " + e._tag,
        })
      )
    ),
    Effect.exit
  );
  yield* Effect.log(`Result:`).pipe(
    Effect.annotateLogs({
      target,
      result,
    })
  );
  return result;
});

const ClusterLayer = NodeClusterRunnerSocket.layer({
  clientOnly: true,
});

Effect.all(Effect.replicate(program, 100), { concurrency: 15 })
  .pipe(
    Effect.tap((results) => {
      const success = results.filter(Exit.isSuccess).length;
      const failure = results.filter(Exit.isFailure).length;
      console.log(`Success: ${success}, Failure: ${failure}`);
    }),
    Effect.provide(ClusterLayer),
    Effect.catchAll((error) => {
      console.error(error);
      return Effect.void;
    }),
    Effect.runPromise
  )
  .catch((error) => {
    console.error(error);
  });
