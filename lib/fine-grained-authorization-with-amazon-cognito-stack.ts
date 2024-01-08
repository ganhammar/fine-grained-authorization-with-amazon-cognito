import { CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import { AuthorizationType, CfnAuthorizer, LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import {
  CfnUserPool,
  CfnUserPoolGroup,
  OAuthScope,
  StringAttribute,
  UserPool,
  UserPoolClient,
  UserPoolOperation,
} from "aws-cdk-lib/aws-cognito";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

const MEMORY_SIZE = 1769;

export class FineGrainedAuthorizationWithAmazonCognitoStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create user pool
    const userPool = new UserPool(this, "UserPool", {
      userPoolName: "permissions",
      customAttributes: {
        permission: new StringAttribute({ mutable: true }),
      },
    });

    userPool.addDomain("UserPoolDomain", {
      cognitoDomain: {
        domainPrefix: "permissions",
      },
    });

    // Enable advanced security
    const cfnUserPool = userPool.node.defaultChild as CfnUserPool;
    cfnUserPool.userPoolAddOns = {
      advancedSecurityMode: "ENFORCED",
    };

    // Store user pool id in SSM
    new StringParameter(this, "UserPoolIdParameter", {
      parameterName: "/permissions/userpool/id",
      stringValue: userPool.userPoolId,
    });

    // Add resource server
    const resourceServer = userPool.addResourceServer("ResourceServer", {
      identifier: "resources",
      scopes: [
        {
          scopeName: "booking-service",
          scopeDescription: "Access booking service",
        },
        {
          scopeName: "review-service",
          scopeDescription: "Access review service",
        },
      ],
    });

    // Add dynamodb table to store permissions in
    const table = new Table(this, "Permissions", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      tableName: "Permissions",
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    // Add Admin group to user pool
    new CfnUserPoolGroup(this, "AdminGroup", {
      groupName: "Admin",
      userPoolId: userPool.userPoolId,
      description: "Admin group",
    });

    // Add User group to user pool
    new CfnUserPoolGroup(this, "UserGroup", {
      groupName: "User",
      userPoolId: userPool.userPoolId,
      description: "User group",
    });

    // Define pre token generation lambda
    const preTokenGeneration = new NodejsFunction(this, "PreTokenGeneration", {
      runtime: Runtime.NODEJS_20_X,
      handler: "handler",
      entry: `${__dirname}/handlers/pre-token-generation.ts`,
      memorySize: MEMORY_SIZE,
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    preTokenGeneration.addToRolePolicy(
      new PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          Stack.of(this).formatArn({
            service: "ssm",
            resource: "parameter/permissions/userpool/id",
          }),
        ],
      })
    );

    preTokenGeneration.addToRolePolicy(
      new PolicyStatement({
        actions: ["cognito-idp:DescribeUserPoolClient"],
        resources: ["*"],
      })
    );

    userPool.addTrigger(
      UserPoolOperation.PRE_TOKEN_GENERATION,
      preTokenGeneration
    ); // Needs to be changed to V2_0 in console until CDK supports it

    // Grant read access to table
    table.grantReadData(preTokenGeneration);

    // Create booking client
    const bookingClient = new UserPoolClient(this, "BookingClient", {
      userPool,
      generateSecret: false,
      userPoolClientName: "Booking",
      authFlows: {
        userPassword: false,
        userSrp: true,
        custom: false,
        adminUserPassword: false,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          OAuthScope.EMAIL,
          OAuthScope.OPENID,
          OAuthScope.PROFILE,
          OAuthScope.custom(
            `${resourceServer.userPoolResourceServerId}/booking-service`
          ),
        ],
        callbackUrls: ["http://localhost:3000"],
        logoutUrls: ["http://localhost:3000"],
      },
    });

    // Create review client
    const reviewClient = new UserPoolClient(this, "ReviewClient", {
      userPool,
      generateSecret: false,
      userPoolClientName: "Review",
      authFlows: {
        userPassword: false,
        userSrp: true,
        custom: false,
        adminUserPassword: false,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          OAuthScope.EMAIL,
          OAuthScope.OPENID,
          OAuthScope.PROFILE,
          OAuthScope.custom(
            `${resourceServer.userPoolResourceServerId}/review-service`
          ),
        ],
        callbackUrls: ["http://localhost:3000"],
        logoutUrls: ["http://localhost:3000"],
      },
    });

    // Crate REST API
    const api = new RestApi(this, "PermissionsApi", {
      restApiName: "permissions-api",
    });

    // Create Booking Lambda
    const getBookingLambda = new NodejsFunction(this, "GetBooking", {
      runtime: Runtime.NODEJS_20_X,
      handler: "handler",
      entry: `${__dirname}/handlers/get-booking.ts`,
      memorySize: MEMORY_SIZE,
    });
    const getBookingIntegration = new LambdaIntegration(getBookingLambda);

    // Create Cognito authorizer
    const authorizer = new CfnAuthorizer(this, "CognitoAuthorizer", {
      restApiId: api.restApiId,
      type: "COGNITO_USER_POOLS",
      identitySource: "method.request.header.Authorization",
      providerArns: [userPool.userPoolArn],
      name: "CognitoAuthorizer",
    });

    // Add booking resource
    const bookingResource = api.root.addResource("booking");
    bookingResource.addMethod("GET", getBookingIntegration, {
      authorizationType: AuthorizationType.COGNITO,
      authorizer: {
        authorizerId: authorizer.ref,
      },
      authorizationScopes: [
        `${resourceServer.userPoolResourceServerId}/booking-service`,
      ],
    });
    bookingResource.addCorsPreflight({
      allowOrigins: ["http://localhost:3000"],
      allowMethods: ["GET", "OPTIONS", "POST", "PUT", "DELETE"],
      allowHeaders: ["*"],
    });

    // CDK Outputs
    new CfnOutput(this, "UserPoolIdOutput", {
      value: userPool.userPoolId,
    });

    new CfnOutput(this, "BookingClientIdOutput", {
      value: bookingClient.userPoolClientId,
    });

    new CfnOutput(this, "ReviewClientIdOutput", {
      value: reviewClient.userPoolClientId,
    });
  }
}
