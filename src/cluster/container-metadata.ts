import { Config, Context, Data, Effect, Layer, Option } from "effect";

export class EcsContainerMetadata extends Context.Tag("EcsContainerMetadata")<
  EcsContainerMetadata,
  Option.Option<string>
>() {}
export const ecsContainerMetadataLayer = Layer.effect(
  EcsContainerMetadata,
  Config.option(Config.string("ECS_CONTAINER_METADATA_URI_V4"))
);

export class FetchIpError extends Data.TaggedError("FetchIpError")<{}> {}

export const privateIp = EcsContainerMetadata.pipe(
  Effect.flatMap((uriOptional) =>
    Option.match(uriOptional, {
      onNone: () => Effect.succeed("0.0.0.0"),
      onSome: (uri) =>
        Effect.tryPromise({
          try: async () => {
            const response = await fetch(`${uri}/task`);
            const data = await response.json();
            // console.log("Containers", data.Containers);
            // console.log("Networks", data.Containers[0].Networks);
            // console.log("ip", data.Containers[0].Networks[0].IPv4Addresses[0]);
            return data.Containers[0].Networks[0].IPv4Addresses[0] as string;
          },
          catch: (error) => {
            console.error("error", error);
            return new FetchIpError();
          },
        }),
    })
  )
);

export class IpAddress extends Context.Tag("IpAddress")<IpAddress, string>() {}
export const ipLayer = Layer.effect(IpAddress, privateIp).pipe(
  Layer.provide(ecsContainerMetadataLayer)
);

export class Port extends Context.Tag("Port")<Port, number>() {}
export const portLayer = Layer.effect(
  Port,
  Config.number("PORT").pipe(Config.withDefault(34431))
);
