import { ClusterSchema, Entity } from "@effect/cluster";
import { Duration, Effect, Fiber, Function, Schema } from "effect";
import { Rpc } from "@effect/rpc";

export class ProblemMathing extends Schema.TaggedError<ProblemMathing>(
  "ProblemMathing"
)("ProblemMathing", {}) {}

export class TooMuchMath extends Schema.TaggedError<TooMuchMath>("TooMuchMath")(
  "TooMuchMath",
  {}
) {}

export class BadLuckMath extends Schema.TaggedError<BadLuckMath>("BadLuckMath")(
  "BadLuckMath",
  {}
) {}

export class ClusterProblem extends Schema.TaggedError<ClusterProblem>(
  "ClusterProblem"
)("ClusterProblem", {
  message: Schema.String,
}) {}

export const Mathematician = Entity.make("Mathematician", [
  Rpc.make("CalculateFibonacci", {
    payload: {
      target: Schema.Int,
    },
    success: Schema.Struct({
      result: Schema.Int,
      mathematician: Schema.String,
    }),
    error: Schema.Union(
      TooMuchMath,
      BadLuckMath,
      ProblemMathing,
      ClusterProblem
    ),
  }),
]).annotateRpcs(ClusterSchema.Persisted, true);

const fib = (n: number): Effect.Effect<number> =>
  Effect.gen(function* () {
    if (n <= 1) {
      return n;
    }

    // Fork two fibers for the recursive Fibonacci calls
    const fiber1 = yield* Effect.fork(fib(n - 2));
    const fiber2 = yield* Effect.fork(fib(n - 1));

    // Join the fibers to retrieve their results
    const v1 = yield* Fiber.join(fiber1);
    const v2 = yield* Fiber.join(fiber2);

    return v1 + v2; // Combine the results
  });

/**
 * Returns a random mathematician id
 * @returns "mathematician-double-checker-123" or "mathematician-procrastinator-456"
 */
const getRandomMathematician = () => {
  const types = ["double-checker", "procrastinator"];
  const randomIndex = Math.random() < 0.5 ? 0 : 1;
  return `mathematician-${types[randomIndex]}-${Math.floor(Math.random() * 1000)}`;
};

/**
 * Returns true 50% of the time
 * @returns boolean
 */
const isSuperstitious = () => Math.random() < 0.5;

export const MathematicianLive = Mathematician.toLayer(
  Effect.gen(function* () {
    const address = yield* Entity.CurrentAddress;
    const client = yield* Mathematician.client;

    if (address.entityId.startsWith("assistant")) {
      return {
        CalculateFibonacci: Effect.fnUntraced(function* (envelope) {
          yield* Effect.log("Assistant calculating Fibonacci");
          return yield* fib(envelope.payload.target).pipe(
            Effect.zipLeft(Effect.log("Assistant calculating Fibonacci done")),
            Effect.map((result) => ({
              result,
              mathematician: address.entityId,
            }))
          );
        }),
      };
    }

    return {
      CalculateFibonacci: Effect.fnUntraced(
        function* (envelope) {
          if (envelope.payload.target === 13 && isSuperstitious()) {
            yield* Effect.fail(new BadLuckMath());
          }
          if (envelope.payload.target > 15) {
            yield* Effect.fail(new TooMuchMath());
          }

          const mathematician = getRandomMathematician();
          if (mathematician.startsWith("mathematician-double-checker")) {
            const assistantResult = yield* client(
              mathematician.replace("mathematician-", "assistant-")
            )
              .CalculateFibonacci({
                target: envelope.payload.target,
              })
              .pipe(
                Effect.catchTag("TooMuchMath", Function.identity),
                Effect.catchTag("BadLuckMath", Function.identity),
                Effect.catchAll(
                  () =>
                    new ClusterProblem({
                      message: "Problem getting math from assistant",
                    })
                )
              );
            const doubleCheckerResult = yield* fib(
              envelope.payload.target
            ).pipe(
              Effect.andThen((result) =>
                Effect.log("Calculating Fibonacci done").pipe(
                  Effect.annotateLogs({
                    result,
                    target: envelope.payload.target,
                  }),
                  Effect.as(result)
                )
              )
            );
            if (doubleCheckerResult !== assistantResult.result) {
              yield* Effect.fail(new ProblemMathing());
            }
            yield* Effect.log("Match checks out");
            return {
              result: doubleCheckerResult,
              mathematician:
                mathematician + " and " + assistantResult.mathematician,
            };
          }
          if (mathematician.startsWith("mathematician-procrastinator")) {
            yield* Effect.log("Procrastinating...");
            yield* Effect.sleep(Duration.seconds(2));

            yield* Effect.log("Calculating Fibonacci");
            return yield* fib(envelope.payload.target).pipe(
              Effect.andThen((result) =>
                Effect.log("Calculating Fibonacci done").pipe(
                  Effect.annotateLogs({
                    result,
                    target: envelope.payload.target,
                  }),
                  Effect.as(result)
                )
              ),
              Effect.map((result) => ({
                result,
                mathematician: mathematician,
              }))
            );
          }

          return yield* Effect.fail(
            new ClusterProblem({ message: "No work has been done" })
          );
        },
        (effect, { payload }) =>
          Effect.annotateLogs(effect, {
            address,
            pid: process.pid,
            target: payload.target,
          })
      ),
    };
  })
);
