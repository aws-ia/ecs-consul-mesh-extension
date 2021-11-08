# Consul extension test app

To run the test app locally:

1. within this directory, run `npm install` to install required node modules
2. if desired target a specific account & region in [/bin/exention-test-app.ts](./bin/exention-test-app.ts). Otherwise it will use your default account _us-east-2_)
3. run `cdk diff` to ensure CDK knows how to deploy your stack and what's in it. 
    * At this point, if you've made any changes to the extension or app, you'll want to look at the output to verify your changes have taken effect.
4. run `cdk deploy` to deploy changes, observe stack creation/update and running ECS service for issues.


## Useful commands

The `cdk.json` file tells the CDK Toolkit how to execute your app.

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template