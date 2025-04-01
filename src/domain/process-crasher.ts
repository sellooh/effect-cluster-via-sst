import { Config, Duration, Effect, Schedule } from "effect";
import { Singleton } from "@effect/cluster";
import { IpAddress } from "@/cluster/container-metadata";

export const ProcessCrasher = Singleton.make(
  "ProcessCrasher",
  Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.log("The process has crashed"));

    const ip = yield* IpAddress;
    yield* Effect.annotateLogsScoped({ ip });

    const installedCrasher = yield* Config.boolean(
      "INSTALL_PROCESS_CRASHER"
    ).pipe(Config.withDefault(false));
    if (!installedCrasher) {
      yield* Effect.log("The ProcessCrasher was not installed");
      yield* Effect.never;
    }

    yield* Effect.log("The ProcessCrasher was installed");

    yield* Effect.sync(() => process.kill(process.pid, "SIGINT")).pipe(
      Effect.delay(Duration.minutes(1.5)),
      Effect.fork
    );

    yield* Effect.log("The ProcessCrasher is alive").pipe(
      Effect.repeat(Schedule.fixed("15 seconds"))
    );
  })
);
