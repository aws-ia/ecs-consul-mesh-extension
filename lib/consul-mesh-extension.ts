import * as cdk from '@aws-cdk/core';
import { ISecurityGroup, Port } from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import { Policy, PolicyStatement } from '@aws-cdk/aws-iam'
import {
    ServiceExtension,
    Service,
    Container,
    ContainerMutatingHook,
    ConnectToProps
} from '@aws-cdk-containers/ecs-service-extensions';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager'

/**
 * envoy, consul and consul-ecs container images
 */
const CONSUL_CONTAINER_IMAGE = 'hashicorp/consul:1.10.4';
const CONSUL_ECS_CONTAINER_IMAGE = 'hashicorp/consul-ecs:0.2.0';
const ENVOY_CONTAINER_IMAGE = 'envoyproxy/envoy-alpine:v1.18.4';
const maxSecurityGroupLimit = 5;
let environment: {  //environment variable is used to hold the environment details from app container
    [key: string]: string;
} = {};

export enum CloudProviders {
    AWS_CLOUDPROVIDER = 'aws',
    HASHICORP_CLOUDPROVIDER = 'hcp'
}

export interface RetryJoinProps {
    /**
     * Cloud provider of the consul server
     */
    provider?: CloudProviders;
    /**
     * Region in which your consul server lives
     */
    region: string;
    /**
     * tag name for the consul server
     */
    tagName: string
    /**
     * tag value of the consul server i.e. name of the consul server 
     */
    tagValue: string;
}

export interface IRetryJoin{
    getRetryjoinString(): string;
}

export class RetryJoin implements IRetryJoin{

    provider?: CloudProviders;
    region?: string;
    tagName?: string
    tagValue?: string;
    constructor(props: RetryJoinProps) {
        this.provider = props.provider || CloudProviders.AWS_CLOUDPROVIDER,
            this.region = props.region,
            this.tagName = props.tagName,
            this.tagValue = props.tagValue
    }

    public getRetryjoinString(): string {
        return "provider=" + this.provider + " region=" + this.region + " tag_key="
            + this.tagName + " tag_value=" + this.tagValue;
    }
}

/**
 *  The settings for the Consul Mesh extension
 */
export interface ECSConsulMeshProps {

    /**
     * The cloud auto-join arguemnt to pass to Consul for server discovery
     */
    readonly retryJoin: IRetryJoin;

    /**
     * The security group of the consul servers to which this extension 
     * should be configured to connect
     */
    readonly consulServerSecurityGroup: ISecurityGroup;

    /**
     * Consul container image.
     * 
     * @default hashicorp/consul:1.9.5
     */
    readonly consulClientImage?: string;

    /**
     * Envoy container image.
     * 
     * @default envoyproxy/envoy-alpine:v1.16.2
     */
    readonly envoyProxyImage?: string;

    /**
     * consul-ecs container image.
     * 
     * @default hashicorp/consul-ecs:0.1.2
     */
    readonly consulEcsImage?: string;

    /**
     * The security group to allow mesh-task containers to talk to each other.
     * Typically, this is a security that allow ingress from ports "8301/tcp" and "8301/udp".
     */
    readonly consulClientSecurityGroup: ISecurityGroup;

    /**
     * Consul CA certificate 
     */
    readonly consulCACert?: secretsmanager.ISecret

    /**
     * TLS encryption flag
     */
    readonly tls?: boolean

    /**
    * Gossip encryption key
    */
    readonly gossipEncryptKey?: secretsmanager.ISecret;

    /**
     * Service discovery name of the service
     */
    readonly serviceDiscoveryName: string;

    /**
     * consul datacenter name
     */
    readonly consulDatacenter?: string;
}

/**
 * This extension adds a consul client, envoy proxy, and mesh-init sidecars
 * to the task definition and configures them to enable the task to 
 * communicate via the service mesh
 */
export class ECSConsulMeshExtension extends ServiceExtension {

    private retryJoin: IRetryJoin;
    private consulServerSecurityGroup: ISecurityGroup;
    private consulClientImage: string;
    private envoyProxyImage: string;
    private consulEcsImage: string;
    private consulClientSecurityGroup: ISecurityGroup;
    private meshInit: ecs.ContainerDefinition;
    private upstreamPort: number;
    private upstreamStringArray: string[] = [];  //upstream string array is used to store the upstream records
    /**
 * parentServiceEnvironments variable contains env variables from app container plus extension generated ones.
 * e.g. if app container has environment variable { region: "us-east-1" } then this will be added to the
 * extension generated env variables. Extension generates env variables like { GREETING_URL: "http://localhost:3000" }"
 */
    private parentServiceEnvironments: {
        Name: string,
        Value: string
    }[] = [];
    private consulCACert?: secretsmanager.ISecret;
    private tls?: boolean;
    private gossipEncryptKey?: secretsmanager.ISecret;
    private serviceDiscoveryName: string;
    private consulDatacenter?: string;

