/// <reference path="./.sst/platform/config.d.ts" />
const privateDnsName = "effect-cluster.private";
function generateServiceHostname(serviceName: string) {
  return `${serviceName}.${$app.stage}.${$app.name}.${privateDnsName}`;
}
export default $config({
  app(input) {
    return {
      name: "effect-cluster-via-sst",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: { awsx: "2.21.1" },
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("Vpc", {
      nat: "ec2",
    });
    const database = new sst.aws.Postgres("Database", { vpc });
    const privateDnsNamespace = new aws.servicediscovery.PrivateDnsNamespace(
      "EffectClusterPrivateDnsNamespace",
      {
        name: privateDnsName,
        description: "Private namespace for effect-cluster",
        vpc: vpc.id,
      }
    );
    const securityGroup = new aws.ec2.SecurityGroup(
      "EffectClusterSecurityGroup",
      {
        vpcId: vpc.id,
        description: "Security group for effect-cluster",
      }
    );
    new aws.vpc.SecurityGroupEgressRule("allow_all_traffic_ipv4", {
      securityGroupId: securityGroup.id,
      cidrIpv4: "0.0.0.0/0",
      ipProtocol: "-1",
    });
    // allow inbound from vpc
    new aws.vpc.SecurityGroupIngressRule("allow_inbound_from_vpc", {
      securityGroupId: securityGroup.id,
      cidrIpv4: vpc.nodes.vpc.cidrBlock,
      ipProtocol: "-1",
    });
    const cluster = new sst.aws.Cluster("EffectCluster", {
      vpc: {
        id: vpc.id,
        securityGroups: [securityGroup.id],
        containerSubnets: vpc.privateSubnets,
        loadBalancerSubnets: vpc.publicSubnets,
        cloudmapNamespaceId: privateDnsNamespace.id,
        cloudmapNamespaceName: privateDnsNamespace.name,
      },
    });
    const commonEnvironment = {
      SHARD_MANAGER_HOST: generateServiceHostname("ShardManager"),
      DB_DATABASE: database.database,
      DB_USER: database.username,
      DB_PASSWORD: database.password,
      DB_HOST: database.host,
      DB_PORT: database.port.apply((port) => port.toString()),
    };
    const repository = new awsx.ecr.Repository("Repository", {});
    const image = new awsx.ecr.Image("image", {
      repositoryUrl: repository.url,
      // adjust path because sst run on ./sst/platform
      context: "../../",
      platform: "linux/amd64",
    });

    const shardManager = new sst.aws.Service("ShardManager", {
      cluster,
      containers: [
        {
          name: "shard-manager",
          image: image.imageUri,
          command: ["dist/shard-manager.js"],
          environment: {
            ...commonEnvironment,
          },
        },
      ],
    });

    function createRunnerContainer(
      index: number,
      port: number,
      healthCheckPort: number
    ) {
      return {
        name: `runner-${index}`,
        image: image.imageUri,
        command: ["dist/runner.js"],
        memory: "0.25 GB" as const,
        health: {
          command: ["CMD", "node", "dist/health-check.js"],
        },
        environment: {
          ...commonEnvironment,
          PORT: port.toString(),
          HEALTH_CHECK_PORT: healthCheckPort.toString(),
          INSTALL_PROCESS_CRASHER: "true", // simulate processes crashing randomly
        },
      };
    }

    const runner = new sst.aws.Service("Runner", {
      cluster,
      capacity: "spot",
      memory: "1 GB",
      containers: [
        createRunnerContainer(1, 34431, 3001),
        createRunnerContainer(2, 34432, 3002),
        createRunnerContainer(3, 34433, 3003),
        createRunnerContainer(4, 34434, 3004),
      ],
      transform: {
        // Set a restart policy for all containers
        // Not provided by the SST configs
        taskDefinition: (args) => {
          // "containerDefinitions" is a JSON string, parse first
          let value = $jsonParse(args.containerDefinitions);

          // Update "portMappings"
          value = value.apply((containerDefinitions) => {
            for (const container of containerDefinitions) {
              container.restartPolicy = {
                enabled: true,
                restartAttemptPeriod: 60,
              };
            }
            return containerDefinitions;
          });

          // Convert back to JSON string
          args.containerDefinitions = $jsonStringify(value);
        },
      },
    });
    new sst.aws.Function("MyFunction", {
      vpc,
      url: true,
      timeout: "5 minutes",
      link: [shardManager],
      handler: "src/serverless/lambda.handler",
      environment: {
        SHARD_MANAGER_HOST: generateServiceHostname("ShardManager"),
      },
    });
  },
});
