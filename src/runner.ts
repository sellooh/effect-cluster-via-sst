import { MathematicianLive } from "@/domain/mathematician";
import { SqlLayer } from "@/cluster/sql";
import { RunnerAddress } from "@effect/cluster";
import { NodeClusterRunnerSocket, NodeRuntime } from "@effect/platform-node";
import { Context, Effect, Layer, Option, Logger } from "effect";
import { HealthServerLive } from "@/cluster/health-server";
import { IpAddress, ipLayer, Port } from "@/cluster/container-metadata";
import { portLayer } from "@/cluster/container-metadata";
import { ProcessCrasher } from "@/domain/process-crasher";

const RunnerLive = Layer.mergeAll(ipLayer, portLayer).pipe(
  Layer.flatMap((ctx) =>
    NodeClusterRunnerSocket.layer({
      storage: "sql",
      shardingConfig: {
        runnerAddress: Option.some(
          RunnerAddress.make(
            Context.get(ctx, IpAddress),
            Context.get(ctx, Port)
          )
        ),
      },
    })
  )
);

const Entities = Layer.mergeAll(MathematicianLive, ProcessCrasher).pipe(
  Layer.provide(ipLayer)
);

const program = Entities.pipe(
  Layer.provide(RunnerLive),
  Layer.provide(HealthServerLive),
  Layer.provide(SqlLayer),
  Layer.launch
);

const inEcs = process.env.ECS_CONTAINER_METADATA_URI_V4 !== undefined;
const programWithAdjustedLogger = inEcs
  ? program.pipe(Effect.provide(Logger.json))
  : program;

programWithAdjustedLogger.pipe(
  NodeRuntime.runMain({ disablePrettyLogger: inEcs })
);