    constructor(props: ECSConsulMeshProps) {
        super('consul');
        this.retryJoin = props.retryJoin;
        this.consulServerSecurityGroup = props.consulServerSecurityGroup;
        this.consulClientImage = props.consulClientImage || CONSUL_CONTAINER_IMAGE;
        this.envoyProxyImage = props.envoyProxyImage || ENVOY_CONTAINER_IMAGE;
        this.consulEcsImage = props.consulEcsImage || CONSUL_ECS_CONTAINER_IMAGE;
        this.consulClientSecurityGroup = props.consulClientSecurityGroup;
        this.upstreamPort = 3001;
        this.tls = props.tls || false;
        this.consulCACert = props.consulCACert;
        this.gossipEncryptKey = props.gossipEncryptKey;
        this.serviceDiscoveryName = props.serviceDiscoveryName;
        this.consulDatacenter = props.consulDatacenter || "dc1";
    }

    /**
     * This hook is responsible for calling ConsulMeshMutatingHook and setting app container environment 
     * variables to the glabal environment variable parameter.
     */
    public addHooks() {
        const container = this.parentService.serviceDescription.get('service-container') as Container;
        if (!container) {
            throw new Error('Consul Mesh extension requires an application extension');
        }
        container.addContainerMutatingHook(new ConsulMeshsMutatingHook());
    }

    /**
     * This hook defines the parent service and the scope of the extension
     * @param service The parent service which this extension has been added to
     * @param scope The scope that this extension should create resources in
     */
    public prehook(service: Service, scope: cdk.Construct) {
        this.parentService = service;
        this.scope = scope;
    }

    /**
     * This hook is responsible for adding required side-cars 
     * (i.e. consul-proxy, consul-client and consul-ecs-mesh-init)
     * to the application service. Also adding the required permissions to the 
     * existing task role
     * 
     * @param taskDefinition The created task definition to add containers to
     */
    public useTaskDefinition(taskDefinition: ecs.TaskDefinition) {

        const serviceContainer = this.parentService.serviceDescription.get('service-container') as Container;

        if(serviceContainer == undefined){
            throw new Error(`Cannot find service-container`);
        }

        new Policy(this.scope, `task-role-${this.parentService.id}`, {
            roles: [taskDefinition.taskRole],
            statements: [
                new PolicyStatement({
                    actions: ['ec2:DescribeInstances'],
                    resources: ['*'],
                    conditions: {
                        StringEquals: {
                            "aws:RequestedRegion": cdk.Stack.of(this.parentService).region
                        }
                    }
                }),
            ],
        });

        //Add volumes to the task definition
        taskDefinition.addVolume({
            name: "consul-data"
        });
        taskDefinition.addVolume({
            name: "consul-config"
        });
        taskDefinition.addVolume({
            name: "consul_binary"
        });

        //Consul agent config starts here
        const consulClient = taskDefinition.addContainer('consul-client', {
            image: ecs.ContainerImage.fromRegistry(this.consulClientImage),
            essential: false,
            memoryLimitMiB: 256,
            portMappings: [
                {
                    containerPort: 8301,
                    protocol: ecs.Protocol.TCP
                },
                {
                    containerPort: 8301,
                    protocol: ecs.Protocol.UDP
                },
                {
                    containerPort: 8500,
                    protocol: ecs.Protocol.TCP
                }
            ],
            logging: new ecs.AwsLogDriver({ streamPrefix: 'consul-client' }),
            entryPoint: ["/bin/sh", "-ec"],
            command: this.buildConsulClientCommand
        });

        consulClient.addMountPoints(
            {
                containerPath: "/consul/data",
                sourceVolume: "consul-data",
                readOnly: false
            },
            {
                containerPath: "/consul/config",
                sourceVolume: "consul-config",
                readOnly: false
            },
            {
                containerPath: "/bin/consul-inject",
                sourceVolume: "consul_binary",
                readOnly: false
            }
        );

        //Mesh init config starts here
        this.meshInit = taskDefinition.addContainer('consul-ecs-mesh-init', {
            image: ecs.ContainerImage.fromRegistry(this.consulEcsImage),
            memoryLimitMiB: 256,
            command: ["mesh-init",
                "-envoy-bootstrap-dir=/consul/data",
                "-port=" + serviceContainer.trafficPort,
                "-upstreams=" + this.buildUpstreamString,
                "-service-name=" + this.serviceDiscoveryName],
            logging: new ecs.AwsLogDriver({ streamPrefix: 'consul-ecs-mesh-init' }),
            essential: false,
            user: "root" // TODO: check if this permission is required
        });

        this.meshInit.addMountPoints({
            containerPath: "/consul/data",
            sourceVolume: "consul-data",
            readOnly: false
        },
            {
                containerPath: "/bin/consul-inject",
                sourceVolume: "consul_binary",
                readOnly: true
            });


        //Proxy config starts here
        this.container = taskDefinition.addContainer('sidecar-proxy', {
            image: ecs.ContainerImage.fromRegistry(this.envoyProxyImage),
            memoryLimitMiB: 256,
            entryPoint: ["/consul/data/consul-ecs", "envoy-entrypoint"],
            command: ["/bin/sh", "-c", "envoy --config-path /consul/data/envoy-bootstrap.json"],
            logging: new ecs.AwsLogDriver({ streamPrefix: 'envoy' }),
            portMappings: [{
                containerPort: 20000,
                protocol: ecs.Protocol.TCP
            }],
            healthCheck: {
                command: ["nc", "-z", "127.0.0.1", "20000"],
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(5),
                retries: 3,
            },
            essential: false
        });

        this.container.addContainerDependencies(
            {
                container: this.meshInit,
                condition: ecs.ContainerDependencyCondition.SUCCESS
            }
        );

        this.container.addMountPoints(
            {
                containerPath: "/consul/data",
                sourceVolume: "consul-data",
                readOnly: false
            }
        );
    }

