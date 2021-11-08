# CDK ECS service extension for Consul

[consul-extension](./consul-extension) contains code for the extension itself. It's meant to represent what a future release of the extension would contain.

[extension-test-app](./extension-test-app) contains a CDK test app which exercises the extension and can be used for end to end testing.

## How to use this repo

1. Make and build changes to the extension
2. CDK diff, synth, and deploy the test app in your developer account to test end-to-end.
