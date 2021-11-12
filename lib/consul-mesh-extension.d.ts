import * as cdk from '@aws-cdk/core';
import { ISecurityGroup } from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import { ServiceExtension, Service, ContainerMutatingHook } from '@aws-cdk-containers/ecs-service-extensions';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
/**
 *  The settings for the Consul Mesh extension
 */
export interface ConsulMeshProps {
    /**
     * The cloud auto-join arguemnt to pass to Consul for server discovery
     */
    readonly retryJoin: string;
    /**
     * The security group of the consul servers to which this extension
     * should be configured to connect
     */
    readonly consulServerSercurityGroup: ISecurityGroup;
    /**
     * Port that the application listens on
     *
     * @default 0
     */
    readonly port?: number;
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
    readonly consulClientSercurityGroup: ISecurityGroup;
    /**
     * Task definition family name
     */
    readonly family: string;
    /**
     * Consul CA certificate
     */
    readonly consulCACert?: secretsmanager.ISecret;
    /**
     * TLS encryption flag
     */
    readonly tls?: boolean;
    /**
    * Gossip encryption key
    */
    readonly gossipEncryptKey?: secretsmanager.ISecret;
}
/**
 * This extension adds a consul client, envoy proxy, and mesh-init sidecars
 * to the task definition and configures them to enable the task to
 * communicate via the service mesh
 */
export declare class ConsulMeshExtension extends ServiceExtension {
    private retryJoin;
    private consulServerSercurityGroup;
    private port;
    private consulClientImage;
    private envoyProxyImage;
    private consulEcsImage;
    private consulClientSercurityGroup;
    private meshInit;
    private family;
    private upstreamPort;
    private upstreamStringArray;
    /**
 * parentServiceEnvironments variable contains env variables from app container plus extension generated ones.
 * e.g. if app container has environment variable { region: "us-east-1" } then this will be added to the
 * extension generated env variables. Extension generates env variables like { GREETING_URL: "http://localhost:3000" }"
 */
    private parentServiceEnvironments;
    private consulCACert?;
    private tls?;
    private gossipEncryptKey?;
    constructor(props: ConsulMeshProps);
    /**
     * This hook is responsible for calling ConsulMeshMutatingHook and setting app container environment
     * variables to the glabal environment variable parameter.
     */
    addHooks(): void;
    /**
     * This hook defines the parent service and the scope of the extension
     * @param service The parent service which this extension has been added to
     * @param scope The scope that this extension should create resources in
     */
    prehook(service: Service, scope: cdk.Construct): void;
    /**
     * This hook assigns human entered family name to the task definition family parameter
     *
     * @param props The service properties to mutate.
     */
    modifyTaskDefinitionProps(props: ecs.TaskDefinitionProps): ecs.TaskDefinitionProps;
    /**
     * This hook is responsible for adding required side-cars
     * (i.e. consul-proxy, consul-client and consul-ecs-mesh-init)
     * to the application service. Also adding the required permissions to the
     * existing task role
     *
     * @param taskDefinition The created task definition to add containers to
     */
    useTaskDefinition(taskDefinition: ecs.TaskDefinition): void;
    private get buildConsulClientCommand();
    /**
     * This hook is responsible for adding required dependencies to the app container
     */
    resolveContainerDependencies(): void;
    /**
     * This hook is responsible for adding required ingress and egress rules to the security group
     * of the server as well as the service. It is also accountable for adding consulClientSecurityGroup
     * to the parent service to let clients in the mesh talk to each other.
     *
     * @param service The generated service.
     */
    useService(service: ecs.Ec2Service | ecs.FargateService): void;
    /**
     * This hook is responsible for connecting two services together, building a command for meshInit
     * container and also adding required environment variables to the app container.
     *
     * @param otherService - The other service to connect to
     */
    connectToService(otherService: Service): void;
    private get buildUpstreamString();
}
export declare class ConsulMeshsMutatingHook extends ContainerMutatingHook {
    mutateContainerDefinition(props: ecs.ContainerDefinitionOptions): ecs.ContainerDefinitionOptions;
}
