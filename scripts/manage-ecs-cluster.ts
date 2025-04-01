#!/usr/bin/env npx tsx

/**
 * This script is used to manage the ECS cluster.
 * It will list the clusters, and then list the services in the cluster.
 * It will then allow the user to scale the services up and down.
 * It will also allow the user to set the desired count for a service.
 */

import { Deferred, Effect, Layer } from "effect";
import { Command, Prompt } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { spawn } from "child_process";
import { Schema } from "effect";
import { QuitException } from "@effect/platform/Terminal";

const StsGetCallerIdentity = Schema.parseJson(
  Schema.Struct({
    UserId: Schema.String,
    Account: Schema.String,
    Arn: Schema.String,
  })
);

const EcsListClusters = Schema.parseJson(
  Schema.Struct({
    clusterArns: Schema.Array(Schema.String),
  })
);

const EcsListServices = Schema.parseJson(
  Schema.Struct({
    serviceArns: Schema.Array(Schema.String),
  })
);

const EcsDescribeServices = Schema.parseJson(
  Schema.Struct({
    services: Schema.Array(
      Schema.Struct({
        serviceName: Schema.String,
        desiredCount: Schema.Number,
        runningCount: Schema.Number,
      })
    ),
  })
);

class ClusterCommand extends Effect.Service<ClusterCommand>()(
  "app/ClusterCommand",
  {
    effect: Effect.gen(function* () {
      return {
        execute: Effect.fnUntraced(function* (args: string[]) {
          const deferred = yield* Deferred.make<string>();

          const childProcess = spawn("aws", [...args, "--output", "json"], {
            cwd: process.cwd(),
          });
          let data = "";
          childProcess.stdout?.on("data", (chunk) => {
            data += chunk.toString();
          });
          childProcess.on("close", () => {
            Effect.runFork(
              Deferred.completeWith(deferred, Effect.succeed(data))
            );
          });

          return deferred;
        }),
      };
    }),
  }
) {}

const entrypoint = Command.make("init").pipe(
  Command.withDescription("Manage the cluster"),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const { execute } = yield* ClusterCommand;
      const getCallerIdDeferred = yield* execute([
        "sts",
        "get-caller-identity",
      ]);
      yield* Deferred.await(getCallerIdDeferred).pipe(
        Effect.flatMap(Schema.decodeUnknown(StsGetCallerIdentity)),
        Effect.catchAll(() =>
          Effect.fail("Please configure your AWS credentials")
        )
      );

      const listClustersDeferred = yield* execute(["ecs", "list-clusters"]);
      const listClusters = yield* Deferred.await(listClustersDeferred).pipe(
        Effect.flatMap(Schema.decodeUnknown(EcsListClusters)),
        Effect.catchAll(() => Effect.fail("Failed to list clusters"))
      );

      const clusterArn = yield* Prompt.select({
        message: "Select a cluster",
        choices: listClusters.clusterArns.map((cluster) => ({
          title: cluster.split("/").pop()!,
          value: cluster,
        })),
      });

      const listServicesDeferred = yield* execute([
        "ecs",
        "list-services",
        "--cluster",
        clusterArn,
      ]);
      const listServices = yield* Deferred.await(listServicesDeferred).pipe(
        Effect.flatMap(Schema.decodeUnknown(EcsListServices)),
        Effect.catchAll(() => Effect.fail("Failed to list services"))
      );

      if (listServices.serviceArns.length === 0) {
        yield* Effect.log("No services found in the cluster");
        return;
      }

      // Get detailed service information
      const describeServicesDeferred = yield* execute([
        "ecs",
        "describe-services",
        "--cluster",
        clusterArn,
        "--services",
        ...listServices.serviceArns,
      ]);
      const servicesInfo = yield* Deferred.await(describeServicesDeferred).pipe(
        Effect.flatMap(Schema.decodeUnknown(EcsDescribeServices)),
        Effect.catchAll((e) => Effect.fail(e.message))
      );

      yield* Effect.log("\nCurrent service status:").pipe(
        Effect.annotateLogs({
          servicesInfo,
        })
      );

      const scaleDownAll = [
        {
          title: "Scale all services to 0",
          value: 0,
        },
        {
          title: "Scale all services to 1",
          value: 1,
        },
      ];
      const serviceChoices = listServices.serviceArns.map((service) => ({
        title: "Scale " + service.split("/").pop()!,
        value: service,
      }));
      const serviceDecision = yield* Prompt.select<string | number>({
        message: "What do you want to do?",
        choices: [...serviceChoices, ...scaleDownAll],
      });
      if (typeof serviceDecision === "number") {
        yield* Effect.log(`Scaling to ${serviceDecision} all services`);
        for (const service of listServices.serviceArns) {
          yield* execute([
            "ecs",
            "update-service",
            "--cluster",
            clusterArn,
            "--service",
            service,
            "--desired-count",
            serviceDecision.toString(),
          ]).pipe(Effect.as(void 0));
        }
        return;
      }

      const desiredCount = yield* Prompt.integer({
        message: "Set the desired count for the service",
        min: 0,
        max: 100,
      });
      const updateServiceDeferred = yield* execute([
        "ecs",
        "update-service",
        "--cluster",
        clusterArn,
        "--service",
        serviceDecision,
        "--desired-count",
        desiredCount.toString(),
      ]);
      yield* Deferred.await(updateServiceDeferred);
      yield* Effect.log("Done");
    }).pipe(
      Effect.catchAll((e) => {
        if (e instanceof QuitException) {
          return Effect.fail(e.message);
        }
        console.error(e);
        return Effect.fail(e);
      })
    )
  )
);

export const run = Command.run(entrypoint, {
  name: "manage-cluster",
  version: "0.0.1",
});

run(process.argv).pipe(
  Effect.provide(NodeContext.layer.pipe(Layer.merge(ClusterCommand.Default))),
  NodeRuntime.runMain({
    disableErrorReporting: true,
    disablePrettyLogger: true,
  })
);