    private get buildConsulClientCommand(): string[] {
        let TLSCommand = "";
        let gossipCommand = "";
        if (this.tls) {
            TLSCommand = ` \
               -hcl 'ca_file = "/tmp/consul-agent-ca-cert.pem"' \
               -hcl 'auto_encrypt = {tls = true}' \
               -hcl "auto_encrypt = {ip_san = [ \\"$ECS_IPV4\\" ]}" \
               -hcl 'verify_outgoing = true'`;
        }

        if (this.gossipEncryptKey) {
            gossipCommand = ` \
            -encrypt "${this.gossipEncryptKey?.secretValue}"`;
        }

        return [`cp /bin/consul /bin/consul-inject/consul &&
                ECS_IPV4=$(curl -s $ECS_CONTAINER_METADATA_URI | jq -r '.Networks[0].IPv4Addresses[0]') && if [ ${this.tls} == true ]; then \
                echo "${this.consulCACert?.secretValue}" > /tmp/consul-agent-ca-cert.pem;
                fi &&
                  exec consul agent \
                  -advertise $ECS_IPV4 \
                  -data-dir /consul/data \
                  -client 0.0.0.0 \
                  -datacenter "${this.consulDatacenter}" \
                  -hcl 'addresses = { dns = "127.0.0.1" }' \
                  -hcl 'addresses = { grpc = "127.0.0.1" }' \
                  -hcl 'addresses = { http = "127.0.0.1" }' \
                  -retry-join "${this.retryJoin.getRetryjoinString()}" \
                  -hcl 'telemetry { disable_compat_1.9 = true }' \
                  -hcl 'leave_on_terminate = true' \
                  -hcl 'ports { grpc = 8502 }' \
                  -hcl 'advertise_reconnect_timeout = "15m"' \
                  -hcl 'enable_central_service_config = true'` + TLSCommand + gossipCommand]
    }

    /**
     * This hook is responsible for adding required dependencies to the app container
     */
    public resolveContainerDependencies() {
        if (!this.container || !this.meshInit) {
            throw new Error('The container dependency hook was called before the container was created');
        }

        const serviceContainer = this.parentService.serviceDescription.get('service-container') as Container;

        if (serviceContainer && serviceContainer.container) {
            serviceContainer.container.addContainerDependencies({
                container: this.meshInit,
                condition: ecs.ContainerDependencyCondition.SUCCESS,
            });

            serviceContainer.container.addContainerDependencies({
                container: this.container,
                condition: ecs.ContainerDependencyCondition.HEALTHY,
            });
        }
    }

