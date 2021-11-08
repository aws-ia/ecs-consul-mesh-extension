import * as cdk from '@aws-cdk/core';
import { 
  Container, 
  Environment, 
  HttpLoadBalancerExtension, 
  Service, 
  ServiceDescription 
} from '@aws-cdk-containers/ecs-service-extensions';
import * as ec2 from '@aws-cdk/aws-ec2';
import { ContainerImage } from '@aws-cdk/aws-ecs';
// use local extension
import { ConsulMeshExtension } from '../../consul-extension/lib/consul-mesh-extension';

export class ExtensionTestAppStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const environment = new Environment(this, 'MyEnvironment', {
      vpc:  ec2.Vpc.fromLookup(this, 'consulVPC', { vpcName: 'consulVPC' })
    });

    //Provide security group Id of the consul server.
    const consulSecurityGroup = ec2.SecurityGroup.fromLookup(this, 'consulServerSecurityGroup', 'fake-sg-id')

    // launch service into that cluster
    const webFrontendDescription = new ServiceDescription();
    webFrontendDescription.add(new Container({
      cpu: 1024,
      memoryMiB: 2048,
      trafficPort: 80,
      image: ContainerImage.fromRegistry('httpd:2.4'),
    }));

    webFrontendDescription.add(new HttpLoadBalancerExtension());
    webFrontendDescription.add(new ConsulMeshExtension({
      retryJoin: "hello-retry-join",
      consulServerSercurityGroup: consulSecurityGroup
    }));

    const webService = new Service(this, 'web', {
      environment: environment,
      serviceDescription: webFrontendDescription,
    });
  }
}
