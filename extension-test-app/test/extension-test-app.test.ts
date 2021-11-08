import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as ExtensionTestApp from '../lib/extension-test-app-stack';
 
test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new ExtensionTestApp.ExtensionTestAppStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});