declare module "cloudflare:workers" {
  export const env: {
    API: { fetch(input: Request): Promise<Response> };
    DEPLOYMENT_ENV: "local" | "preview" | "production" | "test";
    FRONTEND_API_HMAC_CURRENT?: string;
  };
}
