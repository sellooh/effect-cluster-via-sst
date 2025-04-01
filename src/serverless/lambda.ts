import { NodeClusterRunnerSocket } from "@effect/platform-node";
import { Duration, Effect, Exit, Schedule } from "effect";
import {
  ClusterProblem,
  Mathematician,
  ProblemMathing,
  TooMuchMath,
} from "@/domain/mathematician";
import type { LambdaFunctionURLHandlerWithIAMAuthorizer } from "aws-lambda";

const getNodeId = () => `node-${Math.floor(Math.random() * 1000)}`;

const program = (base: number, retries: number) =>
  Effect.gen(function* () {
    const getTarget = () => Math.floor(Math.random() * 7) + base;
    const client = yield* Mathematician.client;

    const nodeId = getNodeId();
    const target = getTarget();
    const result = yield* Effect.log(
      `Do math ${nodeId} with target ${target}`
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
              result: 0,
              mathematician: "",
            });
          }
          if (exit.cause.error instanceof ProblemMathing) {
            return Exit.succeed({
              message: "Can't recover from a mathing problem",
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
        times: retries,
        schedule: Schedule.exponential(Duration.seconds(1)),
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

    if (Exit.isSuccess(result)) {
      yield* Effect.log("Result").pipe(
        Effect.annotateLogs({
          target,
          result: result.value.result,
        })
      );
    } else {
      yield* Effect.log("Result failed").pipe(
        Effect.annotateLogs({ cause: result.cause, target })
      );
    }
    return result;
  });

const LambdaClusterLayer = NodeClusterRunnerSocket.layer({
  clientOnly: true,
});

export const handler: LambdaFunctionURLHandlerWithIAMAuthorizer = async (e) => {
  const { baseParam, timesParam, concurrencyParam, retriesParam } =
    e.queryStringParameters ?? {};
  const base = baseParam ? parseInt(baseParam) : 7;
  const times = timesParam ? parseInt(timesParam) : 15;
  const concurrency = concurrencyParam ? parseInt(concurrencyParam) : 5;
  const retries = retriesParam ? parseInt(retriesParam) : 2;

  const startTime = Date.now();
  const results = await Effect.all(
    Effect.replicate(program(base, retries), times),
    {
      concurrency,
    }
  ).pipe(Effect.provide(LambdaClusterLayer), Effect.runPromise);
  const endTime = Date.now();
  const elapsedTime = endTime - startTime;

  const success = results.filter(Exit.isSuccess).length;
  const failure = results.filter(Exit.isFailure).length;
  return {
    statusCode: 200,
    body:
      "Lambda processed " +
      results.length +
      " times, " +
      success +
      " successes, " +
      failure +
      " failures, " +
      "elapsed time: " +
      (elapsedTime / 1000).toFixed(2) +
      "s",
  };
};
