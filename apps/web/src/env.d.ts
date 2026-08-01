declare module "cloudflare:workers" {
  export const env: {
    DEPLOYMENT_ENV: "local" | "preview" | "production" | "test";
  };
}

declare namespace App {
  interface Locals {}
}
