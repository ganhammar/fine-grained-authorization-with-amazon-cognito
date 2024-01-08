import { BatchGetItemCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";

interface UserAttributes {
  [key: string]: string;
}

interface GroupConfiguration {
  groupsToOverride: string[];
  iamRolesToOverride: string[];
  preferredRole: string;
}

interface ClientMetadata {
  [key: string]: string;
}

interface ClaimsAndScopeOverrideDetails {
  claimsToAddOrOverride?: { [key: string]: string };
  claimsToSuppress?: string[];
  scopesToAdd?: string[];
  scopesToSuppress?: string[];
}

interface GroupOverrideDetails {
  groupsToOverride: string[];
  iamRolesToOverride: string[];
  preferredRole: string;
}

interface PreTokenGenerationTriggerEventRequest {
  userAttributes: UserAttributes;
  scopes: string[];
  groupConfiguration: GroupConfiguration;
  clientMetadata: ClientMetadata;
}

interface PreTokenGenerationTriggerEventResponse {
  claimsAndScopeOverrideDetails: {
    idTokenGeneration?: ClaimsAndScopeOverrideDetails;
    accessTokenGeneration?: ClaimsAndScopeOverrideDetails;
    groupOverrideDetails?: GroupOverrideDetails;
  };
}

interface CallerContext {
  awsSdkVersion: string;
  clientId: string;
}

interface PreTokenGenerationTriggerHandler {
  callerContext: CallerContext;
  request: PreTokenGenerationTriggerEventRequest;
  response: PreTokenGenerationTriggerEventResponse;
}

const client = new DynamoDBClient({ region: "eu-north-1" });
const tableName = process.env.TABLE_NAME!;

export const handler = async (
  event: PreTokenGenerationTriggerHandler
) => {
  console.log(JSON.stringify(event, null, 2));
  const claims = event.request.userAttributes;
  const groups = event.request.groupConfiguration.groupsToOverride;

  if ((groups?.length ?? 0) > 0) {
    const command = new BatchGetItemCommand({
      RequestItems: {
        [tableName]: {
          Keys: groups.map((group) => ({
            pk: { S: event.callerContext.clientId },
            sk: { S: group },
          })),
        },
      },
    });
    const data = await client.send(command);

    const permissions = [...new Set(data.Responses![tableName].map(
      (item) => item.permissions.SS ?? []
    ).flat())];

    claims["permissions"] = permissions.join(",");
  }

  event.response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: {
        claimsToAddOrOverride: claims,
      },
      accessTokenGeneration: {
        claimsToAddOrOverride: claims,
      },
    },
  };

  return event;
};