    /**
     * This hook is responsible for adding required ingress and egress rules to the security group
     * of the server as well as the service. It is also accountable for adding consulClientSecurityGroup
     * to the parent service to let clients in the mesh talk to each other.
     * 
     * @param service The generated service.
     */
    public useService(service: ecs.Ec2Service | ecs.FargateService) {

        this.consulServerSecurityGroup.connections.allowFrom(service.connections.securityGroups[0], Port.tcp(8301), 'allow consul server to accept traffic from consul client on TCP port 8301');
        this.consulServerSecurityGroup.connections.allowFrom(service.connections.securityGroups[0], Port.udp(8301), 'allow consul server to accept traffic from consul client on UDP port 8301');
        this.consulServerSecurityGroup.connections.allowFrom(service.connections.securityGroups[0], Port.tcp(8300), 'allow consul server to accept traffic from the service client on TCP port 8300');

        service.connections.securityGroups[0].addIngressRule(
            this.consulServerSecurityGroup.connections.securityGroups[0],
            Port.tcp(8301),
            'allow service to accept traffic from consul server on tcp port 8301'
        );

        service.connections.securityGroups[0].addIngressRule(
            this.consulServerSecurityGroup.connections.securityGroups[0],
            Port.udp(8301),
            'allow service to accept traffic from consul server on udp port 8301 '
        );

        const serviceSecurityGroupIds = service.connections.securityGroups.map(sg => sg.securityGroupId);

        serviceSecurityGroupIds.push(this.consulClientSecurityGroup.securityGroupId);

        if (serviceSecurityGroupIds.length > maxSecurityGroupLimit) {
            throw new Error('Cannot have more than 5 security groups associated with the service');
        }

        const cfnParentService = this.parentService.ecsService.node.findChild("Service") as ecs.CfnService;

        /**
         * Inject cfn override for multiple SGs. Override the 'SecurityGroups' property in the
         * Cloudformation resource of the parent service with the updated list of security groups.
         * This list will have the existing security groups of the parent service plus consulClientSecurityGroup
         */
        cfnParentService.addOverride("Properties.NetworkConfiguration.AwsvpcConfiguration.SecurityGroups",
            serviceSecurityGroupIds
        );
    }

    /**
     * This hook is responsible for connecting two services together, building a command for meshInit
     * container and also adding required environment variables to the app container.
     * 
     * @param otherService - The other service to connect to
     */
    public connectToService(otherService: Service, connectToProps: ConnectToProps = {}) {
        const otherConsulMesh = otherService.serviceDescription.get('consul') as ECSConsulMeshExtension;
        const serviceContainer = this.parentService.serviceDescription.get('service-container') as Container;

        if(serviceContainer == undefined){
            throw new Error(`Cannot find service-container`);
        }

        if (otherConsulMesh == undefined) {
            throw new Error(`Upstream service doesn't have consul mesh extension added to it`);
        }

        // Do a check to ensure that these services are in the same environment
        if (otherConsulMesh.parentService.environment.id !== this.parentService.environment.id) {
            throw new Error(`Unable to connect services from different environments`);
        }

        /**
         * Allow other service to accept traffic from parent service.
         * open port 20000 for proxy to route the traffic from parent service
         * to the other service
         */
        otherService.ecsService.connections.allowFrom(
            this.parentService.ecsService,
            Port.tcp(20000),
            `Accept inbound traffic from ${this.parentService.id}`,
        );

        const upstreamName = otherConsulMesh.serviceDiscoveryName;

        this.upstreamStringArray.push(upstreamName + ":" + (connectToProps.local_bind_port ?? this.upstreamPort));

        var cfnTaskDefinition = this.parentService?.ecsService?.taskDefinition?.node.defaultChild as ecs.CfnTaskDefinition;

        if (cfnTaskDefinition == undefined) {
            throw new Error(`The task definition is not defined`);
        }

        //Override command for consul-mesh-init-container here to have upstream details as we only use connectTo()
        //to add upstream details
        cfnTaskDefinition.addPropertyOverride('ContainerDefinitions.2.Command', ["mesh-init",
            "-envoy-bootstrap-dir=/consul/data",
            "-port=" + serviceContainer.trafficPort,
            "-upstreams=" + this.buildUpstreamString,
            "-service-name=" + this.serviceDiscoveryName]);


        if (this.parentServiceEnvironments.length == 0) { // add environment variables from app container only once
            for (const [key, val] of Object.entries(environment)) {
                this.parentServiceEnvironments.push({ Name: key, Value: val });
            }
        }

        this.parentServiceEnvironments.push({ Name: upstreamName.toUpperCase() + '_URL', Value: 'http://localhost:' + (connectToProps.local_bind_port ?? this.upstreamPort++)})

        //Also add required environment variables
        cfnTaskDefinition.addPropertyOverride('ContainerDefinitions.0.Environment', Array.from(this.parentServiceEnvironments.values()));
    }

    private get buildUpstreamString(): string {
        return this.upstreamStringArray.join(",")
    }
}


export class ConsulMeshsMutatingHook extends ContainerMutatingHook {
    public mutateContainerDefinition(props: ecs.ContainerDefinitionOptions): ecs.ContainerDefinitionOptions {
        environment = props.environment || {};

        return { ...props } as ecs.ContainerDefinitionOptions;
    }
}
