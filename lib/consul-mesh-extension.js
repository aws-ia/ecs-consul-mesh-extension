"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsulMeshsMutatingHook = exports.ConsulMeshExtension = void 0;
const cdk = require("@aws-cdk/core");
const aws_ec2_1 = require("@aws-cdk/aws-ec2");
const ecs = require("@aws-cdk/aws-ecs");
const aws_iam_1 = require("@aws-cdk/aws-iam");
const ecs_service_extensions_1 = require("@aws-cdk-containers/ecs-service-extensions");
/**
 * envoy, consul and consul-ecs container images
 */
const CONSUL_CONTAINER_IMAGE = 'hashicorp/consul:1.9.5';
const CONSUL_ECS_CONTAINER_IMAGE = 'hashicorp/consul-ecs:0.1.2';
const ENVOY_CONTAINER_IMAGE = 'envoyproxy/envoy-alpine:v1.16.2';
const maxSecurityGroupLimit = 5;
let environment = {};
/**
 * This extension adds a consul client, envoy proxy, and mesh-init sidecars
 * to the task definition and configures them to enable the task to
 * communicate via the service mesh
 */
class ConsulMeshExtension extends ecs_service_extensions_1.ServiceExtension {
    constructor(props) {
        super('consul');
        this.upstreamStringArray = []; //upstream string array is used to store the upstream records
        /**
     * parentServiceEnvironments variable contains env variables from app container plus extension generated ones.
     * e.g. if app container has environment variable { region: "us-east-1" } then this will be added to the
     * extension generated env variables. Extension generates env variables like { GREETING_URL: "http://localhost:3000" }"
     */
        this.parentServiceEnvironments = [];
        this.retryJoin = props.retryJoin;
        this.consulServerSercurityGroup = props.consulServerSercurityGroup;
        this.port = props.port || 0;
        this.consulClientImage = props.consulClientImage || CONSUL_CONTAINER_IMAGE;
        this.envoyProxyImage = props.envoyProxyImage || ENVOY_CONTAINER_IMAGE;
        this.consulEcsImage = props.consulEcsImage || CONSUL_ECS_CONTAINER_IMAGE;
        this.consulClientSercurityGroup = props.consulClientSercurityGroup;
        this.family = props.family;
        this.upstreamPort = 3001;
        this.tls = props.tls || false;
        this.consulCACert = props.consulCACert;
        this.gossipEncryptKey = props.gossipEncryptKey;
    }
    /**
     * This hook is responsible for calling ConsulMeshMutatingHook and setting app container environment
     * variables to the glabal environment variable parameter.
     */
    addHooks() {
        const container = this.parentService.serviceDescription.get('service-container');
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
    prehook(service, scope) {
        this.parentService = service;
        this.scope = scope;
    }
    /**
     * This hook assigns human entered family name to the task definition family parameter
     *
     * @param props The service properties to mutate.
     */
    modifyTaskDefinitionProps(props) {
        return {
            ...props,
            family: this.family
        };
    }
    /**
     * This hook is responsible for adding required side-cars
     * (i.e. consul-proxy, consul-client and consul-ecs-mesh-init)
     * to the application service. Also adding the required permissions to the
     * existing task role
     *
     * @param taskDefinition The created task definition to add containers to
     */
    useTaskDefinition(taskDefinition) {
        new aws_iam_1.Policy(this.scope, `task-role-${this.parentService.id}`, {
            roles: [taskDefinition.taskRole],
            statements: [
                new aws_iam_1.PolicyStatement({
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
        consulClient.addMountPoints({
            containerPath: "/consul/data",
            sourceVolume: "consul-data",
            readOnly: false
        }, {
            containerPath: "/consul/config",
            sourceVolume: "consul-config",
            readOnly: false
        });
        //Mesh init config starts here
        this.meshInit = taskDefinition.addContainer('consul-ecs-mesh-init', {
            image: ecs.ContainerImage.fromRegistry(this.consulEcsImage),
            memoryLimitMiB: 256,
            command: ["mesh-init",
                "-envoy-bootstrap-file=/consul/data/envoy-bootstrap.json",
                "-port=" + this.port,
                "-upstreams=" + this.buildUpstreamString],
            logging: new ecs.AwsLogDriver({ streamPrefix: 'consul-ecs-mesh-init' }),
            essential: false,
            user: "root" // TODO: check if this permission is required
        });
        this.meshInit.addMountPoints({
            containerPath: "/consul/data",
            sourceVolume: "consul-data",
            readOnly: false
        });
        //Proxy config starts here
        this.container = taskDefinition.addContainer('sidecar-proxy', {
            image: ecs.ContainerImage.fromRegistry(this.envoyProxyImage),
            memoryLimitMiB: 256,
            command: ["envoy --config-path /consul/data/envoy-bootstrap.json"],
            entryPoint: ["/bin/sh", "-c"],
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
        this.container.addContainerDependencies({
            container: this.meshInit,
            condition: ecs.ContainerDependencyCondition.SUCCESS
        });
        this.container.addMountPoints({
            containerPath: "/consul/data",
            sourceVolume: "consul-data",
            readOnly: false
        });
    }
    get buildConsulClientCommand() {
        var _a, _b;
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
            -encrypt "${(_a = this.gossipEncryptKey) === null || _a === void 0 ? void 0 : _a.secretValue}"`;
        }
        return [`ECS_IPV4=$(curl -s $ECS_CONTAINER_METADATA_URI | jq -r '.Networks[0].IPv4Addresses[0]') && if [ ${this.tls} == true ]; then \
                echo "${(_b = this.consulCACert) === null || _b === void 0 ? void 0 : _b.secretValue}" > /tmp/consul-agent-ca-cert.pem;
                fi &&
                  exec consul agent \
                  -advertise $ECS_IPV4 \
                  -data-dir /consul/data \
                  -client 0.0.0.0 \
                  -hcl 'addresses = { dns = "127.0.0.1" }' \
                  -hcl 'addresses = { grpc = "127.0.0.1" }' \
                  -hcl 'addresses = { http = "127.0.0.1" }' \
                  -retry-join "${this.retryJoin}" \
                  -hcl 'telemetry { disable_compat_1.9 = true }' \
                  -hcl 'leave_on_terminate = true' \
                  -hcl 'ports { grpc = 8502 }' \
                  -hcl 'advertise_reconnect_timeout = "15m"' \
                  -hcl 'enable_central_service_config = true'` + TLSCommand + gossipCommand];
    }
    /**
     * This hook is responsible for adding required dependencies to the app container
     */
    resolveContainerDependencies() {
        if (!this.container || !this.meshInit) {
            throw new Error('The container dependency hook was called before the container was created');
        }
        const serviceContainer = this.parentService.serviceDescription.get('service-container');
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
    useService(service) {
        this.consulServerSercurityGroup.connections.allowFrom(service.connections.securityGroups[0], aws_ec2_1.Port.tcp(8301), 'allow consul server to accept traffic from consul client on TCP port 8301');
        this.consulServerSercurityGroup.connections.allowFrom(service.connections.securityGroups[0], aws_ec2_1.Port.udp(8301), 'allow consul server to accept traffic from consul client on UDP port 8301');
        this.consulServerSercurityGroup.connections.allowFrom(service.connections.securityGroups[0], aws_ec2_1.Port.tcp(8300), 'allow consul server to accept traffic from the service client on TCP port 8300');
        service.connections.securityGroups[0].addIngressRule(this.consulServerSercurityGroup.connections.securityGroups[0], aws_ec2_1.Port.tcp(8301), 'allow service to accept traffic from consul server on tcp port 8301');
        service.connections.securityGroups[0].addIngressRule(this.consulServerSercurityGroup.connections.securityGroups[0], aws_ec2_1.Port.udp(8301), 'allow service to accept traffic from consul server on udp port 8301 ');
        const serviceSecurityGroupIds = service.connections.securityGroups.map(sg => sg.securityGroupId);
        serviceSecurityGroupIds.push(this.consulClientSercurityGroup.securityGroupId);
        if (serviceSecurityGroupIds.length > maxSecurityGroupLimit) {
            throw new Error('Cannot have more than 5 security groups associated with the service');
        }
        const cfnParentService = this.parentService.ecsService.node.findChild("Service");
        /**
         * Inject cfn override for multiple SGs. Override the 'SecurityGroups' property in the
         * Cloudformation resource of the parent service with the updated list of security groups.
         * This list will have the existing security groups of the parent service plus consulClientSecurityGroup
         */
        cfnParentService.addOverride("Properties.NetworkConfiguration.AwsvpcConfiguration.SecurityGroups", serviceSecurityGroupIds);
    }
    /**
     * This hook is responsible for connecting two services together, building a command for meshInit
     * container and also adding required environment variables to the app container.
     *
     * @param otherService - The other service to connect to
     */
    connectToService(otherService) {
        var _a, _b, _c;
        const otherConsulMesh = otherService.serviceDescription.get('consul');
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
        otherService.ecsService.connections.allowFrom(this.parentService.ecsService, aws_ec2_1.Port.tcp(20000), `Accept inbound traffic from ${this.parentService.id}`);
        this.upstreamStringArray.push(otherService.ecsService.taskDefinition.family + ":" + this.upstreamPort);
        var cfnTaskDefinition = (_c = (_b = (_a = this.parentService) === null || _a === void 0 ? void 0 : _a.ecsService) === null || _b === void 0 ? void 0 : _b.taskDefinition) === null || _c === void 0 ? void 0 : _c.node.defaultChild;
        if (cfnTaskDefinition == undefined) {
            throw new Error(`The task definition is not defined`);
        }
        //Override command for consul-mesh-init-container here to have upstream details as we only use connectTo()
        //to add upstream details
        cfnTaskDefinition.addPropertyOverride('ContainerDefinitions.2.Command', ["mesh-init",
            "-envoy-bootstrap-file=/consul/data/envoy-bootstrap.json",
            "-port=" + this.port,
            "-upstreams=" + this.buildUpstreamString]);
        if (this.parentServiceEnvironments.length == 0) { // add environment variables from app container only once
            for (const [key, val] of Object.entries(environment)) {
                this.parentServiceEnvironments.push({ Name: key, Value: val });
            }
        }
        this.parentServiceEnvironments.push({ Name: otherService.ecsService.taskDefinition.family.toUpperCase() + '_URL', Value: 'http://localhost:' + this.upstreamPort++ });
        //Also add required environment variables
        cfnTaskDefinition.addPropertyOverride('ContainerDefinitions.0.Environment', Array.from(this.parentServiceEnvironments.values()));
    }
    get buildUpstreamString() {
        return this.upstreamStringArray.join(",");
    }
}
exports.ConsulMeshExtension = ConsulMeshExtension;
class ConsulMeshsMutatingHook extends ecs_service_extensions_1.ContainerMutatingHook {
    mutateContainerDefinition(props) {
        environment = props.environment || {};
        return { ...props };
    }
}
exports.ConsulMeshsMutatingHook = ConsulMeshsMutatingHook;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uc3VsLW1lc2gtZXh0ZW5zaW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY29uc3VsLW1lc2gtZXh0ZW5zaW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLHFDQUFxQztBQUNyQyw4Q0FBd0Q7QUFDeEQsd0NBQXdDO0FBQ3hDLDhDQUEwRDtBQUMxRCx1RkFLb0Q7QUFHcEQ7O0dBRUc7QUFDSCxNQUFNLHNCQUFzQixHQUFHLHdCQUF3QixDQUFDO0FBQ3hELE1BQU0sMEJBQTBCLEdBQUcsNEJBQTRCLENBQUM7QUFDaEUsTUFBTSxxQkFBcUIsR0FBRyxpQ0FBaUMsQ0FBQztBQUNoRSxNQUFNLHFCQUFxQixHQUFHLENBQUMsQ0FBQztBQUNoQyxJQUFJLFdBQVcsR0FFWCxFQUFFLENBQUM7QUF5RVA7Ozs7R0FJRztBQUNILE1BQWEsbUJBQW9CLFNBQVEseUNBQWdCO0lBMEJyRCxZQUFZLEtBQXNCO1FBQzlCLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQztRQWZaLHdCQUFtQixHQUFhLEVBQUUsQ0FBQyxDQUFFLDZEQUE2RDtRQUMxRzs7OztPQUlEO1FBQ1MsOEJBQXlCLEdBRzNCLEVBQUUsQ0FBQztRQU9MLElBQUksQ0FBQyxTQUFTLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQztRQUNqQyxJQUFJLENBQUMsMEJBQTBCLEdBQUcsS0FBSyxDQUFDLDBCQUEwQixDQUFDO1FBQ25FLElBQUksQ0FBQyxJQUFJLEdBQUcsS0FBSyxDQUFDLElBQUksSUFBSSxDQUFDLENBQUM7UUFDNUIsSUFBSSxDQUFDLGlCQUFpQixHQUFHLEtBQUssQ0FBQyxpQkFBaUIsSUFBSSxzQkFBc0IsQ0FBQztRQUMzRSxJQUFJLENBQUMsZUFBZSxHQUFHLEtBQUssQ0FBQyxlQUFlLElBQUkscUJBQXFCLENBQUM7UUFDdEUsSUFBSSxDQUFDLGNBQWMsR0FBRyxLQUFLLENBQUMsY0FBYyxJQUFJLDBCQUEwQixDQUFDO1FBQ3pFLElBQUksQ0FBQywwQkFBMEIsR0FB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QUMsQ0FBQyxDQUFDO0lBQ3JJLENBQUM7SUFFRCxJQUFZLG1CQUFtQjtRQUMzQixPQUFPLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUE7SUFDN0MsQ0FBQztDQUNKO0FBN1dELGtEQTZXQztBQUdELE1BQWEsdUJBQXdCLFNBQVEsOENBQXFCO0lBQ3ZELHlCQUF5QixDQUFDLEtBQXFDO1FBQ2xFLFdBQVcsR0FBRyxLQUFLLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQztRQUV0QyxPQUFPLEVBQUUsR0FBRyxLQUFLLEVBQW9DLENBQUM7SUFDMUQsQ0FBQztDQUNKO0FBTkQsMERBTUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnQGF3cy1jZGsvY29yZSc7XG5pbXBvcnQgeyBJU2VjdXJpdHlHcm91cCwgUG9ydCB9IGZyb20gJ0Bhd3MtY2RrL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgZWNzIGZyb20gJ0Bhd3MtY2RrL2F3cy1lY3MnO1xuaW1wb3J0IHsgUG9saWN5LCBQb2xpY3lTdGF0ZW1lbnQgfSBmcm9tICdAYXdzLWNkay9hd3MtaWFtJ1xuaW1wb3J0IHtcbiAgICBTZXJ2aWNlRXh0ZW5zaW9uLFxuICAgIFNlcnZpY2UsXG4gICAgQ29udGFpbmVyLFxuICAgIENvbnRhaW5lck11dGF0aW5nSG9va1xufSBmcm9tICdAYXdzLWNkay1jb250YWluZXJzL2Vjcy1zZXJ2aWNlLWV4dGVuc2lvbnMnO1xuaW1wb3J0ICogYXMgc2VjcmV0c21hbmFnZXIgZnJvbSAnQGF3cy1jZGsvYXdzLXNlY3JldHNtYW5hZ2VyJ1xuXG4vKipcbiAqIGVudm95LCBjb25zdWwgYW5kIGNvbnN1bC1lY3MgY29udGFpbmVyIGltYWdlc1xuICovXG5jb25zdCBDT05TVUxfQ09OVEFJTkVSX0lNQUdFID0gJ2hhc2hpY29ycC9jb25zdWw6MS45LjUnO1xuY29uc3QgQ09OU1VMX0VDU19DT05UQUlORVJfSU1BR0UgPSAnaGFzaGljb3JwL2NvbnN1bC1lY3M6MC4xLjInO1xuY29uc3QgRU5WT1lfQ09OVEFJTkVSX0lNQUdFID0gJ2Vudm95cHJveHkvZW52b3ktYWxwaW5lOnYxLjE2LjInO1xuY29uc3QgbWF4U2VjdXJpdHlHcm91cExpbWl0ID0gNTtcbmxldCBlbnZpcm9ubWVudDogeyAgLy9lbnZpcm9ubWVudCB2YXJpYWJsZSBpcyB1c2VkIHRvIGhvbGQgdGhlIGVudmlyb25tZW50IGRldGFpbHMgZnJvbSBhcHAgY29udGFpbmVyXG4gICAgW2tleTogc3RyaW5nXTogc3RyaW5nO1xufSA9IHt9O1xuXG4vKipcbiAqICBUaGUgc2V0dGluZ3MgZm9yIHRoZSBDb25zdWwgTWVzaCBleHRlbnNpb25cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb25zdWxNZXNoUHJvcHMge1xuXG4gICAgLyoqXG4gICAgICogVGhlIGNsb3VkIGF1dG8tam9pbiBhcmd1ZW1udCB0byBwYXNzIHRvIENvbnN1bCBmb3Igc2VydmVyIGRpc2NvdmVyeVxuICAgICAqL1xuICAgIHJlYWRvbmx5IHJldHJ5Sm9pbjogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogVGhlIHNlY3VyaXR5IGdyb3VwIG9mIHRoZSBjb25zdWwgc2VydmVycyB0byB3aGljaCB0aGlzIGV4dGVuc2lvbiBcbiAgICAgKiBzaG91bGQgYmUgY29uZmlndXJlZCB0byBjb25uZWN0XG4gICAgICovXG4gICAgcmVhZG9ubHkgY29uc3VsU2VydmVyU2VyY3VyaXR5R3JvdXA6IElTZWN1cml0eUdyb3VwO1xuXG4gICAgLyoqXG4gICAgICogUG9ydCB0aGF0IHRoZSBhcHBsaWNhdGlvbiBsaXN0ZW5zIG9uXG4gICAgICogXG4gICAgICogQGRlZmF1bHQgMFxuICAgICAqL1xuICAgIHJlYWRvbmx5IHBvcnQ/OiBudW1iZXI7XG5cbiAgICAvKipcbiAgICAgKiBDb25zdWwgY29udGFpbmVyIGltYWdlLlxuICAgICAqIFxuICAgICAqIEBkZWZhdWx0IGhhc2hpY29ycC9jb25zdWw6MS45LjVcbiAgICAgKi9cbiAgICByZWFkb25seSBjb25zdWxDbGllbnRJbWFnZT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIEVudm95IGNvbnRhaW5lciBpbWFnZS5cbiAgICAgKiBcbiAgICAgKiBAZGVmYXVsdCBlbnZveXByb3h5L2Vudm95LWFscGluZTp2MS4xNi4yXG4gICAgICovXG4gICAgcmVhZG9ubHkgZW52b3lQcm94eUltYWdlPzogc3RyaW5nO1xuXG4gICAgLyoqXG4gICAgICogY29uc3VsLWVjcyBjb250YWluZXIgaW1hZ2UuXG4gICAgICogXG4gICAgICogQGRlZmF1bHQgaGFzaGljb3JwL2NvbnN1bC1lY3M6MC4xLjJcbiAgICAgKi9cbiAgICByZWFkb25seSBjb25zdWxFY3NJbWFnZT86IHN0cmluZztcblxuICAgIC8qKlxuICAgICAqIFRoZSBzZWN1cml0eSBncm91cCB0byBhbGxvdyBtZXNoLXRhc2sgY29udGFpbmVycyB0byB0YWxrIHRvIGVhY2ggb3RoZXIuXG4gICAgICogVHlwaWNhbGx5LCB0aGlzIGlzIGEgc2VjdXJpdHkgdGhhdCBhbGxvdyBpbmdyZXNzIGZyb20gcG9ydHMgXCI4MzAxL3RjcFwiIGFuZCBcIjgzMDEvdWRwXCIuXG4gICAgICovXG4gICAgcmVhZG9ubHkgY29uc3VsQ2xpZW50U2VyY3VyaXR5R3JvdXA6IElTZWN1cml0eUdyb3VwO1xuXG4gICAgLyoqXG4gICAgICogVGFzayBkZWZpbml0aW9uIGZhbWlseSBuYW1lXG4gICAgICovXG4gICAgcmVhZG9ubHkgZmFtaWx5OiBzdHJpbmdcblxuICAgIC8qKlxuICAgICAqIENvbnN1bCBDQSBjZXJ0aWZpY2F0ZSBcbiAgICAgKi9cbiAgICAgcmVhZG9ubHkgY29uc3VsQ0FDZXJ0Pzogc2VjcmV0c21hbmFnZXIuSVNlY3JldFxuXG4gICAgIC8qKlxuICAgICAgKiBUTFMgZW5jcnlwdGlvbiBmbGFnXG4gICAgICAqL1xuICAgICByZWFkb25seSB0bHM/OiBib29sZWFuXG5cbiAgICAgLyoqXG4gICAgICogR29zc2lwIGVuY3J5cHRpb24ga2V5XG4gICAgICovXG4gICAgcmVhZG9ubHkgZ29zc2lwRW5jcnlwdEtleT86IHNlY3JldHNtYW5hZ2VyLklTZWNyZXQ7XG59XG5cbi8qKlxuICogVGhpcyBleHRlbnNpb24gYWRkcyBhIGNvbnN1bCBjbGllbnQsIGVudm95IHByb3h5LCBhbmQgbWVzaC1pbml0IHNpZGVjYXJzXG4gKiB0byB0aGUgdGFzayBkZWZpbml0aW9uIGFuZCBjb25maWd1cmVzIHRoZW0gdG8gZW5hYmxlIHRoZSB0YXNrIHRvIFxuICogY29tbXVuaWNhdGUgdmlhIHRoZSBzZXJ2aWNlIG1lc2hcbiAqL1xuZXhwb3J0IGNsYXNzIENvbnN1bE1lc2hFeHRlbnNpb24gZXh0ZW5kcyBTZXJ2aWNlRXh0ZW5zaW9uIHtcblxuICAgIHByaXZhdGUgcmV0cnlKb2luOiBzdHJpbmc7XG4gICAgcHJpdmF0ZSBjb25zdWxTZXJ2ZXJTZXJjdXJpdHlHcm91cDogSVNlY3VyaXR5R3JvdXA7XG4gICAgcHJpdmF0ZSBwb3J0OiBudW1iZXI7XG4gICAgcHJpdmF0ZSBjb25zdWxDbGllbnRJbWFnZTogc3RyaW5nO1xuICAgIHByaXZhdGUgZW52b3lQcm94eUltYWdlOiBzdHJpbmc7XG4gICAgcHJpdmF0ZSBjb25zdWxFY3NJbWFnZTogc3RyaW5nO1xuICAgIHByaXZhdGUgY29uc3VsQ2xpZW50U2VyY3VyaXR5R3JvdXA6IElTZWN1cml0eUdyb3VwO1xuICAgIHByaXZhdGUgbWVzaEluaXQ6IGVjcy5Db250YWluZXJEZWZpbml0aW9uO1xuICAgIHByaXZhdGUgZmFtaWx5OiBzdHJpbmc7XG4gICAgcHJpdmF0ZSB1cHN0cmVhbVBvcnQ6IG51bWJlcjtcbiAgICBwcml2YXRlIHVwc3RyZWFtU3RyaW5nQXJyYXk6IHN0cmluZ1tdID0gW107ICAvL3Vwc3RyZWFtIHN0cmluZyBhcnJheSBpcyB1c2VkIHRvIHN0b3JlIHRoZSB1cHN0cmVhbSByZWNvcmRzXG4gICAgLyoqXG4gKiBwYXJlbnRTZXJ2aWNlRW52aXJvbm1lbnRzIHZhcmlhYmxlIGNvbnRhaW5zIGVudiB2YXJpYWJsZXMgZnJvbSBhcHAgY29udGFpbmVyIHBsdXMgZXh0ZW5zaW9uIGdlbmVyYXRlZCBvbmVzLlxuICogZS5nLiBpZiBhcHAgY29udGFpbmVyIGhhcyBlbnZpcm9ubWVudCB2YXJpYWJsZSB7IHJlZ2lvbjogXCJ1cy1lYXN0LTFcIiB9IHRoZW4gdGhpcyB3aWxsIGJlIGFkZGVkIHRvIHRoZVxuICogZXh0ZW5zaW9uIGdlbmVyYXRlZCBlbnYgdmFyaWFibGVzLiBFeHRlbnNpb24gZ2VuZXJhdGVzIGVudiB2YXJpYWJsZXMgbGlrZSB7IEdSRUVUSU5HX1VSTDogXCJodHRwOi8vbG9jYWxob3N0OjMwMDBcIiB9XCJcbiAqL1xuICAgIHByaXZhdGUgcGFyZW50U2VydmljZUVudmlyb25tZW50czoge1xuICAgICAgICBOYW1lOiBzdHJpbmcsXG4gICAgICAgIFZhbHVlOiBzdHJpbmdcbiAgICB9W10gPSBbXTtcbiAgICBwcml2YXRlIGNvbnN1bENBQ2VydD86IHNlY3JldHNtYW5hZ2VyLklTZWNyZXQ7XG4gICAgcHJpdmF0ZSB0bHM/OiBib29sZWFuO1xuICAgIHByaXZhdGUgZ29zc2lwRW5jcnlwdEtleT86IHNlY3JldHNtYW5hZ2VyLklTZWNyZXQ7XG5cbiAgICBjb25zdHJ1Y3Rvcihwcm9wczogQ29uc3VsTWVzaFByb3BzKSB7XG4gICAgICAgIHN1cGVyKCdjb25zdWwnKTtcbiAgICAgICAgdGhpcy5yZXRyeUpvaW4gPSBwcm9wcy5yZXRyeUpvaW47XG4gICAgICAgIHRoaXMuY29uc3VsU2VydmVyU2VyY3VyaXR5R3JvdXAgPSBwcm9wcy5jb25zdWxTZXJ2ZXJTZXJjdXJpdHlHcm91cDtcbiAgICAgICAgdGhpcy5wb3J0ID0gcHJvcHMucG9ydCB8fCAwO1xuICAgICAgICB0aGlzLmNvbnN1bENsaWVudEltYWdlID0gcHJvcHMuY29uc3VsQ2xpZW50SW1hZ2UgfHwgQ09OU1VMX0NPTlRBSU5FUl9JTUFHRTtcbiAgICAgICAgdGhpcy5lbnZveVByb3h5SW1hZ2UgPSBwcm9wcy5lbnZveVByb3h5SW1hZ2UgfHwgRU5WT1lfQ09OVEFJTkVSX0lNQUdFO1xuICAgICAgICB0aGlzLmNvbnN1bEVjc0ltYWdlID0gcHJvcHMuY29uc3VsRWNzSW1hZ2UgfHwgQ09OU1VMX0VDU19DT05UQUlORVJfSU1BR0U7XG4gICAgICAgIHRoaXMuY29uc3VsQ2xpZW50U2VyY3VyaXR5R3JvdXAgPSBwcm9wcy5jb25zdWxDbGllbnRTZXJjdXJpdHlHcm91cDtcbiAgICAgICAgdGhpcy5mYW1pbHkgPSBwcm9wcy5mYW1pbHk7XG4gICAgICAgIHRoaXMudXBzdHJlYW1Qb3J0ID0gMzAwMTtcbiAgICAgICAgdGhpcy50bHMgPSBwcm9wcy50bHMgfHwgZmFsc2U7XG4gICAgICAgIHRoaXMuY29uc3VsQ0FDZXJ0ID0gcHJvcHMuY29uc3VsQ0FDZXJ0O1xuICAgICAgICB0aGlzLmdvc3NpcEVuY3J5cHRLZXkgPSBwcm9wcy5nb3NzaXBFbmNyeXB0S2V5O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRoaXMgaG9vayBpcyByZXNwb25zaWJsZSBmb3IgY2FsbGluZyBDb25zdWxNZXNoTXV0YXRpbmdIb29rIGFuZCBzZXR0aW5nIGFwcCBjb250YWluZXIgZW52aXJvbm1lbnQgXG4gICAgICogdmFyaWFibGVzIHRvIHRoZSBnbGFiYWwgZW52aXJvbm1lbnQgdmFyaWFibGUgcGFyYW1ldGVyLlxuICAgICAqL1xuICAgIHB1YmxpYyBhZGRIb29rcygpIHtcbiAgICAgICAgY29uc3QgY29udGFpbmVyID0gdGhpcy5wYXJlbnRTZXJ2aWNlLnNlcnZpY2VEZXNjcmlwdGlvbi5nZXQoJ3NlcnZpY2UtY29udGFpbmVyJykgYXMgQ29udGFpbmVyO1xuICAgICAgICBpZiAoIWNvbnRhaW5lcikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb25zdWwgTWVzaCBleHRlbnNpb24gcmVxdWlyZXMgYW4gYXBwbGljYXRpb24gZXh0ZW5zaW9uJyk7XG4gICAgICAgIH1cbiAgICAgICAgY29udGFpbmVyLmFkZENvbnRhaW5lck11dGF0aW5nSG9vayhuZXcgQ29uc3VsTWVzaHNNdXRhdGluZ0hvb2soKSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVGhpcyBob29rIGRlZmluZXMgdGhlIHBhcmVudCBzZXJ2aWNlIGFuZCB0aGUgc2NvcGUgb2YgdGhlIGV4dGVuc2lvblxuICAgICAqIEBwYXJhbSBzZXJ2aWNlIFRoZSBwYXJlbnQgc2VydmljZSB3aGljaCB0aGlzIGV4dGVuc2lvbiBoYXMgYmVlbiBhZGRlZCB0b1xuICAgICAqIEBwYXJhbSBzY29wZSBUaGUgc2NvcGUgdGhhdCB0aGlzIGV4dGVuc2lvbiBzaG91bGQgY3JlYXRlIHJlc291cmNlcyBpblxuICAgICAqL1xuICAgIHB1YmxpYyBwcmVob29rKHNlcnZpY2U6IFNlcnZpY2UsIHNjb3BlOiBjZGsuQ29uc3RydWN0KSB7XG4gICAgICAgIHRoaXMucGFyZW50U2VydmljZSA9IHNlcnZpY2U7XG4gICAgICAgIHRoaXMuc2NvcGUgPSBzY29wZTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUaGlzIGhvb2sgYXNzaWducyBodW1hbiBlbnRlcmVkIGZhbWlseSBuYW1lIHRvIHRoZSB0YXNrIGRlZmluaXRpb24gZmFtaWx5IHBhcmFtZXRlclxuICAgICAqIFxuICAgICAqIEBwYXJhbSBwcm9wcyBUaGUgc2VydmljZSBwcm9wZXJ0aWVzIHRvIG11dGF0ZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgbW9kaWZ5VGFza0RlZmluaXRpb25Qcm9wcyhwcm9wczogZWNzLlRhc2tEZWZpbml0aW9uUHJvcHMpOiBlY3MuVGFza0RlZmluaXRpb25Qcm9wcyB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAuLi5wcm9wcyxcblxuICAgICAgICAgICAgZmFtaWx5OiB0aGlzLmZhbWlseVxuICAgICAgICB9IGFzIGVjcy5UYXNrRGVmaW5pdGlvblByb3BzO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRoaXMgaG9vayBpcyByZXNwb25zaWJsZSBmb3IgYWRkaW5nIHJlcXVpcmVkIHNpZGUtY2FycyBcbiAgICAgKiAoaS5lLiBjb25zdWwtcHJveHksIGNvbnN1bC1jbGllbnQgYW5kIGNvbnN1bC1lY3MtbWVzaC1pbml0KVxuICAgICAqIHRvIHRoZSBhcHBsaWNhdGlvbiBzZXJ2aWNlLiBBbHNvIGFkZGluZyB0aGUgcmVxdWlyZWQgcGVybWlzc2lvbnMgdG8gdGhlIFxuICAgICAqIGV4aXN0aW5nIHRhc2sgcm9sZVxuICAgICAqIFxuICAgICAqIEBwYXJhbSB0YXNrRGVmaW5pdGlvbiBUaGUgY3JlYXRlZCB0YXNrIGRlZmluaXRpb24gdG8gYWRkIGNvbnRhaW5lcnMgdG9cbiAgICAgKi9cbiAgICBwdWJsaWMgdXNlVGFza0RlZmluaXRpb24odGFza0RlZmluaXRpb246IGVjcy5UYXNrRGVmaW5pdGlvbikge1xuXG4gICAgICAgIG5ldyBQb2xpY3kodGhpcy5zY29wZSwgYHRhc2stcm9sZS0ke3RoaXMucGFyZW50U2VydmljZS5pZH1gLCB7XG4gICAgICAgICAgICByb2xlczogW3Rhc2tEZWZpbml0aW9uLnRhc2tSb2xlXSxcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgICBuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uczogWydlYzI6RGVzY3JpYmVJbnN0YW5jZXMnXSxcbiAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgICAgICAgICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICAgICAgICAgICAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJhd3M6UmVxdWVzdGVkUmVnaW9uXCI6IGNkay5TdGFjay5vZih0aGlzLnBhcmVudFNlcnZpY2UpLnJlZ2lvblxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICB9KTtcblxuICAgICAgICAvL0FkZCB2b2x1bWVzIHRvIHRoZSB0YXNrIGRlZmluaXRpb25cbiAgICAgICAgdGFza0RlZmluaXRpb24uYWRkVm9sdW1lKHtcbiAgICAgICAgICAgIG5hbWU6IFwiY29uc3VsLWRhdGFcIlxuICAgICAgICB9KTtcbiAgICAgICAgdGFza0RlZmluaXRpb24uYWRkVm9sdW1lKHtcbiAgICAgICAgICAgIG5hbWU6IFwiY29uc3VsLWNvbmZpZ1wiXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vQ29uc3VsIGFnZW50IGNvbmZpZyBzdGFydHMgaGVyZVxuICAgICAgICBjb25zdCBjb25zdWxDbGllbnQgPSB0YXNrRGVmaW5pdGlvbi5hZGRDb250YWluZXIoJ2NvbnN1bC1jbGllbnQnLCB7XG4gICAgICAgICAgICBpbWFnZTogZWNzLkNvbnRhaW5lckltYWdlLmZyb21SZWdpc3RyeSh0aGlzLmNvbnN1bENsaWVudEltYWdlKSxcbiAgICAgICAgICAgIGVzc2VudGlhbDogZmFsc2UsXG4gICAgICAgICAgICBtZW1vcnlMaW1pdE1pQjogMjU2LFxuICAgICAgICAgICAgcG9ydE1hcHBpbmdzOiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBjb250YWluZXJQb3J0OiA4MzAxLFxuICAgICAgICAgICAgICAgICAgICBwcm90b2NvbDogZWNzLlByb3RvY29sLlRDUFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBjb250YWluZXJQb3J0OiA4MzAxLFxuICAgICAgICAgICAgICAgICAgICBwcm90b2NvbDogZWNzLlByb3RvY29sLlVEUFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBjb250YWluZXJQb3J0OiA4NTAwLFxuICAgICAgICAgICAgICAgICAgICBwcm90b2NvbDogZWNzLlByb3RvY29sLlRDUFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBsb2dnaW5nOiBuZXcgZWNzLkF3c0xvZ0RyaXZlcih7IHN0cmVhbVByZWZpeDogJ2NvbnN1bC1jbGllbnQnIH0pLFxuICAgICAgICAgICAgZW50cnlQb2ludDogW1wiL2Jpbi9zaFwiLCBcIi1lY1wiXSxcbiAgICAgICAgICAgIGNvbW1hbmQ6IHRoaXMuYnVpbGRDb25zdWxDbGllbnRDb21tYW5kXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN1bENsaWVudC5hZGRNb3VudFBvaW50cyhcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBjb250YWluZXJQYXRoOiBcIi9jb25zdWwvZGF0YVwiLFxuICAgICAgICAgICAgICAgIHNvdXJjZVZvbHVtZTogXCJjb25zdWwtZGF0YVwiLFxuICAgICAgICAgICAgICAgIHJlYWRPbmx5OiBmYWxzZVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBjb250YWluZXJQYXRoOiBcIi9jb25zdWwvY29uZmlnXCIsXG4gICAgICAgICAgICAgICAgc291cmNlVm9sdW1lOiBcImNvbnN1bC1jb25maWdcIixcbiAgICAgICAgICAgICAgICByZWFkT25seTogZmFsc2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgKTtcblxuICAgICAgICAvL01lc2ggaW5pdCBjb25maWcgc3RhcnRzIGhlcmVcbiAgICAgICAgdGhpcy5tZXNoSW5pdCA9IHRhc2tEZWZpbml0aW9uLmFkZENvbnRhaW5lcignY29uc3VsLWVjcy1tZXNoLWluaXQnLCB7XG4gICAgICAgICAgICBpbWFnZTogZWNzLkNvbnRhaW5lckltYWdlLmZyb21SZWdpc3RyeSh0aGlzLmNvbnN1bEVjc0ltYWdlKSxcbiAgICAgICAgICAgIG1lbW9yeUxpbWl0TWlCOiAyNTYsXG4gICAgICAgICAgICBjb21tYW5kOiBbXCJtZXNoLWluaXRcIixcbiAgICAgICAgICAgICAgICBcIi1lbnZveS1ib290c3RyYXAtZmlsZT0vY29uc3VsL2RhdGEvZW52b3ktYm9vdHN0cmFwLmpzb25cIixcbiAgICAgICAgICAgICAgICBcIi1wb3J0PVwiICsgdGhpcy5wb3J0LFxuICAgICAgICAgICAgICAgIFwiLXVwc3RyZWFtcz1cIiArIHRoaXMuYnVpbGRVcHN0cmVhbVN0cmluZ10sXG4gICAgICAgICAgICBsb2dnaW5nOiBuZXcgZWNzLkF3c0xvZ0RyaXZlcih7IHN0cmVhbVByZWZpeDogJ2NvbnN1bC1lY3MtbWVzaC1pbml0JyB9KSxcbiAgICAgICAgICAgIGVzc2VudGlhbDogZmFsc2UsXG4gICAgICAgICAgICB1c2VyOiBcInJvb3RcIiAvLyBUT0RPOiBjaGVjayBpZiB0aGlzIHBlcm1pc3Npb24gaXMgcmVxdWlyZWRcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5tZXNoSW5pdC5hZGRNb3VudFBvaW50cyh7XG4gICAgICAgICAgICBjb250YWluZXJQYXRoOiBcIi9jb25zdWwvZGF0YVwiLFxuICAgICAgICAgICAgc291cmNlVm9sdW1lOiBcImNvbnN1bC1kYXRhXCIsXG4gICAgICAgICAgICByZWFkT25seTogZmFsc2VcbiAgICAgICAgfSk7XG5cblxuICAgICAgICAvL1Byb3h5IGNvbmZpZyBzdGFydHMgaGVyZVxuICAgICAgICB0aGlzLmNvbnRhaW5lciA9IHRhc2tEZWZpbml0aW9uLmFkZENvbnRhaW5lcignc2lkZWNhci1wcm94eScsIHtcbiAgICAgICAgICAgIGltYWdlOiBlY3MuQ29udGFpbmVySW1hZ2UuZnJvbVJlZ2lzdHJ5KHRoaXMuZW52b3lQcm94eUltYWdlKSxcbiAgICAgICAgICAgIG1lbW9yeUxpbWl0TWlCOiAyNTYsXG4gICAgICAgICAgICBjb21tYW5kOiBbXCJlbnZveSAtLWNvbmZpZy1wYXRoIC9jb25zdWwvZGF0YS9lbnZveS1ib290c3RyYXAuanNvblwiXSxcbiAgICAgICAgICAgIGVudHJ5UG9pbnQ6IFtcIi9iaW4vc2hcIiwgXCItY1wiXSxcbiAgICAgICAgICAgIGxvZ2dpbmc6IG5ldyBlY3MuQXdzTG9nRHJpdmVyKHsgc3RyZWFtUHJlZml4OiAnZW52b3knIH0pLFxuICAgICAgICAgICAgcG9ydE1hcHBpbmdzOiBbe1xuICAgICAgICAgICAgICAgIGNvbnRhaW5lclBvcnQ6IDIwMDAwLFxuICAgICAgICAgICAgICAgIHByb3RvY29sOiBlY3MuUHJvdG9jb2wuVENQXG4gICAgICAgICAgICB9XSxcbiAgICAgICAgICAgIGhlYWx0aENoZWNrOiB7XG4gICAgICAgICAgICAgICAgY29tbWFuZDogW1wibmNcIiwgXCItelwiLCBcIjEyNy4wLjAuMVwiLCBcIjIwMDAwXCJdLFxuICAgICAgICAgICAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICAgICAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICAgICAgICAgICAgcmV0cmllczogMyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBlc3NlbnRpYWw6IGZhbHNlXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHRoaXMuY29udGFpbmVyLmFkZENvbnRhaW5lckRlcGVuZGVuY2llcyhcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBjb250YWluZXI6IHRoaXMubWVzaEluaXQsXG4gICAgICAgICAgICAgICAgY29uZGl0aW9uOiBlY3MuQ29udGFpbmVyRGVwZW5kZW5jeUNvbmRpdGlvbi5TVUNDRVNTXG4gICAgICAgICAgICB9XG4gICAgICAgICk7XG5cbiAgICAgICAgdGhpcy5jb250YWluZXIuYWRkTW91bnRQb2ludHMoXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgY29udGFpbmVyUGF0aDogXCIvY29uc3VsL2RhdGFcIixcbiAgICAgICAgICAgICAgICBzb3VyY2VWb2x1bWU6IFwiY29uc3VsLWRhdGFcIixcbiAgICAgICAgICAgICAgICByZWFkT25seTogZmFsc2VcbiAgICAgICAgICAgIH1cbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGdldCBidWlsZENvbnN1bENsaWVudENvbW1hbmQoKTogc3RyaW5nW10ge1xuICAgICAgICBsZXQgVExTQ29tbWFuZCA9IFwiXCI7XG4gICAgICAgIGxldCBnb3NzaXBDb21tYW5kID0gXCJcIjtcbiAgICAgICAgaWYodGhpcy50bHMpe1xuICAgICAgICAgICAgVExTQ29tbWFuZCA9ICBgIFxcXG4gICAgICAgICAgICAgICAtaGNsICdjYV9maWxlID0gXCIvdG1wL2NvbnN1bC1hZ2VudC1jYS1jZXJ0LnBlbVwiJyBcXFxuICAgICAgICAgICAgICAgLWhjbCAnYXV0b19lbmNyeXB0ID0ge3RscyA9IHRydWV9JyBcXFxuICAgICAgICAgICAgICAgLWhjbCBcImF1dG9fZW5jcnlwdCA9IHtpcF9zYW4gPSBbIFxcXFxcIiRFQ1NfSVBWNFxcXFxcIiBdfVwiIFxcXG4gICAgICAgICAgICAgICAtaGNsICd2ZXJpZnlfb3V0Z29pbmcgPSB0cnVlJ2A7XG4gICAgICAgIH1cblxuICAgICAgICBpZih0aGlzLmdvc3NpcEVuY3J5cHRLZXkpe1xuICAgICAgICAgICAgZ29zc2lwQ29tbWFuZCA9IGAgXFxcbiAgICAgICAgICAgIC1lbmNyeXB0IFwiJHt0aGlzLmdvc3NpcEVuY3J5cHRLZXk/LnNlY3JldFZhbHVlfVwiYDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBbYEVDU19JUFY0PSQoY3VybCAtcyAkRUNTX0NPTlRBSU5FUl9NRVRBREFUQV9VUkkgfCBqcSAtciAnLk5ldHdvcmtzWzBdLklQdjRBZGRyZXNzZXNbMF0nKSAmJiBpZiBbICR7dGhpcy50bHN9ID09IHRydWUgXTsgdGhlbiBcXFxuICAgICAgICAgICAgICAgIGVjaG8gXCIke3RoaXMuY29uc3VsQ0FDZXJ0Py5zZWNyZXRWYWx1ZX1cIiA+IC90bXAvY29uc3VsLWFnZW50LWNhLWNlcnQucGVtO1xuICAgICAgICAgICAgICAgIGZpICYmXG4gICAgICAgICAgICAgICAgICBleGVjIGNvbnN1bCBhZ2VudCBcXFxuICAgICAgICAgICAgICAgICAgLWFkdmVydGlzZSAkRUNTX0lQVjQgXFxcbiAgICAgICAgICAgICAgICAgIC1kYXRhLWRpciAvY29uc3VsL2RhdGEgXFxcbiAgICAgICAgICAgICAgICAgIC1jbGllbnQgMC4wLjAuMCBcXFxuICAgICAgICAgICAgICAgICAgLWhjbCAnYWRkcmVzc2VzID0geyBkbnMgPSBcIjEyNy4wLjAuMVwiIH0nIFxcXG4gICAgICAgICAgICAgICAgICAtaGNsICdhZGRyZXNzZXMgPSB7IGdycGMgPSBcIjEyNy4wLjAuMVwiIH0nIFxcXG4gICAgICAgICAgICAgICAgICAtaGNsICdhZGRyZXNzZXMgPSB7IGh0dHAgPSBcIjEyNy4wLjAuMVwiIH0nIFxcXG4gICAgICAgICAgICAgICAgICAtcmV0cnktam9pbiBcIiR7dGhpcy5yZXRyeUpvaW59XCIgXFxcbiAgICAgICAgICAgICAgICAgIC1oY2wgJ3RlbGVtZXRyeSB7IGRpc2FibGVfY29tcGF0XzEuOSA9IHRydWUgfScgXFxcbiAgICAgICAgICAgICAgICAgIC1oY2wgJ2xlYXZlX29uX3Rlcm1pbmF0ZSA9IHRydWUnIFxcXG4gICAgICAgICAgICAgICAgICAtaGNsICdwb3J0cyB7IGdycGMgPSA4NTAyIH0nIFxcXG4gICAgICAgICAgICAgICAgICAtaGNsICdhZHZlcnRpc2VfcmVjb25uZWN0X3RpbWVvdXQgPSBcIjE1bVwiJyBcXFxuICAgICAgICAgICAgICAgICAgLWhjbCAnZW5hYmxlX2NlbnRyYWxfc2VydmljZV9jb25maWcgPSB0cnVlJ2AgKyBUTFNDb21tYW5kICsgZ29zc2lwQ29tbWFuZF1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUaGlzIGhvb2sgaXMgcmVzcG9uc2libGUgZm9yIGFkZGluZyByZXF1aXJlZCBkZXBlbmRlbmNpZXMgdG8gdGhlIGFwcCBjb250YWluZXJcbiAgICAgKi9cbiAgICBwdWJsaWMgcmVzb2x2ZUNvbnRhaW5lckRlcGVuZGVuY2llcygpIHtcbiAgICAgICAgaWYgKCF0aGlzLmNvbnRhaW5lciB8fCAhdGhpcy5tZXNoSW5pdCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUaGUgY29udGFpbmVyIGRlcGVuZGVuY3kgaG9vayB3YXMgY2FsbGVkIGJlZm9yZSB0aGUgY29udGFpbmVyIHdhcyBjcmVhdGVkJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZXJ2aWNlQ29udGFpbmVyID0gdGhpcy5wYXJlbnRTZXJ2aWNlLnNlcnZpY2VEZXNjcmlwdGlvbi5nZXQoJ3NlcnZpY2UtY29udGFpbmVyJykgYXMgQ29udGFpbmVyO1xuXG4gICAgICAgIGlmIChzZXJ2aWNlQ29udGFpbmVyICYmIHNlcnZpY2VDb250YWluZXIuY29udGFpbmVyKSB7XG4gICAgICAgICAgICBzZXJ2aWNlQ29udGFpbmVyLmNvbnRhaW5lci5hZGRDb250YWluZXJEZXBlbmRlbmNpZXMoe1xuICAgICAgICAgICAgICAgIGNvbnRhaW5lcjogdGhpcy5tZXNoSW5pdCxcbiAgICAgICAgICAgICAgICBjb25kaXRpb246IGVjcy5Db250YWluZXJEZXBlbmRlbmN5Q29uZGl0aW9uLlNVQ0NFU1MsXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgc2VydmljZUNvbnRhaW5lci5jb250YWluZXIuYWRkQ29udGFpbmVyRGVwZW5kZW5jaWVzKHtcbiAgICAgICAgICAgICAgICBjb250YWluZXI6IHRoaXMuY29udGFpbmVyLFxuICAgICAgICAgICAgICAgIGNvbmRpdGlvbjogZWNzLkNvbnRhaW5lckRlcGVuZGVuY3lDb25kaXRpb24uSEVBTFRIWSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVGhpcyBob29rIGlzIHJlc3BvbnNpYmxlIGZvciBhZGRpbmcgcmVxdWlyZWQgaW5ncmVzcyBhbmQgZWdyZXNzIHJ1bGVzIHRvIHRoZSBzZWN1cml0eSBncm91cFxuICAgICAqIG9mIHRoZSBzZXJ2ZXIgYXMgd2VsbCBhcyB0aGUgc2VydmljZS4gSXQgaXMgYWxzbyBhY2NvdW50YWJsZSBmb3IgYWRkaW5nIGNvbnN1bENsaWVudFNlY3VyaXR5R3JvdXBcbiAgICAgKiB0byB0aGUgcGFyZW50IHNlcnZpY2UgdG8gbGV0IGNsaWVudHMgaW4gdGhlIG1lc2ggdGFsayB0byBlYWNoIG90aGVyLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBzZXJ2aWNlIFRoZSBnZW5lcmF0ZWQgc2VydmljZS5cbiAgICAgKi9cbiAgICBwdWJsaWMgdXNlU2VydmljZShzZXJ2aWNlOiBlY3MuRWMyU2VydmljZSB8IGVjcy5GYXJnYXRlU2VydmljZSkge1xuXG4gICAgICAgIHRoaXMuY29uc3VsU2VydmVyU2VyY3VyaXR5R3JvdXAuY29ubmVjdGlvbnMuYWxsb3dGcm9tKHNlcnZpY2UuY29ubmVjdGlvbnMuc2VjdXJpdHlHcm91cHNbMF0sIFBvcnQudGNwKDgzMDEpLCAnYWxsb3cgY29uc3VsIHNlcnZlciB0byBhY2NlcHQgdHJhZmZpYyBmcm9tIGNvbnN1bCBjbGllbnQgb24gVENQIHBvcnQgODMwMScpO1xuICAgICAgICB0aGlzLmNvbnN1bFNlcnZlclNlcmN1cml0eUdyb3VwLmNvbm5lY3Rpb25zLmFsbG93RnJvbShzZXJ2aWNlLmNvbm5lY3Rpb25zLnNlY3VyaXR5R3JvdXBzWzBdLCBQb3J0LnVkcCg4MzAxKSwgJ2FsbG93IGNvbnN1bCBzZXJ2ZXIgdG8gYWNjZXB0IHRyYWZmaWMgZnJvbSBjb25zdWwgY2xpZW50IG9uIFVEUCBwb3J0IDgzMDEnKTtcbiAgICAgICAgdGhpcy5jb25zdWxTZXJ2ZXJTZXJjdXJpdHlHcm91cC5jb25uZWN0aW9ucy5hbGxvd0Zyb20oc2VydmljZS5jb25uZWN0aW9ucy5zZWN1cml0eUdyb3Vwc1swXSwgUG9ydC50Y3AoODMwMCksICdhbGxvdyBjb25zdWwgc2VydmVyIHRvIGFjY2VwdCB0cmFmZmljIGZyb20gdGhlIHNlcnZpY2UgY2xpZW50IG9uIFRDUCBwb3J0IDgzMDAnKTtcblxuICAgICAgICBzZXJ2aWNlLmNvbm5lY3Rpb25zLnNlY3VyaXR5R3JvdXBzWzBdLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgICAgICAgdGhpcy5jb25zdWxTZXJ2ZXJTZXJjdXJpdHlHcm91cC5jb25uZWN0aW9ucy5zZWN1cml0eUdyb3Vwc1swXSxcbiAgICAgICAgICAgIFBvcnQudGNwKDgzMDEpLFxuICAgICAgICAgICAgJ2FsbG93IHNlcnZpY2UgdG8gYWNjZXB0IHRyYWZmaWMgZnJvbSBjb25zdWwgc2VydmVyIG9uIHRjcCBwb3J0IDgzMDEnXG4gICAgICAgICk7XG5cbiAgICAgICAgc2VydmljZS5jb25uZWN0aW9ucy5zZWN1cml0eUdyb3Vwc1swXS5hZGRJbmdyZXNzUnVsZShcbiAgICAgICAgICAgIHRoaXMuY29uc3VsU2VydmVyU2VyY3VyaXR5R3JvdXAuY29ubmVjdGlvbnMuc2VjdXJpdHlHcm91cHNbMF0sXG4gICAgICAgICAgICBQb3J0LnVkcCg4MzAxKSxcbiAgICAgICAgICAgICdhbGxvdyBzZXJ2aWNlIHRvIGFjY2VwdCB0cmFmZmljIGZyb20gY29uc3VsIHNlcnZlciBvbiB1ZHAgcG9ydCA4MzAxICdcbiAgICAgICAgKTtcblxuICAgICAgICBjb25zdCBzZXJ2aWNlU2VjdXJpdHlHcm91cElkcyA9IHNlcnZpY2UuY29ubmVjdGlvbnMuc2VjdXJpdHlHcm91cHMubWFwKHNnID0+IHNnLnNlY3VyaXR5R3JvdXBJZCk7XG5cbiAgICAgICAgc2VydmljZVNlY3VyaXR5R3JvdXBJZHMucHVzaCh0aGlzLmNvbnN1bENsaWVudFNlcmN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZCk7XG5cbiAgICAgICAgaWYgKHNlcnZpY2VTZWN1cml0eUdyb3VwSWRzLmxlbmd0aCA+IG1heFNlY3VyaXR5R3JvdXBMaW1pdCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgaGF2ZSBtb3JlIHRoYW4gNSBzZWN1cml0eSBncm91cHMgYXNzb2NpYXRlZCB3aXRoIHRoZSBzZXJ2aWNlJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjZm5QYXJlbnRTZXJ2aWNlID0gdGhpcy5wYXJlbnRTZXJ2aWNlLmVjc1NlcnZpY2Uubm9kZS5maW5kQ2hpbGQoXCJTZXJ2aWNlXCIpIGFzIGVjcy5DZm5TZXJ2aWNlO1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBJbmplY3QgY2ZuIG92ZXJyaWRlIGZvciBtdWx0aXBsZSBTR3MuIE92ZXJyaWRlIHRoZSAnU2VjdXJpdHlHcm91cHMnIHByb3BlcnR5IGluIHRoZVxuICAgICAgICAgKiBDbG91ZGZvcm1hdGlvbiByZXNvdXJjZSBvZiB0aGUgcGFyZW50IHNlcnZpY2Ugd2l0aCB0aGUgdXBkYXRlZCBsaXN0IG9mIHNlY3VyaXR5IGdyb3Vwcy5cbiAgICAgICAgICogVGhpcyBsaXN0IHdpbGwgaGF2ZSB0aGUgZXhpc3Rpbmcgc2VjdXJpdHkgZ3JvdXBzIG9mIHRoZSBwYXJlbnQgc2VydmljZSBwbHVzIGNvbnN1bENsaWVudFNlY3VyaXR5R3JvdXBcbiAgICAgICAgICovXG4gICAgICAgIGNmblBhcmVudFNlcnZpY2UuYWRkT3ZlcnJpZGUoXCJQcm9wZXJ0aWVzLk5ldHdvcmtDb25maWd1cmF0aW9uLkF3c3ZwY0NvbmZpZ3VyYXRpb24uU2VjdXJpdHlHcm91cHNcIixcbiAgICAgICAgICAgIHNlcnZpY2VTZWN1cml0eUdyb3VwSWRzXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVGhpcyBob29rIGlzIHJlc3BvbnNpYmxlIGZvciBjb25uZWN0aW5nIHR3byBzZXJ2aWNlcyB0b2dldGhlciwgYnVpbGRpbmcgYSBjb21tYW5kIGZvciBtZXNoSW5pdFxuICAgICAqIGNvbnRhaW5lciBhbmQgYWxzbyBhZGRpbmcgcmVxdWlyZWQgZW52aXJvbm1lbnQgdmFyaWFibGVzIHRvIHRoZSBhcHAgY29udGFpbmVyLlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBvdGhlclNlcnZpY2UgLSBUaGUgb3RoZXIgc2VydmljZSB0byBjb25uZWN0IHRvXG4gICAgICovXG4gICAgcHVibGljIGNvbm5lY3RUb1NlcnZpY2Uob3RoZXJTZXJ2aWNlOiBTZXJ2aWNlKSB7XG4gICAgICAgIGNvbnN0IG90aGVyQ29uc3VsTWVzaCA9IG90aGVyU2VydmljZS5zZXJ2aWNlRGVzY3JpcHRpb24uZ2V0KCdjb25zdWwnKSBhcyBDb25zdWxNZXNoRXh0ZW5zaW9uO1xuXG4gICAgICAgIGlmKG90aGVyQ29uc3VsTWVzaCA9PSB1bmRlZmluZWQpe1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVcHN0cmVhbSBzZXJ2aWNlIGRvZXNuJ3QgaGF2ZSBjb25zdWwgbWVzaCBleHRlbnNpb24gYWRkZWQgdG8gaXRgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIERvIGEgY2hlY2sgdG8gZW5zdXJlIHRoYXQgdGhlc2Ugc2VydmljZXMgYXJlIGluIHRoZSBzYW1lIGVudmlyb25tZW50XG4gICAgICAgIGlmIChvdGhlckNvbnN1bE1lc2gucGFyZW50U2VydmljZS5lbnZpcm9ubWVudC5pZCAhPT0gdGhpcy5wYXJlbnRTZXJ2aWNlLmVudmlyb25tZW50LmlkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBjb25uZWN0IHNlcnZpY2VzIGZyb20gZGlmZmVyZW50IGVudmlyb25tZW50c2ApO1xuICAgICAgICB9XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEFsbG93IG90aGVyIHNlcnZpY2UgdG8gYWNjZXB0IHRyYWZmaWMgZnJvbSBwYXJlbnQgc2VydmljZS5cbiAgICAgICAgICogb3BlbiBwb3J0IDIwMDAwIGZvciBwcm94eSB0byByb3V0ZSB0aGUgdHJhZmZpYyBmcm9tIHBhcmVudCBzZXJ2aWNlXG4gICAgICAgICAqIHRvIHRoZSBvdGhlciBzZXJ2aWNlXG4gICAgICAgICAqL1xuICAgICAgICBvdGhlclNlcnZpY2UuZWNzU2VydmljZS5jb25uZWN0aW9ucy5hbGxvd0Zyb20oXG4gICAgICAgICAgICB0aGlzLnBhcmVudFNlcnZpY2UuZWNzU2VydmljZSxcbiAgICAgICAgICAgIFBvcnQudGNwKDIwMDAwKSxcbiAgICAgICAgICAgIGBBY2NlcHQgaW5ib3VuZCB0cmFmZmljIGZyb20gJHt0aGlzLnBhcmVudFNlcnZpY2UuaWR9YCxcbiAgICAgICAgKTtcblxuICAgICAgICB0aGlzLnVwc3RyZWFtU3RyaW5nQXJyYXkucHVzaChvdGhlclNlcnZpY2UuZWNzU2VydmljZS50YXNrRGVmaW5pdGlvbi5mYW1pbHkgKyBcIjpcIiArIHRoaXMudXBzdHJlYW1Qb3J0KTtcblxuICAgICAgICB2YXIgY2ZuVGFza0RlZmluaXRpb24gPSB0aGlzLnBhcmVudFNlcnZpY2U/LmVjc1NlcnZpY2U/LnRhc2tEZWZpbml0aW9uPy5ub2RlLmRlZmF1bHRDaGlsZCBhcyBlY3MuQ2ZuVGFza0RlZmluaXRpb247XG5cbiAgICAgICAgaWYoY2ZuVGFza0RlZmluaXRpb24gPT0gdW5kZWZpbmVkKXtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVGhlIHRhc2sgZGVmaW5pdGlvbiBpcyBub3QgZGVmaW5lZGApO1xuICAgICAgICB9XG4gICAgICAgXG4gICAgICAgIC8vT3ZlcnJpZGUgY29tbWFuZCBmb3IgY29uc3VsLW1lc2gtaW5pdC1jb250YWluZXIgaGVyZSB0byBoYXZlIHVwc3RyZWFtIGRldGFpbHMgYXMgd2Ugb25seSB1c2UgY29ubmVjdFRvKClcbiAgICAgICAgLy90byBhZGQgdXBzdHJlYW0gZGV0YWlsc1xuICAgICAgICBjZm5UYXNrRGVmaW5pdGlvbi5hZGRQcm9wZXJ0eU92ZXJyaWRlKCdDb250YWluZXJEZWZpbml0aW9ucy4yLkNvbW1hbmQnLCBbXCJtZXNoLWluaXRcIixcbiAgICAgICAgICAgIFwiLWVudm95LWJvb3RzdHJhcC1maWxlPS9jb25zdWwvZGF0YS9lbnZveS1ib290c3RyYXAuanNvblwiLFxuICAgICAgICAgICAgXCItcG9ydD1cIiArIHRoaXMucG9ydCxcbiAgICAgICAgICAgIFwiLXVwc3RyZWFtcz1cIiArIHRoaXMuYnVpbGRVcHN0cmVhbVN0cmluZ10pO1xuXG5cbiAgICAgICAgaWYgKHRoaXMucGFyZW50U2VydmljZUVudmlyb25tZW50cy5sZW5ndGggPT0gMCkgeyAvLyBhZGQgZW52aXJvbm1lbnQgdmFyaWFibGVzIGZyb20gYXBwIGNvbnRhaW5lciBvbmx5IG9uY2VcbiAgICAgICAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsXSBvZiBPYmplY3QuZW50cmllcyhlbnZpcm9ubWVudCkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnBhcmVudFNlcnZpY2VFbnZpcm9ubWVudHMucHVzaCh7IE5hbWU6IGtleSwgVmFsdWU6IHZhbCB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMucGFyZW50U2VydmljZUVudmlyb25tZW50cy5wdXNoKHsgTmFtZTogb3RoZXJTZXJ2aWNlLmVjc1NlcnZpY2UudGFza0RlZmluaXRpb24uZmFtaWx5LnRvVXBwZXJDYXNlKCkgKyAnX1VSTCcsIFZhbHVlOiAnaHR0cDovL2xvY2FsaG9zdDonICsgdGhpcy51cHN0cmVhbVBvcnQrKyB9KVxuXG4gICAgICAgIC8vQWxzbyBhZGQgcmVxdWlyZWQgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gICAgICAgIGNmblRhc2tEZWZpbml0aW9uLmFkZFByb3BlcnR5T3ZlcnJpZGUoJ0NvbnRhaW5lckRlZmluaXRpb25zLjAuRW52aXJvbm1lbnQnLCBBcnJheS5mcm9tKHRoaXMucGFyZW50U2VydmljZUVudmlyb25tZW50cy52YWx1ZXMoKSkpO1xuICAgIH1cblxuICAgIHByaXZhdGUgZ2V0IGJ1aWxkVXBzdHJlYW1TdHJpbmcoKTogc3RyaW5nIHtcbiAgICAgICAgcmV0dXJuIHRoaXMudXBzdHJlYW1TdHJpbmdBcnJheS5qb2luKFwiLFwiKVxuICAgIH1cbn1cblxuXG5leHBvcnQgY2xhc3MgQ29uc3VsTWVzaHNNdXRhdGluZ0hvb2sgZXh0ZW5kcyBDb250YWluZXJNdXRhdGluZ0hvb2sge1xuICAgIHB1YmxpYyBtdXRhdGVDb250YWluZXJEZWZpbml0aW9uKHByb3BzOiBlY3MuQ29udGFpbmVyRGVmaW5pdGlvbk9wdGlvbnMpOiBlY3MuQ29udGFpbmVyRGVmaW5pdGlvbk9wdGlvbnMge1xuICAgICAgICBlbnZpcm9ubWVudCA9IHByb3BzLmVudmlyb25tZW50IHx8IHt9O1xuXG4gICAgICAgIHJldHVybiB7IC4uLnByb3BzIH0gYXMgZWNzLkNvbnRhaW5lckRlZmluaXRpb25PcHRpb25zO1xuICAgIH1cbn1cbiJdfQ==