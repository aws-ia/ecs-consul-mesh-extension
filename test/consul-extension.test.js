"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("@aws-cdk/assert");
const cdk = require("@aws-cdk/core");
const ecs_service_extensions_1 = require("@aws-cdk-containers/ecs-service-extensions");
const ecs = require("@aws-cdk/aws-ecs");
const consul_mesh_extension_1 = require("../lib/consul-mesh-extension");
const ec2 = require("@aws-cdk/aws-ec2");
const core_1 = require("@aws-cdk/core");
const secretsmanager = require("@aws-cdk/aws-secretsmanager");
describe('consulmesh', () => {
    test('Test extension with default params', () => {
        // WHEN
        const stack = new core_1.Stack();
        // GIVEN
        const environment = new ecs_service_extensions_1.Environment(stack, 'production');
        const consulSecurityGroup = new ec2.SecurityGroup(stack, 'consulServerSecurityGroup', {
            vpc: environment.vpc
        });
        const consulClientSercurityGroup = new ec2.SecurityGroup(stack, 'consulClientSecurityGroup', {
            vpc: environment.vpc
        });
        const TLSSecret = secretsmanager.Secret.fromSecretNameV2(stack, 'TLSEncryptKey', 'TLSEncryptValue');
        const gossipEncryptKey = secretsmanager.Secret.fromSecretNameV2(stack, 'gossipEncryptKey', 'gossipEncryptValue');
        consulClientSercurityGroup.addIngressRule(consulClientSercurityGroup, ec2.Port.tcp(8301), "allow all the clients in the mesh talk to each other");
        consulClientSercurityGroup.addIngressRule(consulClientSercurityGroup, ec2.Port.udp(8301), "allow all the clients in the mesh talk to each other");
        const nameDescription = new ecs_service_extensions_1.ServiceDescription();
        nameDescription.add(new ecs_service_extensions_1.Container({
            cpu: 1024,
            memoryMiB: 2048,
            trafficPort: 3000,
            image: ecs.ContainerImage.fromRegistry('nathanpeck/name')
        }));
        nameDescription.add(new consul_mesh_extension_1.ConsulMeshExtension({
            retryJoin: "provider=aws region=us-west-2 tag_key=Name tag_value=test-consul-server",
            consulServerSercurityGroup: consulSecurityGroup,
            port: 3000,
            consulClientSercurityGroup,
            family: "name",
            tls: true,
            consulCACert: TLSSecret,
            gossipEncryptKey
        }));
        const nameService = new ecs_service_extensions_1.Service(stack, 'name', {
            environment: environment,
            serviceDescription: nameDescription
        });
        // launch service into that cluster
        const greeterDescription = new ecs_service_extensions_1.ServiceDescription();
        greeterDescription.add(new ecs_service_extensions_1.Container({
            cpu: 1024,
            memoryMiB: 2048,
            trafficPort: 3000,
            image: ecs.ContainerImage.fromRegistry('nathanpeck/greeter')
        }));
        greeterDescription.add(new consul_mesh_extension_1.ConsulMeshExtension({
            retryJoin: "provider=aws region=us-west-2 tag_key=Name tag_value=test-consul-server",
            consulServerSercurityGroup: consulSecurityGroup,
            port: 3000,
            consulClientSercurityGroup,
            family: "greeter",
            tls: true,
            consulCACert: TLSSecret,
            gossipEncryptKey
        }));
        const greeterService = new ecs_service_extensions_1.Service(stack, 'greeter', {
            environment: environment,
            serviceDescription: greeterDescription
        });
        greeterService.connectTo(nameService);
        //THEN
        assert_1.expect(stack).to(assert_1.haveResource('AWS::ECS::TaskDefinition', {
            "ContainerDefinitions": [
                {
                    "Cpu": 1024,
                    "DependsOn": [
                        {
                            "Condition": "SUCCESS",
                            "ContainerName": "consul-ecs-mesh-init"
                        },
                        {
                            "Condition": "HEALTHY",
                            "ContainerName": "sidecar-proxy"
                        }
                    ],
                    "Environment": [
                        {
                            "Name": "NAME_URL",
                            "Value": "http://localhost:3001"
                        }
                    ],
                    "Essential": true,
                    "Image": "nathanpeck/greeter",
                    "Memory": 2048,
                    "Name": "app",
                    "PortMappings": [
                        {
                            "ContainerPort": 3000,
                            "Protocol": "tcp"
                        }
                    ],
                    "Ulimits": [
                        {
                            "HardLimit": 1024000,
                            "Name": "nofile",
                            "SoftLimit": 1024000
                        }
                    ]
                },
                {
                    "Command": [
                        {
                            "Fn::Join": [
                                "",
                                [
                                    "ECS_IPV4=$(curl -s $ECS_CONTAINER_METADATA_URI | jq -r '.Networks[0].IPv4Addresses[0]') && if [ true == true ]; then                 echo \"{{resolve:secretsmanager:arn:",
                                    {
                                        "Ref": "AWS::Partition"
                                    },
                                    ":secretsmanager:",
                                    {
                                        "Ref": "AWS::Region"
                                    },
                                    ":",
                                    {
                                        "Ref": "AWS::AccountId"
                                    },
                                    ":secret:TLSEncryptValue:SecretString:::}}\" > /tmp/consul-agent-ca-cert.pem;\n                fi &&\n                  exec consul agent                   -advertise $ECS_IPV4                   -data-dir /consul/data                   -client 0.0.0.0                   -hcl 'addresses = { dns = \"127.0.0.1\" }'                   -hcl 'addresses = { grpc = \"127.0.0.1\" }'                   -hcl 'addresses = { http = \"127.0.0.1\" }'                   -retry-join \"provider=aws region=us-west-2 tag_key=Name tag_value=test-consul-server\"                   -hcl 'telemetry { disable_compat_1.9 = true }'                   -hcl 'leave_on_terminate = true'                   -hcl 'ports { grpc = 8502 }'                   -hcl 'advertise_reconnect_timeout = \"15m\"'                   -hcl 'enable_central_service_config = true'                -hcl 'ca_file = \"/tmp/consul-agent-ca-cert.pem\"'                -hcl 'auto_encrypt = {tls = true}'                -hcl \"auto_encrypt = {ip_san = [ \\\"$ECS_IPV4\\\" ]}\"                -hcl 'verify_outgoing = true'             -encrypt \"{{resolve:secretsmanager:arn:",
                                    {
                                        "Ref": "AWS::Partition"
                                    },
                                    ":secretsmanager:",
                                    {
                                        "Ref": "AWS::Region"
                                    },
                                    ":",
                                    {
                                        "Ref": "AWS::AccountId"
                                    },
                                    ":secret:gossipEncryptValue:SecretString:::}}\""
                                ]
                            ]
                        }
                    ],
                    "EntryPoint": [
                        "/bin/sh",
                        "-ec"
                    ],
                    "Essential": false,
                    "Image": "hashicorp/consul:1.9.5",
                    "LogConfiguration": {
                        "LogDriver": "awslogs",
                        "Options": {
                            "awslogs-group": {
                                "Ref": "greetertaskdefinitionconsulclientLogGroup99EB1A03"
                            },
                            "awslogs-stream-prefix": "consul-client",
                            "awslogs-region": {
                                "Ref": "AWS::Region"
                            }
                        }
                    },
                    "Memory": 256,
                    "MountPoints": [
                        {
                            "ContainerPath": "/consul/data",
                            "ReadOnly": false,
                            "SourceVolume": "consul-data"
                        },
                        {
                            "ContainerPath": "/consul/config",
                            "ReadOnly": false,
                            "SourceVolume": "consul-config"
                        }
                    ],
                    "Name": "consul-client",
                    "PortMappings": [
                        {
                            "ContainerPort": 8301,
                            "Protocol": "tcp"
                        },
                        {
                            "ContainerPort": 8301,
                            "Protocol": "udp"
                        },
                        {
                            "ContainerPort": 8500,
                            "Protocol": "tcp"
                        }
                    ]
                },
                {
                    "Command": [
                        "mesh-init",
                        "-envoy-bootstrap-file=/consul/data/envoy-bootstrap.json",
                        "-port=3000",
                        "-upstreams=name:3001"
                    ],
                    "Essential": false,
                    "Image": "hashicorp/consul-ecs:0.1.2",
                    "LogConfiguration": {
                        "LogDriver": "awslogs",
                        "Options": {
                            "awslogs-group": {
                                "Ref": "greetertaskdefinitionconsulecsmeshinitLogGroup614BD5D5"
                            },
                            "awslogs-stream-prefix": "consul-ecs-mesh-init",
                            "awslogs-region": {
                                "Ref": "AWS::Region"
                            }
                        }
                    },
                    "Memory": 256,
                    "MountPoints": [
                        {
                            "ContainerPath": "/consul/data",
                            "ReadOnly": false,
                            "SourceVolume": "consul-data"
                        }
                    ],
                    "Name": "consul-ecs-mesh-init",
                    "User": "root"
                },
                {
                    "Command": [
                        "envoy --config-path /consul/data/envoy-bootstrap.json"
                    ],
                    "DependsOn": [
                        {
                            "Condition": "SUCCESS",
                            "ContainerName": "consul-ecs-mesh-init"
                        }
                    ],
                    "EntryPoint": [
                        "/bin/sh",
                        "-c"
                    ],
                    "Essential": false,
                    "HealthCheck": {
                        "Command": [
                            "CMD",
                            "nc",
                            "-z",
                            "127.0.0.1",
                            "20000"
                        ],
                        "Interval": 30,
                        "Retries": 3,
                        "Timeout": 5
                    },
                    "Image": "envoyproxy/envoy-alpine:v1.16.2",
                    "LogConfiguration": {
                        "LogDriver": "awslogs",
                        "Options": {
                            "awslogs-group": {
                                "Ref": "greetertaskdefinitionsidecarproxyLogGroup928001EA"
                            },
                            "awslogs-stream-prefix": "envoy",
                            "awslogs-region": {
                                "Ref": "AWS::Region"
                            }
                        }
                    },
                    "Memory": 256,
                    "MountPoints": [
                        {
                            "ContainerPath": "/consul/data",
                            "ReadOnly": false,
                            "SourceVolume": "consul-data"
                        }
                    ],
                    "Name": "sidecar-proxy",
                    "PortMappings": [
                        {
                            "ContainerPort": 20000,
                            "Protocol": "tcp"
                        }
                    ]
                }
            ],
            "Cpu": "1024",
            "ExecutionRoleArn": {
                "Fn::GetAtt": [
                    "greetertaskdefinitionExecutionRoleAED0EC79",
                    "Arn"
                ]
            },
            "Family": "greeter",
            "Memory": "2048",
            "NetworkMode": "awsvpc",
            "RequiresCompatibilities": [
                "EC2",
                "FARGATE"
            ],
            "TaskRoleArn": {
                "Fn::GetAtt": [
                    "greetertaskdefinitionTaskRole2A098ACC",
                    "Arn"
                ]
            },
            "Volumes": [
                {
                    "Name": "consul-data"
                },
                {
                    "Name": "consul-config"
                }
            ]
        }));
        assert_1.expect(stack).to(assert_1.haveResource('AWS::ECS::TaskDefinition', {
            "ContainerDefinitions": [
                {
                    "Cpu": 1024,
                    "DependsOn": [
                        {
                            "Condition": "SUCCESS",
                            "ContainerName": "consul-ecs-mesh-init"
                        },
                        {
                            "Condition": "HEALTHY",
                            "ContainerName": "sidecar-proxy"
                        }
                    ],
                    "Essential": true,
                    "Image": "nathanpeck/name",
                    "Memory": 2048,
                    "Name": "app",
                    "PortMappings": [
                        {
                            "ContainerPort": 3000,
                            "Protocol": "tcp"
                        }
                    ],
                    "Ulimits": [
                        {
                            "HardLimit": 1024000,
                            "Name": "nofile",
                            "SoftLimit": 1024000
                        }
                    ]
                },
                {
                    "Command": [
                        {
                            "Fn::Join": [
                                "",
                                [
                                    "ECS_IPV4=$(curl -s $ECS_CONTAINER_METADATA_URI | jq -r '.Networks[0].IPv4Addresses[0]') && if [ true == true ]; then                 echo \"{{resolve:secretsmanager:arn:",
                                    {
                                        "Ref": "AWS::Partition"
                                    },
                                    ":secretsmanager:",
                                    {
                                        "Ref": "AWS::Region"
                                    },
                                    ":",
                                    {
                                        "Ref": "AWS::AccountId"
                                    },
                                    ":secret:TLSEncryptValue:SecretString:::}}\" > /tmp/consul-agent-ca-cert.pem;\n                fi &&\n                  exec consul agent                   -advertise $ECS_IPV4                   -data-dir /consul/data                   -client 0.0.0.0                   -hcl 'addresses = { dns = \"127.0.0.1\" }'                   -hcl 'addresses = { grpc = \"127.0.0.1\" }'                   -hcl 'addresses = { http = \"127.0.0.1\" }'                   -retry-join \"provider=aws region=us-west-2 tag_key=Name tag_value=test-consul-server\"                   -hcl 'telemetry { disable_compat_1.9 = true }'                   -hcl 'leave_on_terminate = true'                   -hcl 'ports { grpc = 8502 }'                   -hcl 'advertise_reconnect_timeout = \"15m\"'                   -hcl 'enable_central_service_config = true'                -hcl 'ca_file = \"/tmp/consul-agent-ca-cert.pem\"'                -hcl 'auto_encrypt = {tls = true}'                -hcl \"auto_encrypt = {ip_san = [ \\\"$ECS_IPV4\\\" ]}\"                -hcl 'verify_outgoing = true'             -encrypt \"{{resolve:secretsmanager:arn:",
                                    {
                                        "Ref": "AWS::Partition"
                                    },
                                    ":secretsmanager:",
                                    {
                                        "Ref": "AWS::Region"
                                    },
                                    ":",
                                    {
                                        "Ref": "AWS::AccountId"
                                    },
                                    ":secret:gossipEncryptValue:SecretString:::}}\""
                                ]
                            ]
                        }
                    ],
                    "EntryPoint": [
                        "/bin/sh",
                        "-ec"
                    ],
                    "Essential": false,
                    "Image": "hashicorp/consul:1.9.5",
                    "LogConfiguration": {
                        "LogDriver": "awslogs",
                        "Options": {
                            "awslogs-group": {
                                "Ref": "nametaskdefinitionconsulclientLogGroup5C3CC781"
                            },
                            "awslogs-stream-prefix": "consul-client",
                            "awslogs-region": {
                                "Ref": "AWS::Region"
                            }
                        }
                    },
                    "Memory": 256,
                    "MountPoints": [
                        {
                            "ContainerPath": "/consul/data",
                            "ReadOnly": false,
                            "SourceVolume": "consul-data"
                        },
                        {
                            "ContainerPath": "/consul/config",
                            "ReadOnly": false,
                            "SourceVolume": "consul-config"
                        }
                    ],
                    "Name": "consul-client",
                    "PortMappings": [
                        {
                            "ContainerPort": 8301,
                            "Protocol": "tcp"
                        },
                        {
                            "ContainerPort": 8301,
                            "Protocol": "udp"
                        },
                        {
                            "ContainerPort": 8500,
                            "Protocol": "tcp"
                        }
                    ]
                },
                {
                    "Command": [
                        "mesh-init",
                        "-envoy-bootstrap-file=/consul/data/envoy-bootstrap.json",
                        "-port=3000",
                        "-upstreams="
                    ],
                    "Essential": false,
                    "Image": "hashicorp/consul-ecs:0.1.2",
                    "LogConfiguration": {
                        "LogDriver": "awslogs",
                        "Options": {
                            "awslogs-group": {
                                "Ref": "nametaskdefinitionconsulecsmeshinitLogGroupBE13525A"
                            },
                            "awslogs-stream-prefix": "consul-ecs-mesh-init",
                            "awslogs-region": {
                                "Ref": "AWS::Region"
                            }
                        }
                    },
                    "Memory": 256,
                    "MountPoints": [
                        {
                            "ContainerPath": "/consul/data",
                            "ReadOnly": false,
                            "SourceVolume": "consul-data"
                        }
                    ],
                    "Name": "consul-ecs-mesh-init",
                    "User": "root"
                },
                {
                    "Command": [
                        "envoy --config-path /consul/data/envoy-bootstrap.json"
                    ],
                    "DependsOn": [
                        {
                            "Condition": "SUCCESS",
                            "ContainerName": "consul-ecs-mesh-init"
                        }
                    ],
                    "EntryPoint": [
                        "/bin/sh",
                        "-c"
                    ],
                    "Essential": false,
                    "HealthCheck": {
                        "Command": [
                            "CMD",
                            "nc",
                            "-z",
                            "127.0.0.1",
                            "20000"
                        ],
                        "Interval": 30,
                        "Retries": 3,
                        "Timeout": 5
                    },
                    "Image": "envoyproxy/envoy-alpine:v1.16.2",
                    "LogConfiguration": {
                        "LogDriver": "awslogs",
                        "Options": {
                            "awslogs-group": {
                                "Ref": "nametaskdefinitionsidecarproxyLogGroup1F5889C2"
                            },
                            "awslogs-stream-prefix": "envoy",
                            "awslogs-region": {
                                "Ref": "AWS::Region"
                            }
                        }
                    },
                    "Memory": 256,
                    "MountPoints": [
                        {
                            "ContainerPath": "/consul/data",
                            "ReadOnly": false,
                            "SourceVolume": "consul-data"
                        }
                    ],
                    "Name": "sidecar-proxy",
                    "PortMappings": [
                        {
                            "ContainerPort": 20000,
                            "Protocol": "tcp"
                        }
                    ]
                }
            ],
            "Cpu": "1024",
            "ExecutionRoleArn": {
                "Fn::GetAtt": [
                    "nametaskdefinitionExecutionRole45AC5C9A",
                    "Arn"
                ]
            },
            "Family": "name",
            "Memory": "2048",
            "NetworkMode": "awsvpc",
            "RequiresCompatibilities": [
                "EC2",
                "FARGATE"
            ],
            "TaskRoleArn": {
                "Fn::GetAtt": [
                    "nametaskdefinitionTaskRole50FE844E",
                    "Arn"
                ]
            },
            "Volumes": [
                {
                    "Name": "consul-data"
                },
                {
                    "Name": "consul-config"
                }
            ]
        }));
        assert_1.expect(stack).to(assert_1.haveResource('AWS::ECS::Service', {
            "Cluster": {
                "Ref": "productionenvironmentclusterC6599D2D"
            },
            "DeploymentConfiguration": {
                "MaximumPercent": 200,
                "MinimumHealthyPercent": 100
            },
            "DesiredCount": 1,
            "EnableECSManagedTags": false,
            "LaunchType": "FARGATE",
            "NetworkConfiguration": {
                "AwsvpcConfiguration": {
                    "AssignPublicIp": "DISABLED",
                    "SecurityGroups": [
                        {
                            "Fn::GetAtt": [
                                "nameserviceSecurityGroup33F4662C",
                                "GroupId"
                            ]
                        },
                        {
                            "Fn::GetAtt": [
                                "consulClientSecurityGroup279D3373",
                                "GroupId"
                            ]
                        }
                    ],
                    "Subnets": [
                        {
                            "Ref": "productionenvironmentvpcPrivateSubnet1Subnet53F632E6"
                        },
                        {
                            "Ref": "productionenvironmentvpcPrivateSubnet2Subnet756FB93C"
                        }
                    ]
                }
            },
            "TaskDefinition": {
                "Ref": "nametaskdefinition690762BB"
            }
        }));
        assert_1.expect(stack).to(assert_1.haveResource('AWS::ECS::Service', {
            "Cluster": {
                "Ref": "productionenvironmentclusterC6599D2D"
            },
            "DeploymentConfiguration": {
                "MaximumPercent": 200,
                "MinimumHealthyPercent": 100
            },
            "DesiredCount": 1,
            "EnableECSManagedTags": false,
            "LaunchType": "FARGATE",
            "NetworkConfiguration": {
                "AwsvpcConfiguration": {
                    "AssignPublicIp": "DISABLED",
                    "SecurityGroups": [
                        {
                            "Fn::GetAtt": [
                                "greeterserviceSecurityGroupDB4AC3A9",
                                "GroupId"
                            ]
                        },
                        {
                            "Fn::GetAtt": [
                                "consulClientSecurityGroup279D3373",
                                "GroupId"
                            ]
                        }
                    ],
                    "Subnets": [
                        {
                            "Ref": "productionenvironmentvpcPrivateSubnet1Subnet53F632E6"
                        },
                        {
                            "Ref": "productionenvironmentvpcPrivateSubnet2Subnet756FB93C"
                        }
                    ]
                }
            },
            "TaskDefinition": {
                "Ref": "greetertaskdefinitionE956EEA2"
            }
        }));
    });
    test('Test extension with custom params', () => {
        // WHEN
        const stack = new core_1.Stack();
        // GIVEN
        const environment = new ecs_service_extensions_1.Environment(stack, 'production');
        const consulSecurityGroup = new ec2.SecurityGroup(stack, 'consulServerSecurityGroup', {
            vpc: environment.vpc
        });
        const consulClientSercurityGroup = new ec2.SecurityGroup(stack, 'consulClientSecurityGroup', {
            vpc: environment.vpc
        });
        const TLSSecret = secretsmanager.Secret.fromSecretNameV2(stack, 'TLSEncryptKey', 'TLSEncryptValue');
        const gossipEncryptKey = secretsmanager.Secret.fromSecretNameV2(stack, 'gossipEncryptKey', 'gossipEncryptValue');
        consulClientSercurityGroup.addIngressRule(consulClientSercurityGroup, ec2.Port.tcp(8301), "allow all the clients in the mesh talk to each other");
        consulClientSercurityGroup.addIngressRule(consulClientSercurityGroup, ec2.Port.udp(8301), "allow all the clients in the mesh talk to each other");
        const nameDescription = new ecs_service_extensions_1.ServiceDescription();
        nameDescription.add(new ecs_service_extensions_1.Container({
            cpu: 1024,
            memoryMiB: 2048,
            trafficPort: 3000,
            image: ecs.ContainerImage.fromRegistry('nathanpeck/name')
        }));
        nameDescription.add(new consul_mesh_extension_1.ConsulMeshExtension({
            retryJoin: "provider=aws region=us-west-2 tag_key=Name tag_value=test-consul-server",
            consulServerSercurityGroup: consulSecurityGroup,
            port: 3000,
            consulClientImage: "myCustomConsulClientImage:1.0",
            consulEcsImage: "myCustomConsulEcsImage:1.0",
            envoyProxyImage: "myCustomEnvoyImage:1.0",
            consulClientSercurityGroup,
            family: "name",
            tls: true,
            consulCACert: TLSSecret,
            gossipEncryptKey
        }));
        const nameService = new ecs_service_extensions_1.Service(stack, 'name', {
            environment: environment,
            serviceDescription: nameDescription
        });
        // launch service into that cluster
        const greeterDescription = new ecs_service_extensions_1.ServiceDescription();
        greeterDescription.add(new ecs_service_extensions_1.Container({
            cpu: 1024,
            memoryMiB: 2048,
            trafficPort: 3000,
            image: ecs.ContainerImage.fromRegistry('nathanpeck/greeter')
        }));
        greeterDescription.add(new consul_mesh_extension_1.ConsulMeshExtension({
            retryJoin: "provider=aws region=us-west-2 tag_key=Name tag_value=test-consul-server",
            consulServerSercurityGroup: consulSecurityGroup,
            port: 3000,
            consulClientImage: "myCustomConsulClientImage:1.0",
            consulEcsImage: "myCustomConsulEcsImage:1.0",
            envoyProxyImage: "myCustomEnvoyImage:1.0",
            consulClientSercurityGroup,
            family: "greeter",
            tls: true,
            consulCACert: TLSSecret,
            gossipEncryptKey
        }));
        const greeterService = new ecs_service_extensions_1.Service(stack, 'greeter', {
            environment: environment,
            serviceDescription: greeterDescription,
        });
        greeterService.connectTo(nameService);
        //THEN
        assert_1.expect(stack).to(assert_1.haveResource('AWS::ECS::TaskDefinition', {
            "ContainerDefinitions": [
                {
                    "Cpu": 1024,
                    "DependsOn": [
                        {
                            "Condition": "SUCCESS",
                            "ContainerName": "consul-ecs-mesh-init"
                        },
                        {
                            "Condition": "HEALTHY",
                            "ContainerName": "sidecar-proxy"
                        }
                    ],
                    "Environment": [
                        {
                            "Name": "NAME_URL",
                            "Value": "http://localhost:3001"
                        }
                    ],
                    "Essential": true,
                    "Image": "nathanpeck/greeter",
                    "Memory": 2048,
                    "Name": "app",
                    "PortMappings": [
                        {
                            "ContainerPort": 3000,
                            "Protocol": "tcp"
                        }
                    ],
                    "Ulimits": [
                        {
                            "HardLimit": 1024000,
                            "Name": "nofile",
                            "SoftLimit": 1024000
                        }
                    ]
                },
                {
                    "Command": [
                        {
                            "Fn::Join": [
                                "",
                                [
                                    "ECS_IPV4=$(curl -s $ECS_CONTAINER_METADATA_URI | jq -r '.Networks[0].IPv4Addresses[0]') && if [ true == true ]; then                 echo \"{{resolve:secretsmanager:arn:",
                                    {
                                        "Ref": "AWS::Partition"
                                    },
                                    ":secretsmanager:",
                                    {
                                        "Ref": "AWS::Region"
                                    },
                                    ":",
                                    {
                                        "Ref": "AWS::AccountId"
                                    },
                                    ":secret:TLSEncryptValue:SecretString:::}}\" > /tmp/consul-agent-ca-cert.pem;\n                fi &&\n                  exec consul agent                   -advertise $ECS_IPV4                   -data-dir /consul/data                   -client 0.0.0.0                   -hcl 'addresses = { dns = \"127.0.0.1\" }'                   -hcl 'addresses = { grpc = \"127.0.0.1\" }'                   -hcl 'addresses = { http = \"127.0.0.1\" }'                   -retry-join \"provider=aws region=us-west-2 tag_key=Name tag_value=test-consul-server\"                   -hcl 'telemetry { disable_compat_1.9 = true }'                   -hcl 'leave_on_terminate = true'                   -hcl 'ports { grpc = 8502 }'                   -hcl 'advertise_reconnect_timeout = \"15m\"'                   -hcl 'enable_central_service_config = true'                -hcl 'ca_file = \"/tmp/consul-agent-ca-cert.pem\"'                -hcl 'auto_encrypt = {tls = true}'                -hcl \"auto_encrypt = {ip_san = [ \\\"$ECS_IPV4\\\" ]}\"                -hcl 'verify_outgoing = true'             -encrypt \"{{resolve:secretsmanager:arn:",
                                    {
                                        "Ref": "AWS::Partition"
                                    },
                                    ":secretsmanager:",
                                    {
                                        "Ref": "AWS::Region"
                                    },
                                    ":",
                                    {
                                        "Ref": "AWS::AccountId"
                                    },
                                    ":secret:gossipEncryptValue:SecretString:::}}\""
                                ]
                            ]
                        }
                    ],
                    "EntryPoint": [
                        "/bin/sh",
                        "-ec"
                    ],
                    "Essential": false,
                    "Image": "myCustomConsulClientImage:1.0",
                    "LogConfiguration": {
                        "LogDriver": "awslogs",
                        "Options": {
                            "awslogs-group": {
                                "Ref": "greetertaskdefinitionconsulclientLogGroup99EB1A03"
                            },
                            "awslogs-stream-prefix": "consul-client",
                            "awslogs-region": {
                                "Ref": "AWS::Region"
                            }
                        }
                    },
                    "Memory": 256,
                    "MountPoints": [
                        {
                            "ContainerPath": "/consul/data",
                            "ReadOnly": false,
                            "SourceVolume": "consul-data"
                        },
                        {
                            "ContainerPath": "/consul/config",
                            "ReadOnly": false,
                            "SourceVolume": "consul-config"
                        }
                    ],
                    "Name": "consul-client",
                    "PortMappings": [
                        {
                            "ContainerPort": 8301,
                            "Protocol": "tcp"
                        },
                        {
                            "ContainerPort": 8301,
                            "Protocol": "udp"
                        },
                        {
                            "ContainerPort": 8500,
                            "Protocol": "tcp"
                        }
                    ]
                },
                {
                    "Command": [
                        "mesh-init",
                        "-envoy-bootstrap-file=/consul/data/envoy-bootstrap.json",
                        "-port=3000",
                        "-upstreams=name:3001"
                    ],
                    "Essential": false,
                    "Image": "myCustomConsulEcsImage:1.0",
                    "LogConfiguration": {
                        "LogDriver": "awslogs",
                        "Options": {
                            "awslogs-group": {
                                "Ref": "greetertaskdefinitionconsulecsmeshinitLogGroup614BD5D5"
                            },
                            "awslogs-stream-prefix": "consul-ecs-mesh-init",
                            "awslogs-region": {
                                "Ref": "AWS::Region"
                            }
                        }
                    },
                    "Memory": 256,
                    "MountPoints": [
                        {
                            "ContainerPath": "/consul/data",
                            "ReadOnly": false,
                            "SourceVolume": "consul-data"
                        }
                    ],
                    "Name": "consul-ecs-mesh-init",
                    "User": "root"
                },
                {
                    "Command": [
                        "envoy --config-path /consul/data/envoy-bootstrap.json"
                    ],
                    "DependsOn": [
                        {
                            "Condition": "SUCCESS",
                            "ContainerName": "consul-ecs-mesh-init"
                        }
                    ],
                    "EntryPoint": [
                        "/bin/sh",
                        "-c"
                    ],
                    "Essential": false,
                    "HealthCheck": {
                        "Command": [
                            "CMD",
                            "nc",
                            "-z",
                            "127.0.0.1",
                            "20000"
                        ],
                        "Interval": 30,
                        "Retries": 3,
                        "Timeout": 5
                    },
                    "Image": "myCustomEnvoyImage:1.0",
                    "LogConfiguration": {
                        "LogDriver": "awslogs",
                        "Options": {
                            "awslogs-group": {
                                "Ref": "greetertaskdefinitionsidecarproxyLogGroup928001EA"
                            },
                            "awslogs-stream-prefix": "envoy",
                            "awslogs-region": {
                                "Ref": "AWS::Region"
                            }
                        }
                    },
                    "Memory": 256,
                    "MountPoints": [
                        {
                            "ContainerPath": "/consul/data",
                            "ReadOnly": false,
                            "SourceVolume": "consul-data"
                        }
                    ],
                    "Name": "sidecar-proxy",
                    "PortMappings": [
                        {
                            "ContainerPort": 20000,
                            "Protocol": "tcp"
                        }
                    ]
                }
            ],
            "Cpu": "1024",
            "ExecutionRoleArn": {
                "Fn::GetAtt": [
                    "greetertaskdefinitionExecutionRoleAED0EC79",
                    "Arn"
                ]
            },
            "Family": "greeter",
            "Memory": "2048",
            "NetworkMode": "awsvpc",
            "RequiresCompatibilities": [
                "EC2",
                "FARGATE"
            ],
            "TaskRoleArn": {
                "Fn::GetAtt": [
                    "greetertaskdefinitionTaskRole2A098ACC",
                    "Arn"
                ]
            },
            "Volumes": [
                {
                    "Name": "consul-data"
                },
                {
                    "Name": "consul-config"
                }
            ]
        }));
        assert_1.expect(stack).to(assert_1.haveResource('AWS::ECS::TaskDefinition', {
            "ContainerDefinitions": [
                {
                    "Cpu": 1024,
                    "DependsOn": [
                        {
                            "Condition": "SUCCESS",
                            "ContainerName": "consul-ecs-mesh-init"
                        },
                        {
                            "Condition": "HEALTHY",
                            "ContainerName": "sidecar-proxy"
                        }
                    ],
                    "Essential": true,
                    "Image": "nathanpeck/name",
                    "Memory": 2048,
                    "Name": "app",
                    "PortMappings": [
                        {
                            "ContainerPort": 3000,
                            "Protocol": "tcp"
                        }
                    ],
                    "Ulimits": [
                        {
                            "HardLimit": 1024000,
                            "Name": "nofile",
                            "SoftLimit": 1024000
                        }
                    ]
                },
                {
                    "Command": [
                        {
                            "Fn::Join": [
                                "",
                                [
                                    "ECS_IPV4=$(curl -s $ECS_CONTAINER_METADATA_URI | jq -r '.Networks[0].IPv4Addresses[0]') && if [ true == true ]; then                 echo \"{{resolve:secretsmanager:arn:",
                                    {
                                        "Ref": "AWS::Partition"
                                    },
                                    ":secretsmanager:",
                                    {
                                        "Ref": "AWS::Region"
                                    },
                                    ":",
                                    {
                                        "Ref": "AWS::AccountId"
                                    },
                                    ":secret:TLSEncryptValue:SecretString:::}}\" > /tmp/consul-agent-ca-cert.pem;\n                fi &&\n                  exec consul agent                   -advertise $ECS_IPV4                   -data-dir /consul/data                   -client 0.0.0.0                   -hcl 'addresses = { dns = \"127.0.0.1\" }'                   -hcl 'addresses = { grpc = \"127.0.0.1\" }'                   -hcl 'addresses = { http = \"127.0.0.1\" }'                   -retry-join \"provider=aws region=us-west-2 tag_key=Name tag_value=test-consul-server\"                   -hcl 'telemetry { disable_compat_1.9 = true }'                   -hcl 'leave_on_terminate = true'                   -hcl 'ports { grpc = 8502 }'                   -hcl 'advertise_reconnect_timeout = \"15m\"'                   -hcl 'enable_central_service_config = true'                -hcl 'ca_file = \"/tmp/consul-agent-ca-cert.pem\"'                -hcl 'auto_encrypt = {tls = true}'                -hcl \"auto_encrypt = {ip_san = [ \\\"$ECS_IPV4\\\" ]}\"                -hcl 'verify_outgoing = true'             -encrypt \"{{resolve:secretsmanager:arn:",
                                    {
                                        "Ref": "AWS::Partition"
                                    },
                                    ":secretsmanager:",
                                    {
                                        "Ref": "AWS::Region"
                                    },
                                    ":",
                                    {
                                        "Ref": "AWS::AccountId"
                                    },
                                    ":secret:gossipEncryptValue:SecretString:::}}\""
                                ]
                            ]
                        }
                    ],
                    "EntryPoint": [
                        "/bin/sh",
                        "-ec"
                    ],
                    "Essential": false,
                    "Image": "myCustomConsulClientImage:1.0",
                    "LogConfiguration": {
                        "LogDriver": "awslogs",
                        "Options": {
                            "awslogs-group": {
                                "Ref": "nametaskdefinitionconsulclientLogGroup5C3CC781"
                            },
                            "awslogs-stream-prefix": "consul-client",
                            "awslogs-region": {
                                "Ref": "AWS::Region"
                            }
                        }
                    },
                    "Memory": 256,
                    "MountPoints": [
                        {
                            "ContainerPath": "/consul/data",
                            "ReadOnly": false,
                            "SourceVolume": "consul-data"
                        },
                        {
                            "ContainerPath": "/consul/config",
                            "ReadOnly": false,
                            "SourceVolume": "consul-config"
                        }
                    ],
                    "Name": "consul-client",
                    "PortMappings": [
                        {
                            "ContainerPort": 8301,
                            "Protocol": "tcp"
                        },
                        {
                            "ContainerPort": 8301,
                            "Protocol": "udp"
                        },
                        {
                            "ContainerPort": 8500,
                            "Protocol": "tcp"
                        }
                    ]
                },
                {
                    "Command": [
                        "mesh-init",
                        "-envoy-bootstrap-file=/consul/data/envoy-bootstrap.json",
                        "-port=3000",
                        "-upstreams="
                    ],
                    "Essential": false,
                    "Image": "myCustomConsulEcsImage:1.0",
                    "LogConfiguration": {
                        "LogDriver": "awslogs",
                        "Options": {
                            "awslogs-group": {
                                "Ref": "nametaskdefinitionconsulecsmeshinitLogGroupBE13525A"
                            },
                            "awslogs-stream-prefix": "consul-ecs-mesh-init",
                            "awslogs-region": {
                                "Ref": "AWS::Region"
                            }
                        }
                    },
                    "Memory": 256,
                    "MountPoints": [
                        {
                            "ContainerPath": "/consul/data",
                            "ReadOnly": false,
                            "SourceVolume": "consul-data"
                        }
                    ],
                    "Name": "consul-ecs-mesh-init",
                    "User": "root"
                },
                {
                    "Command": [
                        "envoy --config-path /consul/data/envoy-bootstrap.json"
                    ],
                    "DependsOn": [
                        {
                            "Condition": "SUCCESS",
                            "ContainerName": "consul-ecs-mesh-init"
                        }
                    ],
                    "EntryPoint": [
                        "/bin/sh",
                        "-c"
                    ],
                    "Essential": false,
                    "HealthCheck": {
                        "Command": [
                            "CMD",
                            "nc",
                            "-z",
                            "127.0.0.1",
                            "20000"
                        ],
                        "Interval": 30,
                        "Retries": 3,
                        "Timeout": 5
                    },
                    "Image": "myCustomEnvoyImage:1.0",
                    "LogConfiguration": {
                        "LogDriver": "awslogs",
                        "Options": {
                            "awslogs-group": {
                                "Ref": "nametaskdefinitionsidecarproxyLogGroup1F5889C2"
                            },
                            "awslogs-stream-prefix": "envoy",
                            "awslogs-region": {
                                "Ref": "AWS::Region"
                            }
                        }
                    },
                    "Memory": 256,
                    "MountPoints": [
                        {
                            "ContainerPath": "/consul/data",
                            "ReadOnly": false,
                            "SourceVolume": "consul-data"
                        }
                    ],
                    "Name": "sidecar-proxy",
                    "PortMappings": [
                        {
                            "ContainerPort": 20000,
                            "Protocol": "tcp"
                        }
                    ]
                }
            ],
            "Cpu": "1024",
            "ExecutionRoleArn": {
                "Fn::GetAtt": [
                    "nametaskdefinitionExecutionRole45AC5C9A",
                    "Arn"
                ]
            },
            "Family": "name",
            "Memory": "2048",
            "NetworkMode": "awsvpc",
            "RequiresCompatibilities": [
                "EC2",
                "FARGATE"
            ],
            "TaskRoleArn": {
                "Fn::GetAtt": [
                    "nametaskdefinitionTaskRole50FE844E",
                    "Arn"
                ]
            },
            "Volumes": [
                {
                    "Name": "consul-data"
                },
                {
                    "Name": "consul-config"
                }
            ]
        }));
        assert_1.expect(stack).to(assert_1.haveResource('AWS::ECS::Service', {
            "Cluster": {
                "Ref": "productionenvironmentclusterC6599D2D"
            },
            "DeploymentConfiguration": {
                "MaximumPercent": 200,
                "MinimumHealthyPercent": 100
            },
            "DesiredCount": 1,
            "EnableECSManagedTags": false,
            "LaunchType": "FARGATE",
            "NetworkConfiguration": {
                "AwsvpcConfiguration": {
                    "AssignPublicIp": "DISABLED",
                    "SecurityGroups": [
                        {
                            "Fn::GetAtt": [
                                "nameserviceSecurityGroup33F4662C",
                                "GroupId"
                            ]
                        },
                        {
                            "Fn::GetAtt": [
                                "consulClientSecurityGroup279D3373",
                                "GroupId"
                            ]
                        }
                    ],
                    "Subnets": [
                        {
                            "Ref": "productionenvironmentvpcPrivateSubnet1Subnet53F632E6"
                        },
                        {
                            "Ref": "productionenvironmentvpcPrivateSubnet2Subnet756FB93C"
                        }
                    ]
                }
            },
            "TaskDefinition": {
                "Ref": "nametaskdefinition690762BB"
            }
        }));
        assert_1.expect(stack).to(assert_1.haveResource('AWS::ECS::Service', {
            "Cluster": {
                "Ref": "productionenvironmentclusterC6599D2D"
            },
            "DeploymentConfiguration": {
                "MaximumPercent": 200,
                "MinimumHealthyPercent": 100
            },
            "DesiredCount": 1,
            "EnableECSManagedTags": false,
            "LaunchType": "FARGATE",
            "NetworkConfiguration": {
                "AwsvpcConfiguration": {
                    "AssignPublicIp": "DISABLED",
                    "SecurityGroups": [
                        {
                            "Fn::GetAtt": [
                                "greeterserviceSecurityGroupDB4AC3A9",
                                "GroupId"
                            ]
                        },
                        {
                            "Fn::GetAtt": [
                                "consulClientSecurityGroup279D3373",
                                "GroupId"
                            ]
                        }
                    ],
                    "Subnets": [
                        {
                            "Ref": "productionenvironmentvpcPrivateSubnet1Subnet53F632E6"
                        },
                        {
                            "Ref": "productionenvironmentvpcPrivateSubnet2Subnet756FB93C"
                        }
                    ]
                }
            },
            "TaskDefinition": {
                "Ref": "greetertaskdefinitionE956EEA2"
            }
        }));
    });
    test('should detect when attempting to connect services from two different envs', () => {
        // GIVEN
        const stack = new cdk.Stack();
        // WHEN
        const production = new ecs_service_extensions_1.Environment(stack, 'production');
        const development = new ecs_service_extensions_1.Environment(stack, 'development');
        const consulSecurityGroup = new ec2.SecurityGroup(stack, 'consulServerSecurityGroup', {
            vpc: production.vpc
        });
        const consulClientSercurityGroup = new ec2.SecurityGroup(stack, 'consulClientSecurityGroup', {
            vpc: production.vpc
        });
        consulClientSercurityGroup.addIngressRule(consulClientSercurityGroup, ec2.Port.tcp(8301), "allow all the clients in the mesh talk to each other");
        consulClientSercurityGroup.addIngressRule(consulClientSercurityGroup, ec2.Port.udp(8301), "allow all the clients in the mesh talk to each other");
        const nameDescription = new ecs_service_extensions_1.ServiceDescription();
        nameDescription.add(new ecs_service_extensions_1.Container({
            cpu: 1024,
            memoryMiB: 2048,
            trafficPort: 3000,
            image: ecs.ContainerImage.fromRegistry('nathanpeck/name')
        }));
        nameDescription.add(new consul_mesh_extension_1.ConsulMeshExtension({
            retryJoin: "provider=aws region=us-west-2 tag_key=Name tag_value=test-consul-server",
            consulServerSercurityGroup: consulSecurityGroup,
            port: 3000,
            consulClientImage: "myCustomConsulClientImage:1.0",
            consulEcsImage: "myCustomConsulEcsImage:1.0",
            envoyProxyImage: "myCustomEnvoyImage:1.0",
            consulClientSercurityGroup,
            family: "name"
        }));
        const nameService = new ecs_service_extensions_1.Service(stack, 'name', {
            environment: development,
            serviceDescription: nameDescription
        });
        // launch service into that cluster
        const greeterDescription = new ecs_service_extensions_1.ServiceDescription();
        greeterDescription.add(new ecs_service_extensions_1.Container({
            cpu: 1024,
            memoryMiB: 2048,
            trafficPort: 3000,
            image: ecs.ContainerImage.fromRegistry('nathanpeck/greeter')
        }));
        greeterDescription.add(new consul_mesh_extension_1.ConsulMeshExtension({
            retryJoin: "provider=aws region=us-west-2 tag_key=Name tag_value=test-consul-server",
            consulServerSercurityGroup: consulSecurityGroup,
            port: 3000,
            consulClientImage: "myCustomConsulClientImage:1.0",
            consulEcsImage: "myCustomConsulEcsImage:1.0",
            envoyProxyImage: "myCustomEnvoyImage:1.0",
            consulClientSercurityGroup,
            family: "greeter"
        }));
        const greeterService = new ecs_service_extensions_1.Service(stack, 'greeter', {
            environment: production,
            serviceDescription: greeterDescription,
        });
        // THEN
        expect(() => {
            greeterService.connectTo(nameService);
        }).toThrow("Unable to connect services from different environments");
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uc3VsLWV4dGVuc2lvbi50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY29uc3VsLWV4dGVuc2lvbi50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsNENBQW9FO0FBQ3BFLHFDQUFxQztBQUNyQyx1RkFBaUg7QUFDakgsd0NBQXdDO0FBQ3hDLHdFQUFtRTtBQUNuRSx3Q0FBd0M7QUFDeEMsd0NBQXNDO0FBQ3RDLDhEQUE4RDtBQUU5RCxRQUFRLENBQUMsWUFBWSxFQUFFLEdBQUcsRUFBRTtJQUM1QixJQUFJLENBQUMsb0NBQW9DLEVBQUUsR0FBRyxFQUFFO1FBQzlDLE9BQU87UUFDUCxNQUFNLEtBQUssR0FBRyxJQUFJLFlBQUssRUFBRSxDQUFDO1FBQzFCLFFBQVE7UUFDUixNQUFNLFdBQVcsR0FBRyxJQUFJLG9DQUFXLENBQUMsS0FBSyxFQUFFLFlBQVksQ0FBQyxDQUFDO1FBRXpELE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxHQUFHLENBQUMsYUFBYSxDQUFDLEtBQUssRUFBRSwyQkFBMkIsRUFBRTtZQUNwRixHQUFHLEVBQUUsV0FBVyxDQUFDLEdBQUc7U0FDckIsQ0FBQyxDQUFDO1FBRUgsTUFBTSwwQkFBMEIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxhQUFhLENBQUMsS0FBSyxFQUFFLDJCQUEyQixFQUFFO1lBQzNGLEdBQUcsRUFBRSxXQUFXLENBQUMsR0FBRztTQUNyQixDQUFDLENBQUM7UUFFSCxNQUFNLFNBQVMsR0FBRyxjQUFjLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUN0RCxLQUFLLEVBQ0wsZUFBZSxFQUNmLGlCQUFpQixDQUNsQixDQUFDO1FBRUYsTUFBTSxnQkFBZ0IsR0FBRyxjQUFjLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUM3RCxLQUFLLEVBQ0wsa0JBQWtCLEVBQ2xCLG9CQUFvQixDQUNyQixDQUFDO1FBRUYsMEJBQTBCLENBQUMsY0FBYyxDQUN2QywwQkFBMEIsRUFDMUIsR0FBRyxDQUFDLElB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QUFFLHlFQUF5RTtZQUNwRiwwQkFBMEIsRUFBRSxtQkFBbUI7WUFDL0MsSUFBSSxFQUFFLElBQUk7WUFDVixpQkFBaUIsRUFBRSwrQkFBK0I7WUFDbEQsY0FBYyxFQUFFLDRCQUE0QjtZQUM1QyxlQUFlLEVBQUUsd0JBQXdCO1lBQ3pDLDBCQUEwQjtZQUMxQixNQUFNLEVBQUUsU0FBUztTQUNsQixDQUFDLENBQUMsQ0FBQztRQUVKLE1BQU0sY0FBYyxHQUFHLElBQUksZ0NBQU8sQ0FBQyxLQUFLLEVBQUUsU0FBUyxFQUFFO1lBQ25ELFdBQVcsRUFBRSxVQUFVO1lBQ3ZCLGtCQUFrQixFQUFFLGtCQUFrQjtTQUN2QyxDQUFDLENBQUM7UUFFSCxPQUFPO1FBQ1AsTUFBTSxDQUFDLEdBQUcsRUFBRTtZQUNWLGNBQWMsQ0FBQyxTQUFTLENBQUMsV0FBVyxDQUFDLENBQUM7UUFDeEMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLHdEQUF3RCxDQUFDLENBQUM7SUFFdkUsQ0FBQyxDQUFDLENBQUM7QUFFSCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGV4cGVjdCBhcyBleHBlY3RDREssIGhhdmVSZXNvdXJjZSB9IGZyb20gJ0Bhd3MtY2RrL2Fzc2VydCc7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnQGF3cy1jZGsvY29yZSc7XG5pbXBvcnQgeyBFbnZpcm9ubWVudCwgU2VydmljZURlc2NyaXB0aW9uLCBDb250YWluZXIsIFNlcnZpY2UgfSBmcm9tICdAYXdzLWNkay1jb250YWluZXJzL2Vjcy1zZXJ2aWNlLWV4dGVuc2lvbnMnO1xuaW1wb3J0ICogYXMgZWNzIGZyb20gJ0Bhd3MtY2RrL2F3cy1lY3MnO1xuaW1wb3J0IHsgQ29uc3VsTWVzaEV4dGVuc2lvbiB9IGZyb20gJy4uL2xpYi9jb25zdWwtbWVzaC1leHRlbnNpb24nO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ0Bhd3MtY2RrL2F3cy1lYzInO1xuaW1wb3J0IHsgU3RhY2sgfSBmcm9tICdAYXdzLWNkay9jb3JlJztcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ0Bhd3MtY2RrL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5cbmRlc2NyaWJlKCdjb25zdWxtZXNoJywgKCkgPT4ge1xudGVzdCgnVGVzdCBleHRlbnNpb24gd2l0aCBkZWZhdWx0IHBhcmFtcycsICgpID0+IHtcbiAgLy8gV0hFTlxuICBjb25zdCBzdGFjayA9IG5ldyBTdGFjaygpO1xuICAvLyBHSVZFTlxuICBjb25zdCBlbnZpcm9ubWVudCA9IG5ldyBFbnZpcm9ubWVudChzdGFjaywgJ3Byb2R1Y3Rpb24nKTtcblxuICBjb25zdCBjb25zdWxTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHN0YWNrLCAnY29uc3VsU2VydmVyU2VjdXJpdHlHcm91cCcsIHtcbiAgICB2cGM6IGVudmlyb25tZW50LnZwY1xuICB9KTtcblxuICBjb25zdCBjb25zdWxDbGllbnRTZXJjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cChzdGFjaywgJ2NvbnN1bENsaWVudFNlY3VyaXR5R3JvdXAnLCB7XG4gICAgdnBjOiBlbnZpcm9ubWVudC52cGNcbiAgfSk7XG5cbiAgY29uc3QgVExTU2VjcmV0ID0gc2VjcmV0c21hbmFnZXIuU2VjcmV0LmZyb21TZWNyZXROYW1lVjIoXG4gICAgc3RhY2ssXG4gICAgJ1RMU0VuY3J5cHRLZXknLFxuICAgICdUTFNFbmNyeXB0VmFsdWUnLFxuICApO1xuXG4gIGNvbnN0IGdvc3NpcEVuY3J5cHRLZXkgPSBzZWNyZXRzbWFuYWdlci5TZWNyZXQuZnJvbVNlY3JldE5hbWVWMihcbiAgICBzdGFjayxcbiAgICAnZ29zc2lwRW5jcnlwdEtleScsXG4gICAgJ2dvc3NpcEVuY3J5cHRWYWx1ZScsXG4gICk7XG5cbiAgY29uc3VsQ2xpZW50U2VyY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgY29uc3VsQ2xpZW50U2VyY3VyaXR5R3JvdXAsXG4gICAgZWMyLlBvcnQudGNwKDgzMDEpLFxuICAgIFwiYWxsb3cgYWxsIHRoZSBjbGllbnRzIGluIHRoZSBtZXNoIHRhbGsgdG8gZWFjaCBvdGhlclwiXG4gICk7XG4gIGNvbnN1bENsaWVudFNlcmN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgIGNvbnN1bENsaWVudFNlcmN1cml0eUdyb3VwLFxuICAgIGVjMi5Qb3J0LnVkcCg4MzAxKSxcbiAgICBcImFsbG93IGFsbCB0aGUgY2xpZW50cyBpbiB0aGUgbWVzaCB0YWxrIHRvIGVhY2ggb3RoZXJcIlxuICApXG5cbiAgY29uc3QgbmFtZURlc2NyaXB0aW9uID0gbmV3IFNlcnZpY2VEZXNjcmlwdGlvbigpO1xuICBuYW1lRGVzY3JpcHRpb24uYWRkKG5ldyBDb250YWluZXIoe1xuICAgIGNwdTogMTAyNCxcbiAgICBtZW1vcnlNaUI6IDIwNDgsXG4gICAgdHJhZmZpY1BvcnQ6IDMwMDAsXG4gICAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZS5mcm9tUmVnaXN0cnkoJ25hdGhhbnBlY2svbmFtZScpXG4gIH0pKTtcblxuICBuYW1lRGVzY3JpcHRpb24uYWRkKG5ldyBDb25zdWxNZXNoRXh0ZW5zaW9uKHtcbiAgICByZXRyeUpvaW46IFwicHJvdmlkZXI9YXdzIHJlZ2lvbj11cy13ZXN0LTIgdGFnX2tleT1OYW1lIHRhZ192YWx1ZT10ZXN0LWNvbnN1bC1zZXJ2ZXJcIixcbiAgICBjb25zdWxTZXJ2ZXJTZXJjdXJpdHlHcm91cDogY29uc3VsU2VjdXJpdHlHcm91cCxcbiAgICBwb3J0OiAzMDAwLFxuICAgIGNvbnN1bENsaWVudFNlcmN1cml0eUdyb3VwLFxuICAgIGZhbWlseTogXCJuYW1lXCIsXG4gICAgdGxzOiB0cnVlLFxuICAgIGNvbnN1bENBQ2VydDogVExTU2VjcmV0LFxuICAgIGdvc3NpcEVuY3J5cHRLZXlcbiAgfSkpO1xuXG4gIGNvbnN0IG5hbWVTZXJ2aWNlID0gbmV3IFNlcnZpY2Uoc3RhY2ssICduYW1lJywge1xuICAgIGVudmlyb25tZW50OiBlbnZpcm9ubWVudCxcbiAgICBzZXJ2aWNlRGVzY3JpcHRpb246IG5hbWVEZXNjcmlwdGlvblxuICB9KTtcblxuICAvLyBsYXVuY2ggc2VydmljZSBpbnRvIHRoYXQgY2x1c3RlclxuICBjb25zdCBncmVldGVyRGVzY3JpcHRpb24gPSBuZXcgU2VydmljZURlc2NyaXB0aW9uKCk7XG4gIGdyZWV0ZXJEZXNjcmlwdGlvbi5hZGQobmV3IENvbnRhaW5lcih7XG4gICAgY3B1OiAxMDI0LFxuICAgIG1lbW9yeU1pQjogMjA0OCxcbiAgICB0cmFmZmljUG9ydDogMzAwMCxcbiAgICBpbWFnZTogZWNzLkNvbnRhaW5lckltYWdlLmZyb21SZWdpc3RyeSgnbmF0aGFucGVjay9ncmVldGVyJylcbiAgfSkpO1xuXG4gIGdyZWV0ZXJEZXNjcmlwdGlvbi5hZGQobmV3IENvbnN1bE1lc2hFeHRlbnNpb24oe1xuICAgIHJldHJ5Sm9pbjogXCJwcm92aWRlcj1hd3MgcmVnaW9uPXVzLXdlc3QtMiB0YWdfa2V5PU5hbWUgdGFnX3ZhbHVlPXRlc3QtY29uc3VsLXNlcnZlclwiLCAvLyB1c2UgaW50ZXJmYWNlLCB1c2UgRU5VTXNcbiAgICBjb25zdWxTZXJ2ZXJTZXJjdXJpdHlHcm91cDogY29uc3VsU2VjdXJpdHlHcm91cCxcbiAgICBwb3J0OiAzMDAwLFxuICAgIGNvbnN1bENsaWVudFNlcmN1cml0eUdyb3VwLFxuICAgIGZhbWlseTogXCJncmVldGVyXCIsXG4gICAgdGxzOiB0cnVlLFxuICAgIGNvbnN1bENBQ2VydDogVExTU2VjcmV0LFxuICAgIGdvc3NpcEVuY3J5cHRLZXlcbiAgfSkpO1xuXG4gIGNvbnN0IGdyZWV0ZXJTZXJ2aWNlID0gbmV3IFNlcnZpY2Uoc3RhY2ssICdncmVldGVyJywge1xuICAgIGVudmlyb25tZW50OiBlbnZpcm9ubWVudCxcbiAgICBzZXJ2aWNlRGVzY3JpcHRpb246IGdyZWV0ZXJEZXNjcmlwdGlvblxuICB9KTtcblxuICBncmVldGVyU2VydmljZS5jb25uZWN0VG8obmFtZVNlcnZpY2UpXG5cbiAgLy9USEVOXG4gIGV4cGVjdENESyhzdGFjaykudG8oaGF2ZVJlc291cmNlKCdBV1M6OkVDUzo6VGFza0RlZmluaXRpb24nLCB7XG4gICAgXCJDb250YWluZXJEZWZpbml0aW9uc1wiOiBbXG4gICAgICB7XG4gICAgICAgIFwiQ3B1XCI6IDEwMjQsXG4gICAgICAgIFwiRGVwZW5kc09uXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbmRpdGlvblwiOiBcIlNVQ0NFU1NcIixcbiAgICAgICAgICAgIFwiQ29udGFpbmVyTmFtZVwiOiBcImNvbnN1bC1lY3MtbWVzaC1pbml0XCJcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiQ29uZGl0aW9uXCI6IFwiSEVBTFRIWVwiLFxuICAgICAgICAgICAgXCJDb250YWluZXJOYW1lXCI6IFwic2lkZWNhci1wcm94eVwiXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBcIkVudmlyb25tZW50XCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIk5hbWVcIjogXCJOQU1FX1VSTFwiLFxuICAgICAgICAgICAgXCJWYWx1ZVwiOiBcImh0dHA6Ly9sb2NhbGhvc3Q6MzAwMVwiXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBcIkVzc2VudGlhbFwiOiB0cnVlLFxuICAgICAgICBcIkltYWdlXCI6IFwibmF0aGFucGVjay9ncmVldGVyXCIsXG4gICAgICAgIFwiTWVtb3J5XCI6IDIwNDgsXG4gICAgICAgIFwiTmFtZVwiOiBcImFwcFwiLFxuICAgICAgICBcIlBvcnRNYXBwaW5nc1wiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb250YWluZXJQb3J0XCI6IDMwMDAsXG4gICAgICAgICAgICBcIlByb3RvY29sXCI6IFwidGNwXCJcbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIFwiVWxpbWl0c1wiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJIYXJkTGltaXRcIjogMTAyNDAwMCxcbiAgICAgICAgICAgIFwiTmFtZVwiOiBcIm5vZmlsZVwiLFxuICAgICAgICAgICAgXCJTb2Z0TGltaXRcIjogMTAyNDAwMFxuICAgICAgICAgIH1cbiAgICAgICAgXVxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgXCJDb21tYW5kXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkZuOjpKb2luXCI6IFtcbiAgICAgICAgICAgICAgXCJcIixcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIFwiRUNTX0lQVjQ9JChjdXJsIC1zICRFQ1NfQ09OVEFJTkVSX01FVEFEQVRBX1VSSSB8IGpxIC1yICcuTmV0d29ya3NbMF0uSVB2NEFkZHJlc3Nlc1swXScpICYmIGlmIFsgdHJ1ZSA9PSB0cnVlIF07IHRoZW4gICAgICAgICAgICAgICAgIGVjaG8gXFxcInt7cmVzb2x2ZTpzZWNyZXRzbWFuYWdlcjphcm46XCIsXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgXCJSZWZcIjogXCJBV1M6OlBhcnRpdGlvblwiXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBcIjpzZWNyZXRzbWFuYWdlcjpcIixcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBcIlJlZlwiOiBcIkFXUzo6UmVnaW9uXCJcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIFwiOlwiLFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIFwiUmVmXCI6IFwiQVdTOjpBY2NvdW50SWRcIlxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXCI6c2VjcmV0OlRMU0VuY3J5cHRWYWx1ZTpTZWNyZXRTdHJpbmc6Ojp9fVxcXCIgPiAvdG1wL2NvbnN1bC1hZ2VudC1jYS1jZXJ0LnBlbTtcXG4gICAgICAgICAgICAgICAgZmkgJiZcXG4gICAgICAgICAgICAgICAgICBleGVjIGNvbnN1bCBhZ2VudCAgICAgICAgICAgICAgICAgICAtYWR2ZXJ0aXNlICRFQ1NfSVBWNCAgICAgICAgICAgICAgICAgICAtZGF0YS1kaXIgL2NvbnN1bC9kYXRhICAgICAgICAgICAgICAgICAgIC1jbGllbnQgMC4wLjAuMCAgICAgICAgICAgICAgICAgICAtaGNsICdhZGRyZXNzZXMgPSB7IGRucyA9IFxcXCIxMjcuMC4wLjFcXFwiIH0nICAgICAgICAgICAgICAgICAgIC1oY2wgJ2FkZHJlc3NlcyA9IHsgZ3JwYyA9IFxcXCIxMjcuMC4wLjFcXFwiIH0nICAgICAgICAgICAgICAgICAgIC1oY2wgJ2FkZHJlc3NlcyA9IHsgaHR0cCA9IFxcXCIxMjcuMC4wLjFcXFwiIH0nICAgICAgICAgICAgICAgICAgIC1yZXRyeS1qb2luIFxcXCJwcm92aWRlcj1hd3MgcmVnaW9uPXVzLXdlc3QtMiB0YWdfa2V5PU5hbWUgdGFnX3ZhbHVlPXRlc3QtY29uc3VsLXNlcnZlclxcXCIgICAgICAgICAgICAgICAgICAgLWhjbCAndGVsZW1ldHJ5IHsgZGlzYWJsZV9jb21wYXRfMS45ID0gdHJ1ZSB9JyAgICAgICAgICAgICAgICAgICAtaGNsICdsZWF2ZV9vbl90ZXJtaW5hdGUgPSB0cnVlJyAgICAgICAgICAgICAgICAgICAtaGNsICdwb3J0cyB7IGdycGMgPSA4NTAyIH0nICAgICAgICAgICAgICAgICAgIC1oY2wgJ2FkdmVydGlzZV9yZWNvbm5lY3RfdGltZW91dCA9IFxcXCIxNW1cXFwiJyAgICAgICAgICAgICAgICAgICAtaGNsICdlbmFibGVfY2VudHJhbF9zZXJ2aWNlX2NvbmZpZyA9IHRydWUnICAgICAgICAgICAgICAgIC1oY2wgJ2NhX2ZpbGUgPSBcXFwiL3RtcC9jb25zdWwtYWdlbnQtY2EtY2VydC5wZW1cXFwiJyAgICAgICAgICAgICAgICAtaGNsICdhdXRvX2VuY3J5cHQgPSB7dGxzID0gdHJ1ZX0nICAgICAgICAgICAgICAgIC1oY2wgXFxcImF1dG9fZW5jcnlwdCA9IHtpcF9zYW4gPSBbIFxcXFxcXFwiJEVDU19JUFY0XFxcXFxcXCIgXX1cXFwiICAgICAgICAgICAgICAgIC1oY2wgJ3ZlcmlmeV9vdXRnb2luZyA9IHRydWUnICAgICAgICAgICAgIC1lbmNyeXB0IFxcXCJ7e3Jlc29sdmU6c2VjcmV0c21hbmFnZXI6YXJuOlwiLFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIFwiUmVmXCI6IFwiQVdTOjpQYXJ0aXRpb25cIlxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXCI6c2VjcmV0c21hbmFnZXI6XCIsXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgXCJSZWZcIjogXCJBV1M6OlJlZ2lvblwiXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBcIjpcIixcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBcIlJlZlwiOiBcIkFXUzo6QWNjb3VudElkXCJcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIFwiOnNlY3JldDpnb3NzaXBFbmNyeXB0VmFsdWU6U2VjcmV0U3RyaW5nOjo6fX1cXFwiXCJcbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgXVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgXCJFbnRyeVBvaW50XCI6IFtcbiAgICAgICAgICBcIi9iaW4vc2hcIixcbiAgICAgICAgICBcIi1lY1wiXG4gICAgICAgIF0sXG4gICAgICAgIFwiRXNzZW50aWFsXCI6IGZhbHNlLFxuICAgICAgICBcIkltYWdlXCI6IFwiaGFzaGljb3JwL2NvbnN1bDoxLjkuNVwiLFxuICAgICAgICBcIkxvZ0NvbmZpZ3VyYXRpb25cIjoge1xuICAgICAgICAgIFwiTG9nRHJpdmVyXCI6IFwiYXdzbG9nc1wiLFxuICAgICAgICAgIFwiT3B0aW9uc1wiOiB7XG4gICAgICAgICAgICBcImF3c2xvZ3MtZ3JvdXBcIjoge1xuICAgICAgICAgICAgICBcIlJlZlwiOiBcImdyZWV0ZXJ0YXNrZGVmaW5pdGlvbmNvbnN1bGNsaWVudExvZ0dyb3VwOTlFQjFBMDNcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiYXdzbG9ncy1zdHJlYW0tcHJlZml4XCI6IFwiY29uc3VsLWNsaWVudFwiLFxuICAgICAgICAgICAgXCJhd3Nsb2dzLXJlZ2lvblwiOiB7XG4gICAgICAgICAgICAgIFwiUmVmXCI6IFwiQVdTOjpSZWdpb25cIlxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXCJNZW1vcnlcIjogMjU2LFxuICAgICAgICBcIk1vdW50UG9pbnRzXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbnRhaW5lclBhdGhcIjogXCIvY29uc3VsL2RhdGFcIixcbiAgICAgICAgICAgIFwiUmVhZE9ubHlcIjogZmFsc2UsXG4gICAgICAgICAgICBcIlNvdXJjZVZvbHVtZVwiOiBcImNvbnN1bC1kYXRhXCJcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiQ29udGFpbmVyUGF0aFwiOiBcIi9jb25zdWwvY29uZmlnXCIsXG4gICAgICAgICAgICBcIlJlYWRPbmx5XCI6IGZhbHNlLFxuICAgICAgICAgICAgXCJTb3VyY2VWb2x1bWVcIjogXCJjb25zdWwtY29uZmlnXCJcbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIFwiTmFtZVwiOiBcImNvbnN1bC1jbGllbnRcIixcbiAgICAgICAgXCJQb3J0TWFwcGluZ3NcIjogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiQ29udGFpbmVyUG9ydFwiOiA4MzAxLFxuICAgICAgICAgICAgXCJQcm90b2NvbFwiOiBcInRjcFwiXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbnRhaW5lclBvcnRcIjogODMwMSxcbiAgICAgICAgICAgIFwiUHJvdG9jb2xcIjogXCJ1ZHBcIlxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb250YWluZXJQb3J0XCI6IDg1MDAsXG4gICAgICAgICAgICBcIlByb3RvY29sXCI6IFwidGNwXCJcbiAgICAgICAgICB9XG4gICAgICAgIF1cbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIFwiQ29tbWFuZFwiOiBbXG4gICAgICAgICAgXCJtZXNoLWluaXRcIixcbiAgICAgICAgICBcIi1lbnZveS1ib290c3RyYXAtZmlsZT0vY29uc3VsL2RhdGEvZW52b3ktYm9vdHN0cmFwLmpzb25cIixcbiAgICAgICAgICBcIi1wb3J0PTMwMDBcIixcbiAgICAgICAgICBcIi11cHN0cmVhbXM9bmFtZTozMDAxXCJcbiAgICAgICAgXSxcbiAgICAgICAgXCJFc3NlbnRpYWxcIjogZmFsc2UsXG4gICAgICAgIFwiSW1hZ2VcIjogXCJoYXNoaWNvcnAvY29uc3VsLWVjczowLjEuMlwiLFxuICAgICAgICBcIkxvZ0NvbmZpZ3VyYXRpb25cIjoge1xuICAgICAgICAgIFwiTG9nRHJpdmVyXCI6IFwiYXdzbG9nc1wiLFxuICAgICAgICAgIFwiT3B0aW9uc1wiOiB7XG4gICAgICAgICAgICBcImF3c2xvZ3MtZ3JvdXBcIjoge1xuICAgICAgICAgICAgICBcIlJlZlwiOiBcImdyZWV0ZXJ0YXNrZGVmaW5pdGlvbmNvbnN1bGVjc21lc2hpbml0TG9nR3JvdXA2MTRCRDVENVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJhd3Nsb2dzLXN0cmVhbS1wcmVmaXhcIjogXCJjb25zdWwtZWNzLW1lc2gtaW5pdFwiLFxuICAgICAgICAgICAgXCJhd3Nsb2dzLXJlZ2lvblwiOiB7XG4gICAgICAgICAgICAgIFwiUmVmXCI6IFwiQVdTOjpSZWdpb25cIlxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXCJNZW1vcnlcIjogMjU2LFxuICAgICAgICBcIk1vdW50UG9pbnRzXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbnRhaW5lclBhdGhcIjogXCIvY29uc3VsL2RhdGFcIixcbiAgICAgICAgICAgIFwiUmVhZE9ubHlcIjogZmFsc2UsXG4gICAgICAgICAgICBcIlNvdXJjZVZvbHVtZVwiOiBcImNvbnN1bC1kYXRhXCJcbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIFwiTmFtZVwiOiBcImNvbnN1bC1lY3MtbWVzaC1pbml0XCIsXG4gICAgICAgIFwiVXNlclwiOiBcInJvb3RcIlxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgXCJDb21tYW5kXCI6IFtcbiAgICAgICAgICBcImVudm95IC0tY29uZmlnLXBhdGggL2NvbnN1bC9kYXRhL2Vudm95LWJvb3RzdHJhcC5qc29uXCJcbiAgICAgICAgXSxcbiAgICAgICAgXCJEZXBlbmRzT25cIjogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiQ29uZGl0aW9uXCI6IFwiU1VDQ0VTU1wiLFxuICAgICAgICAgICAgXCJDb250YWluZXJOYW1lXCI6IFwiY29uc3VsLWVjcy1tZXNoLWluaXRcIlxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgXCJFbnRyeVBvaW50XCI6IFtcbiAgICAgICAgICBcIi9iaW4vc2hcIixcbiAgICAgICAgICBcIi1jXCJcbiAgICAgICAgXSxcbiAgICAgICAgXCJFc3NlbnRpYWxcIjogZmFsc2UsXG4gICAgICAgIFwiSGVhbHRoQ2hlY2tcIjoge1xuICAgICAgICAgIFwiQ29tbWFuZFwiOiBbXG4gICAgICAgICAgICBcIkNNRFwiLFxuICAgICAgICAgICAgXCJuY1wiLFxuICAgICAgICAgICAgXCItelwiLFxuICAgICAgICAgICAgXCIxMjcuMC4wLjFcIixcbiAgICAgICAgICAgIFwiMjAwMDBcIlxuICAgICAgICAgIF0sXG4gICAgICAgICAgXCJJbnRlcnZhbFwiOiAzMCxcbiAgICAgICAgICBcIlJldHJpZXNcIjogMyxcbiAgICAgICAgICBcIlRpbWVvdXRcIjogNVxuICAgICAgICB9LFxuICAgICAgICBcIkltYWdlXCI6IFwiZW52b3lwcm94eS9lbnZveS1hbHBpbmU6djEuMTYuMlwiLFxuICAgICAgICBcIkxvZ0NvbmZpZ3VyYXRpb25cIjoge1xuICAgICAgICAgIFwiTG9nRHJpdmVyXCI6IFwiYXdzbG9nc1wiLFxuICAgICAgICAgIFwiT3B0aW9uc1wiOiB7XG4gICAgICAgICAgICBcImF3c2xvZ3MtZ3JvdXBcIjoge1xuICAgICAgICAgICAgICBcIlJlZlwiOiBcImdyZWV0ZXJ0YXNrZGVmaW5pdGlvbnNpZGVjYXJwcm94eUxvZ0dyb3VwOTI4MDAxRUFcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiYXdzbG9ncy1zdHJlYW0tcHJlZml4XCI6IFwiZW52b3lcIixcbiAgICAgICAgICAgIFwiYXdzbG9ncy1yZWdpb25cIjoge1xuICAgICAgICAgICAgICBcIlJlZlwiOiBcIkFXUzo6UmVnaW9uXCJcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFwiTWVtb3J5XCI6IDI1NixcbiAgICAgICAgXCJNb3VudFBvaW50c1wiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb250YWluZXJQYXRoXCI6IFwiL2NvbnN1bC9kYXRhXCIsXG4gICAgICAgICAgICBcIlJlYWRPbmx5XCI6IGZhbHNlLFxuICAgICAgICAgICAgXCJTb3VyY2VWb2x1bWVcIjogXCJjb25zdWwtZGF0YVwiXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBcIk5hbWVcIjogXCJzaWRlY2FyLXByb3h5XCIsXG4gICAgICAgIFwiUG9ydE1hcHBpbmdzXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbnRhaW5lclBvcnRcIjogMjAwMDAsXG4gICAgICAgICAgICBcIlByb3RvY29sXCI6IFwidGNwXCJcbiAgICAgICAgICB9XG4gICAgICAgIF1cbiAgICAgIH1cbiAgICBdLFxuICAgIFwiQ3B1XCI6IFwiMTAyNFwiLFxuICAgIFwiRXhlY3V0aW9uUm9sZUFyblwiOiB7XG4gICAgICBcIkZuOjpHZXRBdHRcIjogW1xuICAgICAgICBcImdyZWV0ZXJ0YXNrZGVmaW5pdGlvbkV4ZWN1dGlvblJvbGVBRUQwRUM3OVwiLFxuICAgICAgICBcIkFyblwiXG4gICAgICBdXG4gICAgfSxcbiAgICBcIkZhbWlseVwiOiBcImdyZWV0ZXJcIixcbiAgICBcIk1lbW9yeVwiOiBcIjIwNDhcIixcbiAgICBcIk5ldHdvcmtNb2RlXCI6IFwiYXdzdnBjXCIsXG4gICAgXCJSZXF1aXJlc0NvbXBhdGliaWxpdGllc1wiOiBbXG4gICAgICBcIkVDMlwiLFxuICAgICAgXCJGQVJHQVRFXCJcbiAgICBdLFxuICAgIFwiVGFza1JvbGVBcm5cIjoge1xuICAgICAgXCJGbjo6R2V0QXR0XCI6IFtcbiAgICAgICAgXCJncmVldGVydGFza2RlZmluaXRpb25UYXNrUm9sZTJBMDk4QUNDXCIsXG4gICAgICAgIFwiQXJuXCJcbiAgICAgIF1cbiAgICB9LFxuICAgIFwiVm9sdW1lc1wiOiBbXG4gICAgICB7XG4gICAgICAgIFwiTmFtZVwiOiBcImNvbnN1bC1kYXRhXCJcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIFwiTmFtZVwiOiBcImNvbnN1bC1jb25maWdcIlxuICAgICAgfVxuICAgIF1cbiAgfVxuICApKTtcblxuICBleHBlY3RDREsoc3RhY2spLnRvKGhhdmVSZXNvdXJjZSgnQVdTOjpFQ1M6OlRhc2tEZWZpbml0aW9uJywge1xuICAgIFwiQ29udGFpbmVyRGVmaW5pdGlvbnNcIjogW1xuICAgICAge1xuICAgICAgICBcIkNwdVwiOiAxMDI0LFxuICAgICAgICBcIkRlcGVuZHNPblwiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb25kaXRpb25cIjogXCJTVUNDRVNTXCIsXG4gICAgICAgICAgICBcIkNvbnRhaW5lck5hbWVcIjogXCJjb25zdWwtZWNzLW1lc2gtaW5pdFwiXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbmRpdGlvblwiOiBcIkhFQUxUSFlcIixcbiAgICAgICAgICAgIFwiQ29udGFpbmVyTmFtZVwiOiBcInNpZGVjYXItcHJveHlcIlxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgXCJFc3NlbnRpYWxcIjogdHJ1ZSxcbiAgICAgICAgXCJJbWFnZVwiOiBcIm5hdGhhbnBlY2svbmFtZVwiLFxuICAgICAgICBcIk1lbW9yeVwiOiAyMDQ4LFxuICAgICAgICBcIk5hbWVcIjogXCJhcHBcIixcbiAgICAgICAgXCJQb3J0TWFwcGluZ3NcIjogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiQ29udGFpbmVyUG9ydFwiOiAzMDAwLFxuICAgICAgICAgICAgXCJQcm90b2NvbFwiOiBcInRjcFwiXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBcIlVsaW1pdHNcIjogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiSGFyZExpbWl0XCI6IDEwMjQwMDAsXG4gICAgICAgICAgICBcIk5hbWVcIjogXCJub2ZpbGVcIixcbiAgICAgICAgICAgIFwiU29mdExpbWl0XCI6IDEwMjQwMDBcbiAgICAgICAgICB9XG4gICAgICAgIF1cbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIFwiQ29tbWFuZFwiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJGbjo6Sm9pblwiOiBbXG4gICAgICAgICAgICAgIFwiXCIsXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICBcIkVDU19JUFY0PSQoY3VybCAtcyAkRUNTX0NPTlRBSU5FUl9NRVRBREFUQV9VUkkgfCBqcSAtciAnLk5ldHdvcmtzWzBdLklQdjRBZGRyZXNzZXNbMF0nKSAmJiBpZiBbIHRydWUgPT0gdHJ1ZSBdOyB0aGVuICAgICAgICAgICAgICAgICBlY2hvIFxcXCJ7e3Jlc29sdmU6c2VjcmV0c21hbmFnZXI6YXJuOlwiLFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIFwiUmVmXCI6IFwiQVdTOjpQYXJ0aXRpb25cIlxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXCI6c2VjcmV0c21hbmFnZXI6XCIsXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgXCJSZWZcIjogXCJBV1M6OlJlZ2lvblwiXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBcIjpcIixcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBcIlJlZlwiOiBcIkFXUzo6QWNjb3VudElkXCJcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIFwiOnNlY3JldDpUTFNFbmNyeXB0VmFsdWU6U2VjcmV0U3RyaW5nOjo6fX1cXFwiID4gL3RtcC9jb25zdWwtYWdlbnQtY2EtY2VydC5wZW07XFxuICAgICAgICAgICAgICAgIGZpICYmXFxuICAgICAgICAgICAgICAgICAgZXhlYyBjb25zdWwgYWdlbnQgICAgICAgICAgICAgICAgICAgLWFkdmVydGlzZSAkRUNTX0lQVjQgICAgICAgICAgICAgICAgICAgLWRhdGEtZGlyIC9jb25zdWwvZGF0YSAgICAgICAgICAgICAgICAgICAtY2xpZW50IDAuMC4wLjAgICAgICAgICAgICAgICAgICAgLWhjbCAnYWRkcmVzc2VzID0geyBkbnMgPSBcXFwiMTI3LjAuMC4xXFxcIiB9JyAgICAgICAgICAgICAgICAgICAtaGNsICdhZGRyZXNzZXMgPSB7IGdycGMgPSBcXFwiMTI3LjAuMC4xXFxcIiB9JyAgICAgICAgICAgICAgICAgICAtaGNsICdhZGRyZXNzZXMgPSB7IGh0dHAgPSBcXFwiMTI3LjAuMC4xXFxcIiB9JyAgICAgICAgICAgICAgICAgICAtcmV0cnktam9pbiBcXFwicHJvdmlkZXI9YXdzIHJlZ2lvbj11cy13ZXN0LTIgdGFnX2tleT1OYW1lIHRhZ192YWx1ZT10ZXN0LWNvbnN1bC1zZXJ2ZXJcXFwiICAgICAgICAgICAgICAgICAgIC1oY2wgJ3RlbGVtZXRyeSB7IGRpc2FibGVfY29tcGF0XzEuOSA9IHRydWUgfScgICAgICAgICAgICAgICAgICAgLWhjbCAnbGVhdmVfb25fdGVybWluYXRlID0gdHJ1ZScgICAgICAgICAgICAgICAgICAgLWhjbCAncG9ydHMgeyBncnBjID0gODUwMiB9JyAgICAgICAgICAgICAgICAgICAtaGNsICdhZHZlcnRpc2VfcmVjb25uZWN0X3RpbWVvdXQgPSBcXFwiMTVtXFxcIicgICAgICAgICAgICAgICAgICAgLWhjbCAnZW5hYmxlX2NlbnRyYWxfc2VydmljZV9jb25maWcgPSB0cnVlJyAgICAgICAgICAgICAgICAtaGNsICdjYV9maWxlID0gXFxcIi90bXAvY29uc3VsLWFnZW50LWNhLWNlcnQucGVtXFxcIicgICAgICAgICAgICAgICAgLWhjbCAnYXV0b19lbmNyeXB0ID0ge3RscyA9IHRydWV9JyAgICAgICAgICAgICAgICAtaGNsIFxcXCJhdXRvX2VuY3J5cHQgPSB7aXBfc2FuID0gWyBcXFxcXFxcIiRFQ1NfSVBWNFxcXFxcXFwiIF19XFxcIiAgICAgICAgICAgICAgICAtaGNsICd2ZXJpZnlfb3V0Z29pbmcgPSB0cnVlJyAgICAgICAgICAgICAtZW5jcnlwdCBcXFwie3tyZXNvbHZlOnNlY3JldHNtYW5hZ2VyOmFybjpcIixcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBcIlJlZlwiOiBcIkFXUzo6UGFydGl0aW9uXCJcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIFwiOnNlY3JldHNtYW5hZ2VyOlwiLFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIFwiUmVmXCI6IFwiQVdTOjpSZWdpb25cIlxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXCI6XCIsXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgXCJSZWZcIjogXCJBV1M6OkFjY291bnRJZFwiXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBcIjpzZWNyZXQ6Z29zc2lwRW5jcnlwdFZhbHVlOlNlY3JldFN0cmluZzo6On19XFxcIlwiXG4gICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIFwiRW50cnlQb2ludFwiOiBbXG4gICAgICAgICAgXCIvYmluL3NoXCIsXG4gICAgICAgICAgXCItZWNcIlxuICAgICAgICBdLFxuICAgICAgICBcIkVzc2VudGlhbFwiOiBmYWxzZSxcbiAgICAgICAgXCJJbWFnZVwiOiBcImhhc2hpY29ycC9jb25zdWw6MS45LjVcIixcbiAgICAgICAgXCJMb2dDb25maWd1cmF0aW9uXCI6IHtcbiAgICAgICAgICBcIkxvZ0RyaXZlclwiOiBcImF3c2xvZ3NcIixcbiAgICAgICAgICBcIk9wdGlvbnNcIjoge1xuICAgICAgICAgICAgXCJhd3Nsb2dzLWdyb3VwXCI6IHtcbiAgICAgICAgICAgICAgXCJSZWZcIjogXCJuYW1ldGFza2RlZmluaXRpb25jb25zdWxjbGllbnRMb2dHcm91cDVDM0NDNzgxXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImF3c2xvZ3Mtc3RyZWFtLXByZWZpeFwiOiBcImNvbnN1bC1jbGllbnRcIixcbiAgICAgICAgICAgIFwiYXdzbG9ncy1yZWdpb25cIjoge1xuICAgICAgICAgICAgICBcIlJlZlwiOiBcIkFXUzo6UmVnaW9uXCJcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFwiTWVtb3J5XCI6IDI1NixcbiAgICAgICAgXCJNb3VudFBvaW50c1wiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb250YWluZXJQYXRoXCI6IFwiL2NvbnN1bC9kYXRhXCIsXG4gICAgICAgICAgICBcIlJlYWRPbmx5XCI6IGZhbHNlLFxuICAgICAgICAgICAgXCJTb3VyY2VWb2x1bWVcIjogXCJjb25zdWwtZGF0YVwiXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbnRhaW5lclBhdGhcIjogXCIvY29uc3VsL2NvbmZpZ1wiLFxuICAgICAgICAgICAgXCJSZWFkT25seVwiOiBmYWxzZSxcbiAgICAgICAgICAgIFwiU291cmNlVm9sdW1lXCI6IFwiY29uc3VsLWNvbmZpZ1wiXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBcIk5hbWVcIjogXCJjb25zdWwtY2xpZW50XCIsXG4gICAgICAgIFwiUG9ydE1hcHBpbmdzXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbnRhaW5lclBvcnRcIjogODMwMSxcbiAgICAgICAgICAgIFwiUHJvdG9jb2xcIjogXCJ0Y3BcIlxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb250YWluZXJQb3J0XCI6IDgzMDEsXG4gICAgICAgICAgICBcIlByb3RvY29sXCI6IFwidWRwXCJcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiQ29udGFpbmVyUG9ydFwiOiA4NTAwLFxuICAgICAgICAgICAgXCJQcm90b2NvbFwiOiBcInRjcFwiXG4gICAgICAgICAgfVxuICAgICAgICBdXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBcIkNvbW1hbmRcIjogW1xuICAgICAgICAgIFwibWVzaC1pbml0XCIsXG4gICAgICAgICAgXCItZW52b3ktYm9vdHN0cmFwLWZpbGU9L2NvbnN1bC9kYXRhL2Vudm95LWJvb3RzdHJhcC5qc29uXCIsXG4gICAgICAgICAgXCItcG9ydD0zMDAwXCIsXG4gICAgICAgICAgXCItdXBzdHJlYW1zPVwiXG4gICAgICAgIF0sXG4gICAgICAgIFwiRXNzZW50aWFsXCI6IGZhbHNlLFxuICAgICAgICBcIkltYWdlXCI6IFwiaGFzaGljb3JwL2NvbnN1bC1lY3M6MC4xLjJcIixcbiAgICAgICAgXCJMb2dDb25maWd1cmF0aW9uXCI6IHtcbiAgICAgICAgICBcIkxvZ0RyaXZlclwiOiBcImF3c2xvZ3NcIixcbiAgICAgICAgICBcIk9wdGlvbnNcIjoge1xuICAgICAgICAgICAgXCJhd3Nsb2dzLWdyb3VwXCI6IHtcbiAgICAgICAgICAgICAgXCJSZWZcIjogXCJuYW1ldGFza2RlZmluaXRpb25jb25zdWxlY3NtZXNoaW5pdExvZ0dyb3VwQkUxMzUyNUFcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiYXdzbG9ncy1zdHJlYW0tcHJlZml4XCI6IFwiY29uc3VsLWVjcy1tZXNoLWluaXRcIixcbiAgICAgICAgICAgIFwiYXdzbG9ncy1yZWdpb25cIjoge1xuICAgICAgICAgICAgICBcIlJlZlwiOiBcIkFXUzo6UmVnaW9uXCJcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFwiTWVtb3J5XCI6IDI1NixcbiAgICAgICAgXCJNb3VudFBvaW50c1wiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb250YWluZXJQYXRoXCI6IFwiL2NvbnN1bC9kYXRhXCIsXG4gICAgICAgICAgICBcIlJlYWRPbmx5XCI6IGZhbHNlLFxuICAgICAgICAgICAgXCJTb3VyY2VWb2x1bWVcIjogXCJjb25zdWwtZGF0YVwiXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBcIk5hbWVcIjogXCJjb25zdWwtZWNzLW1lc2gtaW5pdFwiLFxuICAgICAgICBcIlVzZXJcIjogXCJyb290XCJcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIFwiQ29tbWFuZFwiOiBbXG4gICAgICAgICAgXCJlbnZveSAtLWNvbmZpZy1wYXRoIC9jb25zdWwvZGF0YS9lbnZveS1ib290c3RyYXAuanNvblwiXG4gICAgICAgIF0sXG4gICAgICAgIFwiRGVwZW5kc09uXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbmRpdGlvblwiOiBcIlNVQ0NFU1NcIixcbiAgICAgICAgICAgIFwiQ29udGFpbmVyTmFtZVwiOiBcImNvbnN1bC1lY3MtbWVzaC1pbml0XCJcbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIFwiRW50cnlQb2ludFwiOiBbXG4gICAgICAgICAgXCIvYmluL3NoXCIsXG4gICAgICAgICAgXCItY1wiXG4gICAgICAgIF0sXG4gICAgICAgIFwiRXNzZW50aWFsXCI6IGZhbHNlLFxuICAgICAgICBcIkhlYWx0aENoZWNrXCI6IHtcbiAgICAgICAgICBcIkNvbW1hbmRcIjogW1xuICAgICAgICAgICAgXCJDTURcIixcbiAgICAgICAgICAgIFwibmNcIixcbiAgICAgICAgICAgIFwiLXpcIixcbiAgICAgICAgICAgIFwiMTI3LjAuMC4xXCIsXG4gICAgICAgICAgICBcIjIwMDAwXCJcbiAgICAgICAgICBdLFxuICAgICAgICAgIFwiSW50ZXJ2YWxcIjogMzAsXG4gICAgICAgICAgXCJSZXRyaWVzXCI6IDMsXG4gICAgICAgICAgXCJUaW1lb3V0XCI6IDVcbiAgICAgICAgfSxcbiAgICAgICAgXCJJbWFnZVwiOiBcImVudm95cHJveHkvZW52b3ktYWxwaW5lOnYxLjE2LjJcIixcbiAgICAgICAgXCJMb2dDb25maWd1cmF0aW9uXCI6IHtcbiAgICAgICAgICBcIkxvZ0RyaXZlclwiOiBcImF3c2xvZ3NcIixcbiAgICAgICAgICBcIk9wdGlvbnNcIjoge1xuICAgICAgICAgICAgXCJhd3Nsb2dzLWdyb3VwXCI6IHtcbiAgICAgICAgICAgICAgXCJSZWZcIjogXCJuYW1ldGFza2RlZmluaXRpb25zaWRlY2FycHJveHlMb2dHcm91cDFGNTg4OUMyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImF3c2xvZ3Mtc3RyZWFtLXByZWZpeFwiOiBcImVudm95XCIsXG4gICAgICAgICAgICBcImF3c2xvZ3MtcmVnaW9uXCI6IHtcbiAgICAgICAgICAgICAgXCJSZWZcIjogXCJBV1M6OlJlZ2lvblwiXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcIk1lbW9yeVwiOiAyNTYsXG4gICAgICAgIFwiTW91bnRQb2ludHNcIjogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiQ29udGFpbmVyUGF0aFwiOiBcIi9jb25zdWwvZGF0YVwiLFxuICAgICAgICAgICAgXCJSZWFkT25seVwiOiBmYWxzZSxcbiAgICAgICAgICAgIFwiU291cmNlVm9sdW1lXCI6IFwiY29uc3VsLWRhdGFcIlxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgXCJOYW1lXCI6IFwic2lkZWNhci1wcm94eVwiLFxuICAgICAgICBcIlBvcnRNYXBwaW5nc1wiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb250YWluZXJQb3J0XCI6IDIwMDAwLFxuICAgICAgICAgICAgXCJQcm90b2NvbFwiOiBcInRjcFwiXG4gICAgICAgICAgfVxuICAgICAgICBdXG4gICAgICB9XG4gICAgXSxcbiAgICBcIkNwdVwiOiBcIjEwMjRcIixcbiAgICBcIkV4ZWN1dGlvblJvbGVBcm5cIjoge1xuICAgICAgXCJGbjo6R2V0QXR0XCI6IFtcbiAgICAgICAgXCJuYW1ldGFza2RlZmluaXRpb25FeGVjdXRpb25Sb2xlNDVBQzVDOUFcIixcbiAgICAgICAgXCJBcm5cIlxuICAgICAgXVxuICAgIH0sXG4gICAgXCJGYW1pbHlcIjogXCJuYW1lXCIsXG4gICAgXCJNZW1vcnlcIjogXCIyMDQ4XCIsXG4gICAgXCJOZXR3b3JrTW9kZVwiOiBcImF3c3ZwY1wiLFxuICAgIFwiUmVxdWlyZXNDb21wYXRpYmlsaXRpZXNcIjogW1xuICAgICAgXCJFQzJcIixcbiAgICAgIFwiRkFSR0FURVwiXG4gICAgXSxcbiAgICBcIlRhc2tSb2xlQXJuXCI6IHtcbiAgICAgIFwiRm46OkdldEF0dFwiOiBbXG4gICAgICAgIFwibmFtZXRhc2tkZWZpbml0aW9uVGFza1JvbGU1MEZFODQ0RVwiLFxuICAgICAgICBcIkFyblwiXG4gICAgICBdXG4gICAgfSxcbiAgICBcIlZvbHVtZXNcIjogW1xuICAgICAge1xuICAgICAgICBcIk5hbWVcIjogXCJjb25zdWwtZGF0YVwiXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBcIk5hbWVcIjogXCJjb25zdWwtY29uZmlnXCJcbiAgICAgIH1cbiAgICBdXG4gIH1cbiAgKSk7XG5cbiAgZXhwZWN0Q0RLKHN0YWNrKS50byhoYXZlUmVzb3VyY2UoJ0FXUzo6RUNTOjpTZXJ2aWNlJywge1xuICAgICAgXCJDbHVzdGVyXCI6IHtcbiAgICAgICAgXCJSZWZcIjogXCJwcm9kdWN0aW9uZW52aXJvbm1lbnRjbHVzdGVyQzY1OTlEMkRcIlxuICAgICAgfSxcbiAgICAgIFwiRGVwbG95bWVudENvbmZpZ3VyYXRpb25cIjoge1xuICAgICAgICBcIk1heGltdW1QZXJjZW50XCI6IDIwMCxcbiAgICAgICAgXCJNaW5pbXVtSGVhbHRoeVBlcmNlbnRcIjogMTAwXG4gICAgICB9LFxuICAgICAgXCJEZXNpcmVkQ291bnRcIjogMSxcbiAgICAgIFwiRW5hYmxlRUNTTWFuYWdlZFRhZ3NcIjogZmFsc2UsXG4gICAgICBcIkxhdW5jaFR5cGVcIjogXCJGQVJHQVRFXCIsXG4gICAgICBcIk5ldHdvcmtDb25maWd1cmF0aW9uXCI6IHtcbiAgICAgICAgXCJBd3N2cGNDb25maWd1cmF0aW9uXCI6IHtcbiAgICAgICAgICBcIkFzc2lnblB1YmxpY0lwXCI6IFwiRElTQUJMRURcIixcbiAgICAgICAgICBcIlNlY3VyaXR5R3JvdXBzXCI6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgXCJGbjo6R2V0QXR0XCI6IFtcbiAgICAgICAgICAgICAgICBcIm5hbWVzZXJ2aWNlU2VjdXJpdHlHcm91cDMzRjQ2NjJDXCIsXG4gICAgICAgICAgICAgICAgXCJHcm91cElkXCJcbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgXCJGbjo6R2V0QXR0XCI6IFtcbiAgICAgICAgICAgICAgICBcImNvbnN1bENsaWVudFNlY3VyaXR5R3JvdXAyNzlEMzM3M1wiLFxuICAgICAgICAgICAgICAgIFwiR3JvdXBJZFwiXG4gICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdLFxuICAgICAgICAgIFwiU3VibmV0c1wiOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIFwiUmVmXCI6IFwicHJvZHVjdGlvbmVudmlyb25tZW50dnBjUHJpdmF0ZVN1Ym5ldDFTdWJuZXQ1M0Y2MzJFNlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBcIlJlZlwiOiBcInByb2R1Y3Rpb25lbnZpcm9ubWVudHZwY1ByaXZhdGVTdWJuZXQyU3VibmV0NzU2RkI5M0NcIlxuICAgICAgICAgICAgfVxuICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIFwiVGFza0RlZmluaXRpb25cIjoge1xuICAgICAgICBcIlJlZlwiOiBcIm5hbWV0YXNrZGVmaW5pdGlvbjY5MDc2MkJCXCJcbiAgICAgIH0gXG4gIH0pKTtcbiAgXG4gIGV4cGVjdENESyhzdGFjaykudG8oaGF2ZVJlc291cmNlKCdBV1M6OkVDUzo6U2VydmljZScsIHtcbiAgICBcIkNsdXN0ZXJcIjoge1xuICAgICAgXCJSZWZcIjogXCJwcm9kdWN0aW9uZW52aXJvbm1lbnRjbHVzdGVyQzY1OTlEMkRcIlxuICAgIH0sXG4gICAgXCJEZXBsb3ltZW50Q29uZmlndXJhdGlvblwiOiB7XG4gICAgICBcIk1heGltdW1QZXJjZW50XCI6IDIwMCxcbiAgICAgIFwiTWluaW11bUhlYWx0aHlQZXJjZW50XCI6IDEwMFxuICAgIH0sXG4gICAgXCJEZXNpcmVkQ291bnRcIjogMSxcbiAgICBcIkVuYWJsZUVDU01hbmFnZWRUYWdzXCI6IGZhbHNlLFxuICAgIFwiTGF1bmNoVHlwZVwiOiBcIkZBUkdBVEVcIixcbiAgICBcIk5ldHdvcmtDb25maWd1cmF0aW9uXCI6IHtcbiAgICAgIFwiQXdzdnBjQ29uZmlndXJhdGlvblwiOiB7XG4gICAgICAgIFwiQXNzaWduUHVibGljSXBcIjogXCJESVNBQkxFRFwiLFxuICAgICAgICBcIlNlY3VyaXR5R3JvdXBzXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkZuOjpHZXRBdHRcIjogW1xuICAgICAgICAgICAgICBcImdyZWV0ZXJzZXJ2aWNlU2VjdXJpdHlHcm91cERCNEFDM0E5XCIsXG4gICAgICAgICAgICAgIFwiR3JvdXBJZFwiXG4gICAgICAgICAgICBdXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkZuOjpHZXRBdHRcIjogW1xuICAgICAgICAgICAgICBcImNvbnN1bENsaWVudFNlY3VyaXR5R3JvdXAyNzlEMzM3M1wiLFxuICAgICAgICAgICAgICBcIkdyb3VwSWRcIlxuICAgICAgICAgICAgXVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgXCJTdWJuZXRzXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIlJlZlwiOiBcInByb2R1Y3Rpb25lbnZpcm9ubWVudHZwY1ByaXZhdGVTdWJuZXQxU3VibmV0NTNGNjMyRTZcIlxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJSZWZcIjogXCJwcm9kdWN0aW9uZW52aXJvbm1lbnR2cGNQcml2YXRlU3VibmV0MlN1Ym5ldDc1NkZCOTNDXCJcbiAgICAgICAgICB9XG4gICAgICAgIF1cbiAgICAgIH1cbiAgICB9LFxuICAgIFwiVGFza0RlZmluaXRpb25cIjoge1xuICAgICAgXCJSZWZcIjogXCJncmVldGVydGFza2RlZmluaXRpb25FOTU2RUVBMlwiXG4gICAgfVxuICB9KSk7IFxufSk7XG5cblxudGVzdCgnVGVzdCBleHRlbnNpb24gd2l0aCBjdXN0b20gcGFyYW1zJywgKCkgPT4ge1xuICAvLyBXSEVOXG4gIGNvbnN0IHN0YWNrID0gbmV3IFN0YWNrKCk7XG4gIC8vIEdJVkVOXG4gIGNvbnN0IGVudmlyb25tZW50ID0gbmV3IEVudmlyb25tZW50KHN0YWNrLCAncHJvZHVjdGlvbicpO1xuXG4gIGNvbnN0IGNvbnN1bFNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAoc3RhY2ssICdjb25zdWxTZXJ2ZXJTZWN1cml0eUdyb3VwJywge1xuICAgIHZwYzogZW52aXJvbm1lbnQudnBjXG4gIH0pO1xuXG4gIGNvbnN0IGNvbnN1bENsaWVudFNlcmN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHN0YWNrLCAnY29uc3VsQ2xpZW50U2VjdXJpdHlHcm91cCcsIHtcbiAgICB2cGM6IGVudmlyb25tZW50LnZwY1xuICB9KTtcblxuICBjb25zdCBUTFNTZWNyZXQgPSBzZWNyZXRzbWFuYWdlci5TZWNyZXQuZnJvbVNlY3JldE5hbWVWMihcbiAgICBzdGFjayxcbiAgICAnVExTRW5jcnlwdEtleScsXG4gICAgJ1RMU0VuY3J5cHRWYWx1ZScsXG4gICk7XG5cbiAgY29uc3QgZ29zc2lwRW5jcnlwdEtleSA9IHNlY3JldHNtYW5hZ2VyLlNlY3JldC5mcm9tU2VjcmV0TmFtZVYyKFxuICAgIHN0YWNrLFxuICAgICdnb3NzaXBFbmNyeXB0S2V5JyxcbiAgICAnZ29zc2lwRW5jcnlwdFZhbHVlJyxcbiAgKTtcblxuICBjb25zdWxDbGllbnRTZXJjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICBjb25zdWxDbGllbnRTZXJjdXJpdHlHcm91cCxcbiAgICBlYzIuUG9ydC50Y3AoODMwMSksXG4gICAgXCJhbGxvdyBhbGwgdGhlIGNsaWVudHMgaW4gdGhlIG1lc2ggdGFsayB0byBlYWNoIG90aGVyXCJcbiAgKTtcbiAgY29uc3VsQ2xpZW50U2VyY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgY29uc3VsQ2xpZW50U2VyY3VyaXR5R3JvdXAsXG4gICAgZWMyLlBvcnQudWRwKDgzMDEpLFxuICAgIFwiYWxsb3cgYWxsIHRoZSBjbGllbnRzIGluIHRoZSBtZXNoIHRhbGsgdG8gZWFjaCBvdGhlclwiXG4gIClcblxuICBjb25zdCBuYW1lRGVzY3JpcHRpb24gPSBuZXcgU2VydmljZURlc2NyaXB0aW9uKCk7XG4gIG5hbWVEZXNjcmlwdGlvbi5hZGQobmV3IENvbnRhaW5lcih7XG4gICAgY3B1OiAxMDI0LFxuICAgIG1lbW9yeU1pQjogMjA0OCxcbiAgICB0cmFmZmljUG9ydDogMzAwMCxcbiAgICBpbWFnZTogZWNzLkNvbnRhaW5lckltYWdlLmZyb21SZWdpc3RyeSgnbmF0aGFucGVjay9uYW1lJylcbiAgfSkpO1xuXG4gIG5hbWVEZXNjcmlwdGlvbi5hZGQobmV3IENvbnN1bE1lc2hFeHRlbnNpb24oe1xuICAgIHJldHJ5Sm9pbjogXCJwcm92aWRlcj1hd3MgcmVnaW9uPXVzLXdlc3QtMiB0YWdfa2V5PU5hbWUgdGFnX3ZhbHVlPXRlc3QtY29uc3VsLXNlcnZlclwiLFxuICAgIGNvbnN1bFNlcnZlclNlcmN1cml0eUdyb3VwOiBjb25zdWxTZWN1cml0eUdyb3VwLFxuICAgIHBvcnQ6IDMwMDAsXG4gICAgY29uc3VsQ2xpZW50SW1hZ2U6IFwibXlDdXN0b21Db25zdWxDbGllbnRJbWFnZToxLjBcIixcbiAgICBjb25zdWxFY3NJbWFnZTogXCJteUN1c3RvbUNvbnN1bEVjc0ltYWdlOjEuMFwiLFxuICAgIGVudm95UHJveHlJbWFnZTogXCJteUN1c3RvbUVudm95SW1hZ2U6MS4wXCIsXG4gICAgY29uc3VsQ2xpZW50U2VyY3VyaXR5R3JvdXAsXG4gICAgZmFtaWx5OiBcIm5hbWVcIixcbiAgICB0bHM6IHRydWUsXG4gICAgY29uc3VsQ0FDZXJ0OiBUTFNTZWNyZXQsXG4gICAgZ29zc2lwRW5jcnlwdEtleVxuICB9KSk7XG5cbiAgY29uc3QgbmFtZVNlcnZpY2UgPSBuZXcgU2VydmljZShzdGFjaywgJ25hbWUnLCB7XG4gICAgZW52aXJvbm1lbnQ6IGVudmlyb25tZW50LFxuICAgIHNlcnZpY2VEZXNjcmlwdGlvbjogbmFtZURlc2NyaXB0aW9uXG4gIH0pO1xuXG4gIC8vIGxhdW5jaCBzZXJ2aWNlIGludG8gdGhhdCBjbHVzdGVyXG4gIGNvbnN0IGdyZWV0ZXJEZXNjcmlwdGlvbiA9IG5ldyBTZXJ2aWNlRGVzY3JpcHRpb24oKTtcbiAgZ3JlZXRlckRlc2NyaXB0aW9uLmFkZChuZXcgQ29udGFpbmVyKHtcbiAgICBjcHU6IDEwMjQsXG4gICAgbWVtb3J5TWlCOiAyMDQ4LFxuICAgIHRyYWZmaWNQb3J0OiAzMDAwLFxuICAgIGltYWdlOiBlY3MuQ29udGFpbmVySW1hZ2UuZnJvbVJlZ2lzdHJ5KCduYXRoYW5wZWNrL2dyZWV0ZXInKVxuICB9KSk7XG5cbiAgZ3JlZXRlckRlc2NyaXB0aW9uLmFkZChuZXcgQ29uc3VsTWVzaEV4dGVuc2lvbih7XG4gICAgcmV0cnlKb2luOiBcInByb3ZpZGVyPWF3cyByZWdpb249dXMtd2VzdC0yIHRhZ19rZXk9TmFtZSB0YWdfdmFsdWU9dGVzdC1jb25zdWwtc2VydmVyXCIsIC8vIHVzZSBpbnRlcmZhY2UsIHVzZSBFTlVNc1xuICAgIGNvbnN1bFNlcnZlclNlcmN1cml0eUdyb3VwOiBjb25zdWxTZWN1cml0eUdyb3VwLFxuICAgIHBvcnQ6IDMwMDAsXG4gICAgY29uc3VsQ2xpZW50SW1hZ2U6IFwibXlDdXN0b21Db25zdWxDbGllbnRJbWFnZToxLjBcIixcbiAgICBjb25zdWxFY3NJbWFnZTogXCJteUN1c3RvbUNvbnN1bEVjc0ltYWdlOjEuMFwiLFxuICAgIGVudm95UHJveHlJbWFnZTogXCJteUN1c3RvbUVudm95SW1hZ2U6MS4wXCIsXG4gICAgY29uc3VsQ2xpZW50U2VyY3VyaXR5R3JvdXAsXG4gICAgZmFtaWx5OiBcImdyZWV0ZXJcIixcbiAgICB0bHM6IHRydWUsXG4gICAgY29uc3VsQ0FDZXJ0OiBUTFNTZWNyZXQsXG4gICAgZ29zc2lwRW5jcnlwdEtleVxuICB9KSk7XG5cbiAgY29uc3QgZ3JlZXRlclNlcnZpY2UgPSBuZXcgU2VydmljZShzdGFjaywgJ2dyZWV0ZXInLCB7XG4gICAgZW52aXJvbm1lbnQ6IGVudmlyb25tZW50LFxuICAgIHNlcnZpY2VEZXNjcmlwdGlvbjogZ3JlZXRlckRlc2NyaXB0aW9uLFxuICB9KTtcblxuICBncmVldGVyU2VydmljZS5jb25uZWN0VG8obmFtZVNlcnZpY2UpO1xuXG4gIC8vVEhFTlxuICBleHBlY3RDREsoc3RhY2spLnRvKGhhdmVSZXNvdXJjZSgnQVdTOjpFQ1M6OlRhc2tEZWZpbml0aW9uJywge1xuICAgIFwiQ29udGFpbmVyRGVmaW5pdGlvbnNcIjogW1xuICAgICAge1xuICAgICAgICBcIkNwdVwiOiAxMDI0LFxuICAgICAgICBcIkRlcGVuZHNPblwiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb25kaXRpb25cIjogXCJTVUNDRVNTXCIsXG4gICAgICAgICAgICBcIkNvbnRhaW5lck5hbWVcIjogXCJjb25zdWwtZWNzLW1lc2gtaW5pdFwiXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbmRpdGlvblwiOiBcIkhFQUxUSFlcIixcbiAgICAgICAgICAgIFwiQ29udGFpbmVyTmFtZVwiOiBcInNpZGVjYXItcHJveHlcIlxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgXCJFbnZpcm9ubWVudFwiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJOYW1lXCI6IFwiTkFNRV9VUkxcIixcbiAgICAgICAgICAgIFwiVmFsdWVcIjogXCJodHRwOi8vbG9jYWxob3N0OjMwMDFcIlxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgXCJFc3NlbnRpYWxcIjogdHJ1ZSxcbiAgICAgICAgXCJJbWFnZVwiOiBcIm5hdGhhbnBlY2svZ3JlZXRlclwiLFxuICAgICAgICBcIk1lbW9yeVwiOiAyMDQ4LFxuICAgICAgICBcIk5hbWVcIjogXCJhcHBcIixcbiAgICAgICAgXCJQb3J0TWFwcGluZ3NcIjogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiQ29udGFpbmVyUG9ydFwiOiAzMDAwLFxuICAgICAgICAgICAgXCJQcm90b2NvbFwiOiBcInRjcFwiXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBcIlVsaW1pdHNcIjogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiSGFyZExpbWl0XCI6IDEwMjQwMDAsXG4gICAgICAgICAgICBcIk5hbWVcIjogXCJub2ZpbGVcIixcbiAgICAgICAgICAgIFwiU29mdExpbWl0XCI6IDEwMjQwMDBcbiAgICAgICAgICB9XG4gICAgICAgIF1cbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIFwiQ29tbWFuZFwiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJGbjo6Sm9pblwiOiBbXG4gICAgICAgICAgICAgIFwiXCIsXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICBcIkVDU19JUFY0PSQoY3VybCAtcyAkRUNTX0NPTlRBSU5FUl9NRVRBREFUQV9VUkkgfCBqcSAtciAnLk5ldHdvcmtzWzBdLklQdjRBZGRyZXNzZXNbMF0nKSAmJiBpZiBbIHRydWUgPT0gdHJ1ZSBdOyB0aGVuICAgICAgICAgICAgICAgICBlY2hvIFxcXCJ7e3Jlc29sdmU6c2VjcmV0c21hbmFnZXI6YXJuOlwiLFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIFwiUmVmXCI6IFwiQVdTOjpQYXJ0aXRpb25cIlxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXCI6c2VjcmV0c21hbmFnZXI6XCIsXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgXCJSZWZcIjogXCJBV1M6OlJlZ2lvblwiXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBcIjpcIixcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBcIlJlZlwiOiBcIkFXUzo6QWNjb3VudElkXCJcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIFwiOnNlY3JldDpUTFNFbmNyeXB0VmFsdWU6U2VjcmV0U3RyaW5nOjo6fX1cXFwiID4gL3RtcC9jb25zdWwtYWdlbnQtY2EtY2VydC5wZW07XFxuICAgICAgICAgICAgICAgIGZpICYmXFxuICAgICAgICAgICAgICAgICAgZXhlYyBjb25zdWwgYWdlbnQgICAgICAgICAgICAgICAgICAgLWFkdmVydGlzZSAkRUNTX0lQVjQgICAgICAgICAgICAgICAgICAgLWRhdGEtZGlyIC9jb25zdWwvZGF0YSAgICAgICAgICAgICAgICAgICAtY2xpZW50IDAuMC4wLjAgICAgICAgICAgICAgICAgICAgLWhjbCAnYWRkcmVzc2VzID0geyBkbnMgPSBcXFwiMTI3LjAuMC4xXFxcIiB9JyAgICAgICAgICAgICAgICAgICAtaGNsICdhZGRyZXNzZXMgPSB7IGdycGMgPSBcXFwiMTI3LjAuMC4xXFxcIiB9JyAgICAgICAgICAgICAgICAgICAtaGNsICdhZGRyZXNzZXMgPSB7IGh0dHAgPSBcXFwiMTI3LjAuMC4xXFxcIiB9JyAgICAgICAgICAgICAgICAgICAtcmV0cnktam9pbiBcXFwicHJvdmlkZXI9YXdzIHJlZ2lvbj11cy13ZXN0LTIgdGFnX2tleT1OYW1lIHRhZ192YWx1ZT10ZXN0LWNvbnN1bC1zZXJ2ZXJcXFwiICAgICAgICAgICAgICAgICAgIC1oY2wgJ3RlbGVtZXRyeSB7IGRpc2FibGVfY29tcGF0XzEuOSA9IHRydWUgfScgICAgICAgICAgICAgICAgICAgLWhjbCAnbGVhdmVfb25fdGVybWluYXRlID0gdHJ1ZScgICAgICAgICAgICAgICAgICAgLWhjbCAncG9ydHMgeyBncnBjID0gODUwMiB9JyAgICAgICAgICAgICAgICAgICAtaGNsICdhZHZlcnRpc2VfcmVjb25uZWN0X3RpbWVvdXQgPSBcXFwiMTVtXFxcIicgICAgICAgICAgICAgICAgICAgLWhjbCAnZW5hYmxlX2NlbnRyYWxfc2VydmljZV9jb25maWcgPSB0cnVlJyAgICAgICAgICAgICAgICAtaGNsICdjYV9maWxlID0gXFxcIi90bXAvY29uc3VsLWFnZW50LWNhLWNlcnQucGVtXFxcIicgICAgICAgICAgICAgICAgLWhjbCAnYXV0b19lbmNyeXB0ID0ge3RscyA9IHRydWV9JyAgICAgICAgICAgICAgICAtaGNsIFxcXCJhdXRvX2VuY3J5cHQgPSB7aXBfc2FuID0gWyBcXFxcXFxcIiRFQ1NfSVBWNFxcXFxcXFwiIF19XFxcIiAgICAgICAgICAgICAgICAtaGNsICd2ZXJpZnlfb3V0Z29pbmcgPSB0cnVlJyAgICAgICAgICAgICAtZW5jcnlwdCBcXFwie3tyZXNvbHZlOnNlY3JldHNtYW5hZ2VyOmFybjpcIixcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBcIlJlZlwiOiBcIkFXUzo6UGFydGl0aW9uXCJcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIFwiOnNlY3JldHNtYW5hZ2VyOlwiLFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIFwiUmVmXCI6IFwiQVdTOjpSZWdpb25cIlxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXCI6XCIsXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgXCJSZWZcIjogXCJBV1M6OkFjY291bnRJZFwiXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBcIjpzZWNyZXQ6Z29zc2lwRW5jcnlwdFZhbHVlOlNlY3JldFN0cmluZzo6On19XFxcIlwiXG4gICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIFwiRW50cnlQb2ludFwiOiBbXG4gICAgICAgICAgXCIvYmluL3NoXCIsXG4gICAgICAgICAgXCItZWNcIlxuICAgICAgICBdLFxuICAgICAgICBcIkVzc2VudGlhbFwiOiBmYWxzZSxcbiAgICAgICAgXCJJbWFnZVwiOiBcIm15Q3VzdG9tQ29uc3VsQ2xpZW50SW1hZ2U6MS4wXCIsXG4gICAgICAgIFwiTG9nQ29uZmlndXJhdGlvblwiOiB7XG4gICAgICAgICAgXCJMb2dEcml2ZXJcIjogXCJhd3Nsb2dzXCIsXG4gICAgICAgICAgXCJPcHRpb25zXCI6IHtcbiAgICAgICAgICAgIFwiYXdzbG9ncy1ncm91cFwiOiB7XG4gICAgICAgICAgICAgIFwiUmVmXCI6IFwiZ3JlZXRlcnRhc2tkZWZpbml0aW9uY29uc3VsY2xpZW50TG9nR3JvdXA5OUVCMUEwM1wiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJhd3Nsb2dzLXN0cmVhbS1wcmVmaXhcIjogXCJjb25zdWwtY2xpZW50XCIsXG4gICAgICAgICAgICBcImF3c2xvZ3MtcmVnaW9uXCI6IHtcbiAgICAgICAgICAgICAgXCJSZWZcIjogXCJBV1M6OlJlZ2lvblwiXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcIk1lbW9yeVwiOiAyNTYsXG4gICAgICAgIFwiTW91bnRQb2ludHNcIjogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiQ29udGFpbmVyUGF0aFwiOiBcIi9jb25zdWwvZGF0YVwiLFxuICAgICAgICAgICAgXCJSZWFkT25seVwiOiBmYWxzZSxcbiAgICAgICAgICAgIFwiU291cmNlVm9sdW1lXCI6IFwiY29uc3VsLWRhdGFcIlxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb250YWluZXJQYXRoXCI6IFwiL2NvbnN1bC9jb25maWdcIixcbiAgICAgICAgICAgIFwiUmVhZE9ubHlcIjogZmFsc2UsXG4gICAgICAgICAgICBcIlNvdXJjZVZvbHVtZVwiOiBcImNvbnN1bC1jb25maWdcIlxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgXCJOYW1lXCI6IFwiY29uc3VsLWNsaWVudFwiLFxuICAgICAgICBcIlBvcnRNYXBwaW5nc1wiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb250YWluZXJQb3J0XCI6IDgzMDEsXG4gICAgICAgICAgICBcIlByb3RvY29sXCI6IFwidGNwXCJcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiQ29udGFpbmVyUG9ydFwiOiA4MzAxLFxuICAgICAgICAgICAgXCJQcm90b2NvbFwiOiBcInVkcFwiXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbnRhaW5lclBvcnRcIjogODUwMCxcbiAgICAgICAgICAgIFwiUHJvdG9jb2xcIjogXCJ0Y3BcIlxuICAgICAgICAgIH1cbiAgICAgICAgXVxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgXCJDb21tYW5kXCI6IFtcbiAgICAgICAgICBcIm1lc2gtaW5pdFwiLFxuICAgICAgICAgIFwiLWVudm95LWJvb3RzdHJhcC1maWxlPS9jb25zdWwvZGF0YS9lbnZveS1ib290c3RyYXAuanNvblwiLFxuICAgICAgICAgIFwiLXBvcnQ9MzAwMFwiLFxuICAgICAgICAgIFwiLXVwc3RyZWFtcz1uYW1lOjMwMDFcIlxuICAgICAgICBdLFxuICAgICAgICBcIkVzc2VudGlhbFwiOiBmYWxzZSxcbiAgICAgICAgXCJJbWFnZVwiOiBcIm15Q3VzdG9tQ29uc3VsRWNzSW1hZ2U6MS4wXCIsXG4gICAgICAgIFwiTG9nQ29uZmlndXJhdGlvblwiOiB7XG4gICAgICAgICAgXCJMb2dEcml2ZXJcIjogXCJhd3Nsb2dzXCIsXG4gICAgICAgICAgXCJPcHRpb25zXCI6IHtcbiAgICAgICAgICAgIFwiYXdzbG9ncy1ncm91cFwiOiB7XG4gICAgICAgICAgICAgIFwiUmVmXCI6IFwiZ3JlZXRlcnRhc2tkZWZpbml0aW9uY29uc3VsZWNzbWVzaGluaXRMb2dHcm91cDYxNEJENUQ1XCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImF3c2xvZ3Mtc3RyZWFtLXByZWZpeFwiOiBcImNvbnN1bC1lY3MtbWVzaC1pbml0XCIsXG4gICAgICAgICAgICBcImF3c2xvZ3MtcmVnaW9uXCI6IHtcbiAgICAgICAgICAgICAgXCJSZWZcIjogXCJBV1M6OlJlZ2lvblwiXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcIk1lbW9yeVwiOiAyNTYsXG4gICAgICAgIFwiTW91bnRQb2ludHNcIjogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiQ29udGFpbmVyUGF0aFwiOiBcIi9jb25zdWwvZGF0YVwiLFxuICAgICAgICAgICAgXCJSZWFkT25seVwiOiBmYWxzZSxcbiAgICAgICAgICAgIFwiU291cmNlVm9sdW1lXCI6IFwiY29uc3VsLWRhdGFcIlxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgXCJOYW1lXCI6IFwiY29uc3VsLWVjcy1tZXNoLWluaXRcIixcbiAgICAgICAgXCJVc2VyXCI6IFwicm9vdFwiXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBcIkNvbW1hbmRcIjogW1xuICAgICAgICAgIFwiZW52b3kgLS1jb25maWctcGF0aCAvY29uc3VsL2RhdGEvZW52b3ktYm9vdHN0cmFwLmpzb25cIlxuICAgICAgICBdLFxuICAgICAgICBcIkRlcGVuZHNPblwiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb25kaXRpb25cIjogXCJTVUNDRVNTXCIsXG4gICAgICAgICAgICBcIkNvbnRhaW5lck5hbWVcIjogXCJjb25zdWwtZWNzLW1lc2gtaW5pdFwiXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBcIkVudHJ5UG9pbnRcIjogW1xuICAgICAgICAgIFwiL2Jpbi9zaFwiLFxuICAgICAgICAgIFwiLWNcIlxuICAgICAgICBdLFxuICAgICAgICBcIkVzc2VudGlhbFwiOiBmYWxzZSxcbiAgICAgICAgXCJIZWFsdGhDaGVja1wiOiB7XG4gICAgICAgICAgXCJDb21tYW5kXCI6IFtcbiAgICAgICAgICAgIFwiQ01EXCIsXG4gICAgICAgICAgICBcIm5jXCIsXG4gICAgICAgICAgICBcIi16XCIsXG4gICAgICAgICAgICBcIjEyNy4wLjAuMVwiLFxuICAgICAgICAgICAgXCIyMDAwMFwiXG4gICAgICAgICAgXSxcbiAgICAgICAgICBcIkludGVydmFsXCI6IDMwLFxuICAgICAgICAgIFwiUmV0cmllc1wiOiAzLFxuICAgICAgICAgIFwiVGltZW91dFwiOiA1XG4gICAgICAgIH0sXG4gICAgICAgIFwiSW1hZ2VcIjogXCJteUN1c3RvbUVudm95SW1hZ2U6MS4wXCIsXG4gICAgICAgIFwiTG9nQ29uZmlndXJhdGlvblwiOiB7XG4gICAgICAgICAgXCJMb2dEcml2ZXJcIjogXCJhd3Nsb2dzXCIsXG4gICAgICAgICAgXCJPcHRpb25zXCI6IHtcbiAgICAgICAgICAgIFwiYXdzbG9ncy1ncm91cFwiOiB7XG4gICAgICAgICAgICAgIFwiUmVmXCI6IFwiZ3JlZXRlcnRhc2tkZWZpbml0aW9uc2lkZWNhcnByb3h5TG9nR3JvdXA5MjgwMDFFQVwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgXCJhd3Nsb2dzLXN0cmVhbS1wcmVmaXhcIjogXCJlbnZveVwiLFxuICAgICAgICAgICAgXCJhd3Nsb2dzLXJlZ2lvblwiOiB7XG4gICAgICAgICAgICAgIFwiUmVmXCI6IFwiQVdTOjpSZWdpb25cIlxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgXCJNZW1vcnlcIjogMjU2LFxuICAgICAgICBcIk1vdW50UG9pbnRzXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbnRhaW5lclBhdGhcIjogXCIvY29uc3VsL2RhdGFcIixcbiAgICAgICAgICAgIFwiUmVhZE9ubHlcIjogZmFsc2UsXG4gICAgICAgICAgICBcIlNvdXJjZVZvbHVtZVwiOiBcImNvbnN1bC1kYXRhXCJcbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIFwiTmFtZVwiOiBcInNpZGVjYXItcHJveHlcIixcbiAgICAgICAgXCJQb3J0TWFwcGluZ3NcIjogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiQ29udGFpbmVyUG9ydFwiOiAyMDAwMCxcbiAgICAgICAgICAgIFwiUHJvdG9jb2xcIjogXCJ0Y3BcIlxuICAgICAgICAgIH1cbiAgICAgICAgXVxuICAgICAgfVxuICAgIF0sXG4gICAgXCJDcHVcIjogXCIxMDI0XCIsXG4gICAgXCJFeGVjdXRpb25Sb2xlQXJuXCI6IHtcbiAgICAgIFwiRm46OkdldEF0dFwiOiBbXG4gICAgICAgIFwiZ3JlZXRlcnRhc2tkZWZpbml0aW9uRXhlY3V0aW9uUm9sZUFFRDBFQzc5XCIsXG4gICAgICAgIFwiQXJuXCJcbiAgICAgIF1cbiAgICB9LFxuICAgIFwiRmFtaWx5XCI6IFwiZ3JlZXRlclwiLFxuICAgIFwiTWVtb3J5XCI6IFwiMjA0OFwiLFxuICAgIFwiTmV0d29ya01vZGVcIjogXCJhd3N2cGNcIixcbiAgICBcIlJlcXVpcmVzQ29tcGF0aWJpbGl0aWVzXCI6IFtcbiAgICAgIFwiRUMyXCIsXG4gICAgICBcIkZBUkdBVEVcIlxuICAgIF0sXG4gICAgXCJUYXNrUm9sZUFyblwiOiB7XG4gICAgICBcIkZuOjpHZXRBdHRcIjogW1xuICAgICAgICBcImdyZWV0ZXJ0YXNrZGVmaW5pdGlvblRhc2tSb2xlMkEwOThBQ0NcIixcbiAgICAgICAgXCJBcm5cIlxuICAgICAgXVxuICAgIH0sXG4gICAgXCJWb2x1bWVzXCI6IFtcbiAgICAgIHtcbiAgICAgICAgXCJOYW1lXCI6IFwiY29uc3VsLWRhdGFcIlxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgXCJOYW1lXCI6IFwiY29uc3VsLWNvbmZpZ1wiXG4gICAgICB9XG4gICAgXVxuICB9XG4gICkpO1xuXG4gIGV4cGVjdENESyhzdGFjaykudG8oaGF2ZVJlc291cmNlKCdBV1M6OkVDUzo6VGFza0RlZmluaXRpb24nLCB7XG4gICAgXCJDb250YWluZXJEZWZpbml0aW9uc1wiOiBbXG4gICAgICB7XG4gICAgICAgIFwiQ3B1XCI6IDEwMjQsXG4gICAgICAgIFwiRGVwZW5kc09uXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbmRpdGlvblwiOiBcIlNVQ0NFU1NcIixcbiAgICAgICAgICAgIFwiQ29udGFpbmVyTmFtZVwiOiBcImNvbnN1bC1lY3MtbWVzaC1pbml0XCJcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiQ29uZGl0aW9uXCI6IFwiSEVBTFRIWVwiLFxuICAgICAgICAgICAgXCJDb250YWluZXJOYW1lXCI6IFwic2lkZWNhci1wcm94eVwiXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBcIkVzc2VudGlhbFwiOiB0cnVlLFxuICAgICAgICBcIkltYWdlXCI6IFwibmF0aGFucGVjay9uYW1lXCIsXG4gICAgICAgIFwiTWVtb3J5XCI6IDIwNDgsXG4gICAgICAgIFwiTmFtZVwiOiBcImFwcFwiLFxuICAgICAgICBcIlBvcnRNYXBwaW5nc1wiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb250YWluZXJQb3J0XCI6IDMwMDAsXG4gICAgICAgICAgICBcIlByb3RvY29sXCI6IFwidGNwXCJcbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIFwiVWxpbWl0c1wiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJIYXJkTGltaXRcIjogMTAyNDAwMCxcbiAgICAgICAgICAgIFwiTmFtZVwiOiBcIm5vZmlsZVwiLFxuICAgICAgICAgICAgXCJTb2Z0TGltaXRcIjogMTAyNDAwMFxuICAgICAgICAgIH1cbiAgICAgICAgXVxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgXCJDb21tYW5kXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkZuOjpKb2luXCI6IFtcbiAgICAgICAgICAgICAgXCJcIixcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIFwiRUNTX0lQVjQ9JChjdXJsIC1zICRFQ1NfQ09OVEFJTkVSX01FVEFEQVRBX1VSSSB8IGpxIC1yICcuTmV0d29ya3NbMF0uSVB2NEFkZHJlc3Nlc1swXScpICYmIGlmIFsgdHJ1ZSA9PSB0cnVlIF07IHRoZW4gICAgICAgICAgICAgICAgIGVjaG8gXFxcInt7cmVzb2x2ZTpzZWNyZXRzbWFuYWdlcjphcm46XCIsXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgXCJSZWZcIjogXCJBV1M6OlBhcnRpdGlvblwiXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBcIjpzZWNyZXRzbWFuYWdlcjpcIixcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBcIlJlZlwiOiBcIkFXUzo6UmVnaW9uXCJcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIFwiOlwiLFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIFwiUmVmXCI6IFwiQVdTOjpBY2NvdW50SWRcIlxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXCI6c2VjcmV0OlRMU0VuY3J5cHRWYWx1ZTpTZWNyZXRTdHJpbmc6Ojp9fVxcXCIgPiAvdG1wL2NvbnN1bC1hZ2VudC1jYS1jZXJ0LnBlbTtcXG4gICAgICAgICAgICAgICAgZmkgJiZcXG4gICAgICAgICAgICAgICAgICBleGVjIGNvbnN1bCBhZ2VudCAgICAgICAgICAgICAgICAgICAtYWR2ZXJ0aXNlICRFQ1NfSVBWNCAgICAgICAgICAgICAgICAgICAtZGF0YS1kaXIgL2NvbnN1bC9kYXRhICAgICAgICAgICAgICAgICAgIC1jbGllbnQgMC4wLjAuMCAgICAgICAgICAgICAgICAgICAtaGNsICdhZGRyZXNzZXMgPSB7IGRucyA9IFxcXCIxMjcuMC4wLjFcXFwiIH0nICAgICAgICAgICAgICAgICAgIC1oY2wgJ2FkZHJlc3NlcyA9IHsgZ3JwYyA9IFxcXCIxMjcuMC4wLjFcXFwiIH0nICAgICAgICAgICAgICAgICAgIC1oY2wgJ2FkZHJlc3NlcyA9IHsgaHR0cCA9IFxcXCIxMjcuMC4wLjFcXFwiIH0nICAgICAgICAgICAgICAgICAgIC1yZXRyeS1qb2luIFxcXCJwcm92aWRlcj1hd3MgcmVnaW9uPXVzLXdlc3QtMiB0YWdfa2V5PU5hbWUgdGFnX3ZhbHVlPXRlc3QtY29uc3VsLXNlcnZlclxcXCIgICAgICAgICAgICAgICAgICAgLWhjbCAndGVsZW1ldHJ5IHsgZGlzYWJsZV9jb21wYXRfMS45ID0gdHJ1ZSB9JyAgICAgICAgICAgICAgICAgICAtaGNsICdsZWF2ZV9vbl90ZXJtaW5hdGUgPSB0cnVlJyAgICAgICAgICAgICAgICAgICAtaGNsICdwb3J0cyB7IGdycGMgPSA4NTAyIH0nICAgICAgICAgICAgICAgICAgIC1oY2wgJ2FkdmVydGlzZV9yZWNvbm5lY3RfdGltZW91dCA9IFxcXCIxNW1cXFwiJyAgICAgICAgICAgICAgICAgICAtaGNsICdlbmFibGVfY2VudHJhbF9zZXJ2aWNlX2NvbmZpZyA9IHRydWUnICAgICAgICAgICAgICAgIC1oY2wgJ2NhX2ZpbGUgPSBcXFwiL3RtcC9jb25zdWwtYWdlbnQtY2EtY2VydC5wZW1cXFwiJyAgICAgICAgICAgICAgICAtaGNsICdhdXRvX2VuY3J5cHQgPSB7dGxzID0gdHJ1ZX0nICAgICAgICAgICAgICAgIC1oY2wgXFxcImF1dG9fZW5jcnlwdCA9IHtpcF9zYW4gPSBbIFxcXFxcXFwiJEVDU19JUFY0XFxcXFxcXCIgXX1cXFwiICAgICAgICAgICAgICAgIC1oY2wgJ3ZlcmlmeV9vdXRnb2luZyA9IHRydWUnICAgICAgICAgICAgIC1lbmNyeXB0IFxcXCJ7e3Jlc29sdmU6c2VjcmV0c21hbmFnZXI6YXJuOlwiLFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIFwiUmVmXCI6IFwiQVdTOjpQYXJ0aXRpb25cIlxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXCI6c2VjcmV0c21hbmFnZXI6XCIsXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgXCJSZWZcIjogXCJBV1M6OlJlZ2lvblwiXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBcIjpcIixcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBcIlJlZlwiOiBcIkFXUzo6QWNjb3VudElkXCJcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIFwiOnNlY3JldDpnb3NzaXBFbmNyeXB0VmFsdWU6U2VjcmV0U3RyaW5nOjo6fX1cXFwiXCJcbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgXVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgXCJFbnRyeVBvaW50XCI6IFtcbiAgICAgICAgICBcIi9iaW4vc2hcIixcbiAgICAgICAgICBcIi1lY1wiXG4gICAgICAgIF0sXG4gICAgICAgIFwiRXNzZW50aWFsXCI6IGZhbHNlLFxuICAgICAgICBcIkltYWdlXCI6IFwibXlDdXN0b21Db25zdWxDbGllbnRJbWFnZToxLjBcIixcbiAgICAgICAgXCJMb2dDb25maWd1cmF0aW9uXCI6IHtcbiAgICAgICAgICBcIkxvZ0RyaXZlclwiOiBcImF3c2xvZ3NcIixcbiAgICAgICAgICBcIk9wdGlvbnNcIjoge1xuICAgICAgICAgICAgXCJhd3Nsb2dzLWdyb3VwXCI6IHtcbiAgICAgICAgICAgICAgXCJSZWZcIjogXCJuYW1ldGFza2RlZmluaXRpb25jb25zdWxjbGllbnRMb2dHcm91cDVDM0NDNzgxXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImF3c2xvZ3Mtc3RyZWFtLXByZWZpeFwiOiBcImNvbnN1bC1jbGllbnRcIixcbiAgICAgICAgICAgIFwiYXdzbG9ncy1yZWdpb25cIjoge1xuICAgICAgICAgICAgICBcIlJlZlwiOiBcIkFXUzo6UmVnaW9uXCJcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFwiTWVtb3J5XCI6IDI1NixcbiAgICAgICAgXCJNb3VudFBvaW50c1wiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb250YWluZXJQYXRoXCI6IFwiL2NvbnN1bC9kYXRhXCIsXG4gICAgICAgICAgICBcIlJlYWRPbmx5XCI6IGZhbHNlLFxuICAgICAgICAgICAgXCJTb3VyY2VWb2x1bWVcIjogXCJjb25zdWwtZGF0YVwiXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbnRhaW5lclBhdGhcIjogXCIvY29uc3VsL2NvbmZpZ1wiLFxuICAgICAgICAgICAgXCJSZWFkT25seVwiOiBmYWxzZSxcbiAgICAgICAgICAgIFwiU291cmNlVm9sdW1lXCI6IFwiY29uc3VsLWNvbmZpZ1wiXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBcIk5hbWVcIjogXCJjb25zdWwtY2xpZW50XCIsXG4gICAgICAgIFwiUG9ydE1hcHBpbmdzXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbnRhaW5lclBvcnRcIjogODMwMSxcbiAgICAgICAgICAgIFwiUHJvdG9jb2xcIjogXCJ0Y3BcIlxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb250YWluZXJQb3J0XCI6IDgzMDEsXG4gICAgICAgICAgICBcIlByb3RvY29sXCI6IFwidWRwXCJcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiQ29udGFpbmVyUG9ydFwiOiA4NTAwLFxuICAgICAgICAgICAgXCJQcm90b2NvbFwiOiBcInRjcFwiXG4gICAgICAgICAgfVxuICAgICAgICBdXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBcIkNvbW1hbmRcIjogW1xuICAgICAgICAgIFwibWVzaC1pbml0XCIsXG4gICAgICAgICAgXCItZW52b3ktYm9vdHN0cmFwLWZpbGU9L2NvbnN1bC9kYXRhL2Vudm95LWJvb3RzdHJhcC5qc29uXCIsXG4gICAgICAgICAgXCItcG9ydD0zMDAwXCIsXG4gICAgICAgICAgXCItdXBzdHJlYW1zPVwiXG4gICAgICAgIF0sXG4gICAgICAgIFwiRXNzZW50aWFsXCI6IGZhbHNlLFxuICAgICAgICBcIkltYWdlXCI6IFwibXlDdXN0b21Db25zdWxFY3NJbWFnZToxLjBcIixcbiAgICAgICAgXCJMb2dDb25maWd1cmF0aW9uXCI6IHtcbiAgICAgICAgICBcIkxvZ0RyaXZlclwiOiBcImF3c2xvZ3NcIixcbiAgICAgICAgICBcIk9wdGlvbnNcIjoge1xuICAgICAgICAgICAgXCJhd3Nsb2dzLWdyb3VwXCI6IHtcbiAgICAgICAgICAgICAgXCJSZWZcIjogXCJuYW1ldGFza2RlZmluaXRpb25jb25zdWxlY3NtZXNoaW5pdExvZ0dyb3VwQkUxMzUyNUFcIlxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIFwiYXdzbG9ncy1zdHJlYW0tcHJlZml4XCI6IFwiY29uc3VsLWVjcy1tZXNoLWluaXRcIixcbiAgICAgICAgICAgIFwiYXdzbG9ncy1yZWdpb25cIjoge1xuICAgICAgICAgICAgICBcIlJlZlwiOiBcIkFXUzo6UmVnaW9uXCJcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFwiTWVtb3J5XCI6IDI1NixcbiAgICAgICAgXCJNb3VudFBvaW50c1wiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb250YWluZXJQYXRoXCI6IFwiL2NvbnN1bC9kYXRhXCIsXG4gICAgICAgICAgICBcIlJlYWRPbmx5XCI6IGZhbHNlLFxuICAgICAgICAgICAgXCJTb3VyY2VWb2x1bWVcIjogXCJjb25zdWwtZGF0YVwiXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICBcIk5hbWVcIjogXCJjb25zdWwtZWNzLW1lc2gtaW5pdFwiLFxuICAgICAgICBcIlVzZXJcIjogXCJyb290XCJcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIFwiQ29tbWFuZFwiOiBbXG4gICAgICAgICAgXCJlbnZveSAtLWNvbmZpZy1wYXRoIC9jb25zdWwvZGF0YS9lbnZveS1ib290c3RyYXAuanNvblwiXG4gICAgICAgIF0sXG4gICAgICAgIFwiRGVwZW5kc09uXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkNvbmRpdGlvblwiOiBcIlNVQ0NFU1NcIixcbiAgICAgICAgICAgIFwiQ29udGFpbmVyTmFtZVwiOiBcImNvbnN1bC1lY3MtbWVzaC1pbml0XCJcbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIFwiRW50cnlQb2ludFwiOiBbXG4gICAgICAgICAgXCIvYmluL3NoXCIsXG4gICAgICAgICAgXCItY1wiXG4gICAgICAgIF0sXG4gICAgICAgIFwiRXNzZW50aWFsXCI6IGZhbHNlLFxuICAgICAgICBcIkhlYWx0aENoZWNrXCI6IHtcbiAgICAgICAgICBcIkNvbW1hbmRcIjogW1xuICAgICAgICAgICAgXCJDTURcIixcbiAgICAgICAgICAgIFwibmNcIixcbiAgICAgICAgICAgIFwiLXpcIixcbiAgICAgICAgICAgIFwiMTI3LjAuMC4xXCIsXG4gICAgICAgICAgICBcIjIwMDAwXCJcbiAgICAgICAgICBdLFxuICAgICAgICAgIFwiSW50ZXJ2YWxcIjogMzAsXG4gICAgICAgICAgXCJSZXRyaWVzXCI6IDMsXG4gICAgICAgICAgXCJUaW1lb3V0XCI6IDVcbiAgICAgICAgfSxcbiAgICAgICAgXCJJbWFnZVwiOiBcIm15Q3VzdG9tRW52b3lJbWFnZToxLjBcIixcbiAgICAgICAgXCJMb2dDb25maWd1cmF0aW9uXCI6IHtcbiAgICAgICAgICBcIkxvZ0RyaXZlclwiOiBcImF3c2xvZ3NcIixcbiAgICAgICAgICBcIk9wdGlvbnNcIjoge1xuICAgICAgICAgICAgXCJhd3Nsb2dzLWdyb3VwXCI6IHtcbiAgICAgICAgICAgICAgXCJSZWZcIjogXCJuYW1ldGFza2RlZmluaXRpb25zaWRlY2FycHJveHlMb2dHcm91cDFGNTg4OUMyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBcImF3c2xvZ3Mtc3RyZWFtLXByZWZpeFwiOiBcImVudm95XCIsXG4gICAgICAgICAgICBcImF3c2xvZ3MtcmVnaW9uXCI6IHtcbiAgICAgICAgICAgICAgXCJSZWZcIjogXCJBV1M6OlJlZ2lvblwiXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBcIk1lbW9yeVwiOiAyNTYsXG4gICAgICAgIFwiTW91bnRQb2ludHNcIjogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiQ29udGFpbmVyUGF0aFwiOiBcIi9jb25zdWwvZGF0YVwiLFxuICAgICAgICAgICAgXCJSZWFkT25seVwiOiBmYWxzZSxcbiAgICAgICAgICAgIFwiU291cmNlVm9sdW1lXCI6IFwiY29uc3VsLWRhdGFcIlxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgXCJOYW1lXCI6IFwic2lkZWNhci1wcm94eVwiLFxuICAgICAgICBcIlBvcnRNYXBwaW5nc1wiOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJDb250YWluZXJQb3J0XCI6IDIwMDAwLFxuICAgICAgICAgICAgXCJQcm90b2NvbFwiOiBcInRjcFwiXG4gICAgICAgICAgfVxuICAgICAgICBdXG4gICAgICB9XG4gICAgXSxcbiAgICBcIkNwdVwiOiBcIjEwMjRcIixcbiAgICBcIkV4ZWN1dGlvblJvbGVBcm5cIjoge1xuICAgICAgXCJGbjo6R2V0QXR0XCI6IFtcbiAgICAgICAgXCJuYW1ldGFza2RlZmluaXRpb25FeGVjdXRpb25Sb2xlNDVBQzVDOUFcIixcbiAgICAgICAgXCJBcm5cIlxuICAgICAgXVxuICAgIH0sXG4gICAgXCJGYW1pbHlcIjogXCJuYW1lXCIsXG4gICAgXCJNZW1vcnlcIjogXCIyMDQ4XCIsXG4gICAgXCJOZXR3b3JrTW9kZVwiOiBcImF3c3ZwY1wiLFxuICAgIFwiUmVxdWlyZXNDb21wYXRpYmlsaXRpZXNcIjogW1xuICAgICAgXCJFQzJcIixcbiAgICAgIFwiRkFSR0FURVwiXG4gICAgXSxcbiAgICBcIlRhc2tSb2xlQXJuXCI6IHtcbiAgICAgIFwiRm46OkdldEF0dFwiOiBbXG4gICAgICAgIFwibmFtZXRhc2tkZWZpbml0aW9uVGFza1JvbGU1MEZFODQ0RVwiLFxuICAgICAgICBcIkFyblwiXG4gICAgICBdXG4gICAgfSxcbiAgICBcIlZvbHVtZXNcIjogW1xuICAgICAge1xuICAgICAgICBcIk5hbWVcIjogXCJjb25zdWwtZGF0YVwiXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBcIk5hbWVcIjogXCJjb25zdWwtY29uZmlnXCJcbiAgICAgIH1cbiAgICBdXG4gIH1cbiAgKSk7XG4gIGV4cGVjdENESyhzdGFjaykudG8oaGF2ZVJlc291cmNlKCdBV1M6OkVDUzo6U2VydmljZScsIHtcbiAgICBcIkNsdXN0ZXJcIjoge1xuICAgICAgXCJSZWZcIjogXCJwcm9kdWN0aW9uZW52aXJvbm1lbnRjbHVzdGVyQzY1OTlEMkRcIlxuICAgIH0sXG4gICAgXCJEZXBsb3ltZW50Q29uZmlndXJhdGlvblwiOiB7XG4gICAgICBcIk1heGltdW1QZXJjZW50XCI6IDIwMCxcbiAgICAgIFwiTWluaW11bUhlYWx0aHlQZXJjZW50XCI6IDEwMFxuICAgIH0sXG4gICAgXCJEZXNpcmVkQ291bnRcIjogMSxcbiAgICBcIkVuYWJsZUVDU01hbmFnZWRUYWdzXCI6IGZhbHNlLFxuICAgIFwiTGF1bmNoVHlwZVwiOiBcIkZBUkdBVEVcIixcbiAgICBcIk5ldHdvcmtDb25maWd1cmF0aW9uXCI6IHtcbiAgICAgIFwiQXdzdnBjQ29uZmlndXJhdGlvblwiOiB7XG4gICAgICAgIFwiQXNzaWduUHVibGljSXBcIjogXCJESVNBQkxFRFwiLFxuICAgICAgICBcIlNlY3VyaXR5R3JvdXBzXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkZuOjpHZXRBdHRcIjogW1xuICAgICAgICAgICAgICBcIm5hbWVzZXJ2aWNlU2VjdXJpdHlHcm91cDMzRjQ2NjJDXCIsXG4gICAgICAgICAgICAgIFwiR3JvdXBJZFwiXG4gICAgICAgICAgICBdXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIkZuOjpHZXRBdHRcIjogW1xuICAgICAgICAgICAgICBcImNvbnN1bENsaWVudFNlY3VyaXR5R3JvdXAyNzlEMzM3M1wiLFxuICAgICAgICAgICAgICBcIkdyb3VwSWRcIlxuICAgICAgICAgICAgXVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgXCJTdWJuZXRzXCI6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcIlJlZlwiOiBcInByb2R1Y3Rpb25lbnZpcm9ubWVudHZwY1ByaXZhdGVTdWJuZXQxU3VibmV0NTNGNjMyRTZcIlxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJSZWZcIjogXCJwcm9kdWN0aW9uZW52aXJvbm1lbnR2cGNQcml2YXRlU3VibmV0MlN1Ym5ldDc1NkZCOTNDXCJcbiAgICAgICAgICB9XG4gICAgICAgIF1cbiAgICAgIH1cbiAgICB9LFxuICAgIFwiVGFza0RlZmluaXRpb25cIjoge1xuICAgICAgXCJSZWZcIjogXCJuYW1ldGFza2RlZmluaXRpb242OTA3NjJCQlwiXG4gICAgfSBcbn0pKTtcblxuZXhwZWN0Q0RLKHN0YWNrKS50byhoYXZlUmVzb3VyY2UoJ0FXUzo6RUNTOjpTZXJ2aWNlJywge1xuICBcIkNsdXN0ZXJcIjoge1xuICAgIFwiUmVmXCI6IFwicHJvZHVjdGlvbmVudmlyb25tZW50Y2x1c3RlckM2NTk5RDJEXCJcbiAgfSxcbiAgXCJEZXBsb3ltZW50Q29uZmlndXJhdGlvblwiOiB7XG4gICAgXCJNYXhpbXVtUGVyY2VudFwiOiAyMDAsXG4gICAgXCJNaW5pbXVtSGVhbHRoeVBlcmNlbnRcIjogMTAwXG4gIH0sXG4gIFwiRGVzaXJlZENvdW50XCI6IDEsXG4gIFwiRW5hYmxlRUNTTWFuYWdlZFRhZ3NcIjogZmFsc2UsXG4gIFwiTGF1bmNoVHlwZVwiOiBcIkZBUkdBVEVcIixcbiAgXCJOZXR3b3JrQ29uZmlndXJhdGlvblwiOiB7XG4gICAgXCJBd3N2cGNDb25maWd1cmF0aW9uXCI6IHtcbiAgICAgIFwiQXNzaWduUHVibGljSXBcIjogXCJESVNBQkxFRFwiLFxuICAgICAgXCJTZWN1cml0eUdyb3Vwc1wiOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBcIkZuOjpHZXRBdHRcIjogW1xuICAgICAgICAgICAgXCJncmVldGVyc2VydmljZVNlY3VyaXR5R3JvdXBEQjRBQzNBOVwiLFxuICAgICAgICAgICAgXCJHcm91cElkXCJcbiAgICAgICAgICBdXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBcIkZuOjpHZXRBdHRcIjogW1xuICAgICAgICAgICAgXCJjb25zdWxDbGllbnRTZWN1cml0eUdyb3VwMjc5RDMzNzNcIixcbiAgICAgICAgICAgIFwiR3JvdXBJZFwiXG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICBdLFxuICAgICAgXCJTdWJuZXRzXCI6IFtcbiAgICAgICAge1xuICAgICAgICAgIFwiUmVmXCI6IFwicHJvZHVjdGlvbmVudmlyb25tZW50dnBjUHJpdmF0ZVN1Ym5ldDFTdWJuZXQ1M0Y2MzJFNlwiXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBcIlJlZlwiOiBcInByb2R1Y3Rpb25lbnZpcm9ubWVudHZwY1ByaXZhdGVTdWJuZXQyU3VibmV0NzU2RkI5M0NcIlxuICAgICAgICB9XG4gICAgICBdXG4gICAgfVxuICB9LFxuICBcIlRhc2tEZWZpbml0aW9uXCI6IHtcbiAgICBcIlJlZlwiOiBcImdyZWV0ZXJ0YXNrZGVmaW5pdGlvbkU5NTZFRUEyXCJcbiAgfVxufSkpO1xufSk7XG5cblxudGVzdCgnc2hvdWxkIGRldGVjdCB3aGVuIGF0dGVtcHRpbmcgdG8gY29ubmVjdCBzZXJ2aWNlcyBmcm9tIHR3byBkaWZmZXJlbnQgZW52cycsICgpID0+IHtcbiAvLyBHSVZFTlxuY29uc3Qgc3RhY2sgPSBuZXcgY2RrLlN0YWNrKCk7XG5cbi8vIFdIRU5cbmNvbnN0IHByb2R1Y3Rpb24gPSBuZXcgRW52aXJvbm1lbnQoc3RhY2ssICdwcm9kdWN0aW9uJyk7XG5jb25zdCBkZXZlbG9wbWVudCA9IG5ldyBFbnZpcm9ubWVudChzdGFjaywgJ2RldmVsb3BtZW50Jyk7XG5cbiAgY29uc3QgY29uc3VsU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cChzdGFjaywgJ2NvbnN1bFNlcnZlclNlY3VyaXR5R3JvdXAnLCB7XG4gICAgdnBjOiBwcm9kdWN0aW9uLnZwY1xuICB9KTtcblxuICBjb25zdCBjb25zdWxDbGllbnRTZXJjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cChzdGFjaywgJ2NvbnN1bENsaWVudFNlY3VyaXR5R3JvdXAnLCB7XG4gICAgdnBjOiBwcm9kdWN0aW9uLnZwY1xuICB9KTtcblxuICBjb25zdWxDbGllbnRTZXJjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICBjb25zdWxDbGllbnRTZXJjdXJpdHlHcm91cCxcbiAgICBlYzIuUG9ydC50Y3AoODMwMSksXG4gICAgXCJhbGxvdyBhbGwgdGhlIGNsaWVudHMgaW4gdGhlIG1lc2ggdGFsayB0byBlYWNoIG90aGVyXCJcbiAgKTtcbiAgY29uc3VsQ2xpZW50U2VyY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgY29uc3VsQ2xpZW50U2VyY3VyaXR5R3JvdXAsXG4gICAgZWMyLlBvcnQudWRwKDgzMDEpLFxuICAgIFwiYWxsb3cgYWxsIHRoZSBjbGllbnRzIGluIHRoZSBtZXNoIHRhbGsgdG8gZWFjaCBvdGhlclwiXG4gIClcblxuICBjb25zdCBuYW1lRGVzY3JpcHRpb24gPSBuZXcgU2VydmljZURlc2NyaXB0aW9uKCk7XG4gIG5hbWVEZXNjcmlwdGlvbi5hZGQobmV3IENvbnRhaW5lcih7XG4gICAgY3B1OiAxMDI0LFxuICAgIG1lbW9yeU1pQjogMjA0OCxcbiAgICB0cmFmZmljUG9ydDogMzAwMCxcbiAgICBpbWFnZTogZWNzLkNvbnRhaW5lckltYWdlLmZyb21SZWdpc3RyeSgnbmF0aGFucGVjay9uYW1lJylcbiAgfSkpO1xuXG4gIG5hbWVEZXNjcmlwdGlvbi5hZGQobmV3IENvbnN1bE1lc2hFeHRlbnNpb24oe1xuICAgIHJldHJ5Sm9pbjogXCJwcm92aWRlcj1hd3MgcmVnaW9uPXVzLXdlc3QtMiB0YWdfa2V5PU5hbWUgdGFnX3ZhbHVlPXRlc3QtY29uc3VsLXNlcnZlclwiLFxuICAgIGNvbnN1bFNlcnZlclNlcmN1cml0eUdyb3VwOiBjb25zdWxTZWN1cml0eUdyb3VwLFxuICAgIHBvcnQ6IDMwMDAsXG4gICAgY29uc3VsQ2xpZW50SW1hZ2U6IFwibXlDdXN0b21Db25zdWxDbGllbnRJbWFnZToxLjBcIixcbiAgICBjb25zdWxFY3NJbWFnZTogXCJteUN1c3RvbUNvbnN1bEVjc0ltYWdlOjEuMFwiLFxuICAgIGVudm95UHJveHlJbWFnZTogXCJteUN1c3RvbUVudm95SW1hZ2U6MS4wXCIsXG4gICAgY29uc3VsQ2xpZW50U2VyY3VyaXR5R3JvdXAsXG4gICAgZmFtaWx5OiBcIm5hbWVcIlxuICB9KSk7XG5cbiAgY29uc3QgbmFtZVNlcnZpY2UgPSBuZXcgU2VydmljZShzdGFjaywgJ25hbWUnLCB7XG4gICAgZW52aXJvbm1lbnQ6IGRldmVsb3BtZW50LFxuICAgIHNlcnZpY2VEZXNjcmlwdGlvbjogbmFtZURlc2NyaXB0aW9uXG4gIH0pO1xuXG4gIC8vIGxhdW5jaCBzZXJ2aWNlIGludG8gdGhhdCBjbHVzdGVyXG4gIGNvbnN0IGdyZWV0ZXJEZXNjcmlwdGlvbiA9IG5ldyBTZXJ2aWNlRGVzY3JpcHRpb24oKTtcbiAgZ3JlZXRlckRlc2NyaXB0aW9uLmFkZChuZXcgQ29udGFpbmVyKHtcbiAgICBjcHU6IDEwMjQsXG4gICAgbWVtb3J5TWlCOiAyMDQ4LFxuICAgIHRyYWZmaWNQb3J0OiAzMDAwLFxuICAgIGltYWdlOiBlY3MuQ29udGFpbmVySW1hZ2UuZnJvbVJlZ2lzdHJ5KCduYXRoYW5wZWNrL2dyZWV0ZXInKVxuICB9KSk7XG5cbiAgZ3JlZXRlckRlc2NyaXB0aW9uLmFkZChuZXcgQ29uc3VsTWVzaEV4dGVuc2lvbih7XG4gICAgcmV0cnlKb2luOiBcInByb3ZpZGVyPWF3cyByZWdpb249dXMtd2VzdC0yIHRhZ19rZXk9TmFtZSB0YWdfdmFsdWU9dGVzdC1jb25zdWwtc2VydmVyXCIsIC8vIHVzZSBpbnRlcmZhY2UsIHVzZSBFTlVNc1xuICAgIGNvbnN1bFNlcnZlclNlcmN1cml0eUdyb3VwOiBjb25zdWxTZWN1cml0eUdyb3VwLFxuICAgIHBvcnQ6IDMwMDAsXG4gICAgY29uc3VsQ2xpZW50SW1hZ2U6IFwibXlDdXN0b21Db25zdWxDbGllbnRJbWFnZToxLjBcIixcbiAgICBjb25zdWxFY3NJbWFnZTogXCJteUN1c3RvbUNvbnN1bEVjc0ltYWdlOjEuMFwiLFxuICAgIGVudm95UHJveHlJbWFnZTogXCJteUN1c3RvbUVudm95SW1hZ2U6MS4wXCIsXG4gICAgY29uc3VsQ2xpZW50U2VyY3VyaXR5R3JvdXAsXG4gICAgZmFtaWx5OiBcImdyZWV0ZXJcIlxuICB9KSk7XG5cbiAgY29uc3QgZ3JlZXRlclNlcnZpY2UgPSBuZXcgU2VydmljZShzdGFjaywgJ2dyZWV0ZXInLCB7XG4gICAgZW52aXJvbm1lbnQ6IHByb2R1Y3Rpb24sXG4gICAgc2VydmljZURlc2NyaXB0aW9uOiBncmVldGVyRGVzY3JpcHRpb24sXG4gIH0pO1xuXG4gIC8vIFRIRU5cbiAgZXhwZWN0KCgpID0+IHtcbiAgICBncmVldGVyU2VydmljZS5jb25uZWN0VG8obmFtZVNlcnZpY2UpO1xuICB9KS50b1Rocm93KFwiVW5hYmxlIHRvIGNvbm5lY3Qgc2VydmljZXMgZnJvbSBkaWZmZXJlbnQgZW52aXJvbm1lbnRzXCIpO1xuXG59KTtcblxufSk7Il19