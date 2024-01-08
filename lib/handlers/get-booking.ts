import { APIGatewayProxyEvent } from "aws-lambda";

export const handler = async (event: APIGatewayProxyEvent) => {
  const claims = event.requestContext.authorizer?.claims;

  if (!Boolean(claims?.permissions) || !claims.permissions.includes("booking:read")) {
    return {
      statusCode: 403,
      body: JSON.stringify({
        message: "Forbidden",
      }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      id: "456",
      date: new Date().toISOString(),
      name: "Hotel California",
    }),
  };
};
